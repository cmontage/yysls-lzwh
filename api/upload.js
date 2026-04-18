export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const normalizeToken = (rawToken = '') => rawToken.trim().replace(/^Bearer\s+/i, '').replace(/^token\s+/i, '');

    const readGitHubErrorMessage = async (response) => {
        try {
            const data = await response.json();
            if (data && data.message) return data.message;
        } catch (_) {
            // Ignore JSON parse failures and fall back to text.
        }

        try {
            const text = await response.text();
            return text || `HTTP ${response.status}`;
        } catch (_) {
            return `HTTP ${response.status}`;
        }
    };

    const githubRequestWithAuthFallback = async (url, init, token, preferredScheme = 'token') => {
        const schemes = preferredScheme === 'Bearer' ? ['Bearer', 'token'] : ['token', 'Bearer'];
        let lastResponse = null;
        let usedScheme = preferredScheme;

        for (const scheme of schemes) {
            const response = await fetch(url, {
                ...init,
                headers: {
                    'Authorization': `${scheme} ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'Vercel-Admin-App',
                    'X-GitHub-Api-Version': '2022-11-28',
                    ...(init.headers || {})
                }
            });

            lastResponse = response;
            usedScheme = scheme;

            if (response.ok) {
                return { response, scheme };
            }

            if (response.status !== 401) {
                return { response, scheme };
            }

            const errorBody = await response.clone().json().catch(() => ({}));
            const isBadCredentials = /bad credentials/i.test(errorBody?.message || '');
            if (!isBadCredentials) {
                return { response, scheme };
            }
        }

        return { response: lastResponse, scheme: usedScheme };
    };

    try {
        const { password, imageBase64, action } = req.body;

        // 获取环境变量配置
        const ADMIN_PWD = process.env.ADMIN_PASSWORD; // 管理员密码，在Vercel环境变量中配置
        const GITHUB_TOKEN = normalizeToken(process.env.GITHUB_TOKEN || ''); // GitHub Token，在Vercel环境变量中配置
        const REPO = process.env.GITHUB_REPO || 'cmontage/yysls-lzwh';
        const BRANCH = 'main';
        const FILE_PATH = 'assets/vx-qr.png'; // 替换的目标文件

        if (!password || password !== ADMIN_PWD) {
            return res.status(401).json({ error: '管理员密码错误，无权操作！' });
        }

        if (action === 'verify') {
            return res.status(200).json({ success: true, message: '验证成功' });
        }

        if (!GITHUB_TOKEN) {
            return res.status(500).json({ error: '服务端未配置 GITHUB_TOKEN 环境变量，无法提交代码！' });
        }

        if (!imageBase64) {
            return res.status(400).json({ error: '缺少 imageBase64，无法上传二维码图片。' });
        }

        // 提取 base64 前缀
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

        // 1. 获取现有文件的 SHA (如果文件存在的话，更新它必须提供 SHA)
        const getUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
        let authScheme = 'token';
        const getResult = await githubRequestWithAuthFallback(getUrl, { method: 'GET' }, GITHUB_TOKEN, authScheme);
        const getRes = getResult.response;
        authScheme = getResult.scheme || authScheme;

        let sha = undefined;
        if (getRes.ok) {
            const data = await getRes.json();
            sha = data.sha;
        } else if (getRes.status !== 404) {
            const getErrorMessage = await readGitHubErrorMessage(getRes);
            if (/bad credentials/i.test(getErrorMessage)) {
                return res.status(500).json({
                    error: 'GitHub Token 认证失败：请在环境变量 GITHUB_TOKEN 中填写纯 token（不要带 Bearer/token 前缀），并确认 token 未过期且有仓库 Contents 读写权限。'
                });
            }
            return res.status(500).json({ error: `读取仓库文件失败: ${getErrorMessage}` });
        }

        // 2. 将新图片推送到 GitHub 仓库 (这将触发 Vercel 自动重新部署)
        const putUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
        const putResult = await githubRequestWithAuthFallback(putUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Update QR code via Admin Dashboard',
                content: base64Data,
                branch: BRANCH,
                sha: sha
            })
        }, GITHUB_TOKEN, authScheme);
        const putRes = putResult.response;

        if (!putRes.ok) {
            const putErrorMessage = await readGitHubErrorMessage(putRes);
            console.error('GitHub API Error:', putErrorMessage);

            if (/bad credentials/i.test(putErrorMessage)) {
                return res.status(500).json({
                    error: 'GitHub Token 认证失败：请在环境变量 GITHUB_TOKEN 中填写纯 token（不要带 Bearer/token 前缀），并确认 token 未过期且有仓库 Contents 读写权限。'
                });
            }

            return res.status(500).json({ error: `GitHub API 错误: ${putErrorMessage}` });
        }

        return res.status(200).json({ success: true, message: '二维码更新成功！约 1-2 分钟后生效。' });

    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ error: `服务器内部错误: ${err.message}` });
    }
}