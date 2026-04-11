export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { password, imageBase64, action } = req.body;

        // 获取环境变量配置
        const ADMIN_PWD = process.env.ADMIN_PASSWORD; // 管理员密码，在Vercel环境变量中配置
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // GitHub Token，在Vercel环境变量中配置
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

        // 提取 base64 前缀
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

        // 1. 获取现有文件的 SHA (如果文件存在的话，更新它必须提供 SHA)
        const getUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
        const getRes = await fetch(getUrl, {
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Vercel-Admin-App'
            }
        });

        let sha = undefined;
        if (getRes.ok) {
            const data = await getRes.json();
            sha = data.sha;
        }

        // 2. 将新图片推送到 GitHub 仓库 (这将触发 Vercel 自动重新部署)
        const putUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
        const putRes = await fetch(putUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Vercel-Admin-App',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Update QR code via Admin Dashboard',
                content: base64Data,
                branch: BRANCH,
                sha: sha
            })
        });

        if (!putRes.ok) {
            const errorData = await putRes.json();
            console.error('GitHub API Error:', errorData);
            return res.status(500).json({ error: `GitHub API 错误: ${errorData.message}` });
        }

        return res.status(200).json({ success: true, message: '二维码更新成功！Vercel 正在自动重新部署，约 1-2 分钟后生效。' });

    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ error: `服务器内部错误: ${err.message}` });
    }
}