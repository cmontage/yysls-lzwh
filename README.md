# Cloudflare Pages 隐性转发部署说明

本项目用于在 Cloudflare Pages 上实现：
- 自定义域名访问目标 URL（地址栏保持你的域名）
- 网页标题固定为：落子无悔！
- favicon 使用根目录的 `favicon.ico`

## 1. 项目文件

- `functions/[[path]].js`：反向代理所有路径
- `favicon.ico`：站点图标（你已放在根目录）

## 2. 创建 Pages 项目

1. 打开 Cloudflare Dashboard -> Workers & Pages -> Create application -> Pages。
2. 选择 Connect to Git，绑定此仓库。
3. Build settings：
   - Framework preset: None
   - Build command: 留空
   - Build output directory: `/`

## 3. 设置环境变量

在 Pages 项目 Settings -> Environment variables 中新增：

- `TARGET_URL` = 你的目标完整链接（包含路径和参数）

示例：
- `https://ug.link/blackmyth/photo/share/?id=8&pagetype=share&uuid=88615bee-c594-4cc1-8826-252ae7bbb4ae`

说明：
- 代码已内置默认目标链接（就是上面的链接）。
- 若你在 Cloudflare 中设置了 `TARGET_URL`，会优先使用环境变量值。

## 4. 绑定自定义域名

1. 进入 Pages 项目 -> Custom domains -> Set up a custom domain。
2. 输入你的域名（例如 `go.yourdomain.com`）。
3. 按 Cloudflare 指引自动配置 DNS。

## 5. 生效说明

- 访问你的自定义域名根路径时，内容来自 `TARGET_URL`。
- 地址栏保持你的域名，实现“隐性跳转”效果。
- HTML 页面会强制改写标题为：落子无悔！
- favicon 使用根目录 `favicon.ico`。

## 6. 重要限制

- 若目标站点使用严格的 CSP、反爬、验证码、WebSocket 鉴权等机制，可能出现部分资源加载失败。
- 这是所有反向代理方案的通用限制，不是 Pages 独有问题。
- 如需更高兼容性，可改为 Cloudflare Workers 专用代理并做更细粒度头部改写。
