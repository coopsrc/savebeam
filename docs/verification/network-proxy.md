# 全局媒体代理验证

日期：2026-10-22。

## 使用方式与范围

在“设置 → 网络与代理”选择自定义代理，填写自己的代理地址（如 `http://127.0.0.1:7890` 或 `socks5h://127.0.0.1:1080`），点击“保存网络设置”。示例端口不是自动检测值，应以本机代理软件为准。切换直连或恢复默认网络都会清空保存的自定义地址。

覆盖媒体解析、下载、订阅检查和封面请求，不修改系统网络，也不接管组件下载、应用更新。队列任务启动/重试读取当前配置；已运行任务继续使用其启动时的配置。Cookie 授权仍独立配置。

首版拒绝代理账号密码，避免明文写入 SQLite 和进程 argv。保存成功只表示格式合法且设置已持久化，不会自动连通或测试 YouTube；错误网络、账号权限、JS runtime 或站点限制仍可能使下载失败。

## 自动验证

`pnpm check` 通过：格式、ESLint、Clippy、TypeScript/Vite、25 项前端测试及 121 项 Rust 测试；保留既有 Vite 大包提示。

新增覆盖：

- 默认模式不添加代理参数，直连生成 `--proxy` 和独立空字符串，自定义模式生成两个独立 argv，代理选项位于固定 `-- URL` 分隔符前。
- HTTP/HTTPS、SOCKS4/4a/5/5h 和 IPv6 地址；拒绝认证、未知协议、零/非法端口、路径/query/fragment、控制字符和命令注入；错误不回显密码。
- 设置默认值、数据库往返/重新打开后保持、保存失败保留原值、损坏数据不静默变为直连。
- 模拟可执行文件核实解析/订阅参数；下载参数保留格式与已确认的 Cookie 来源。
- 封面请求通过真实 loopback HTTP 代理抵达不可解析的 `.invalid` 目标，不转发 Cookie/Authorization；无效/不可达代理不会由 Savebeam 回退直连到目标服务器。
- 本地 SOCKS5 服务器验证封面 `socks5h` 握手传递目标域名，由代理处理 DNS，而不是本机解析 `.invalid`。

## 界面回归

```sh
node scripts/verify-network-proxy-ui.mjs /path/to/playwright/index.mjs http://127.0.0.1:1421/
```

Chrome + 模拟 Tauri IPC，5 组场景通过：

1. 默认到自定义、HTTP 地址保存/规范化回显、路由返回读取、直连及恢复默认。
2. 空值/非法协议/认证/路径/命令被拦截而不调用保存 IPC；SOCKS5h IPv6 可保存。
3. 读取失败禁用保存，不覆盖已有设置；重试读取可恢复编辑。
4. 无法读取配置时，用户显式选择恢复默认网络可恢复使用。
5. 异步保存锁定输入和操作，保存失败保留输入、不显示成功；重试成功。

均无 pageerror。已检查 `/tmp/savebeam-network-proxy-settings.png`。原下载页 14 个窗口场景与 0/1/50 项列表、滚动条上下端/明暗主题/键盘和滚轮回归继续通过。

## 真实 yt-dlp 离线集成

```sh
node scripts/verify-network-proxy.mjs /path/to/python-with-yt-dlp
```

在本机 yt-dlp 2026.8.19 执行通过：metadata-only 解析和下载均通过本地 HTTP 代理，目标为 `http://savebeam-proxy-test.invalid/media.mp4`。代理返回合成媒体字节，不访问真实站点，共记录 3 个请求，最终文件字节一致且没有 Cookie/Authorization。测试只在随机临时目录生成并清理自己的合成文件，不操作用户下载文件。

## 验证边界

没有使用用户代理、Cookie、账号或真实 YouTube 视频。真实 yt-dlp 的 HTTP 代理测试不等同于所有协议/站点已实测；HTTPS/其他 SOCKS 协议的端点与 argv 验证不代表公网代理服务可用。原生 macOS WebView、Windows/Linux、实际 YouTube 下载仍需用户环境验收。程序不提供后台连通性检测或自动重写系统代理。
