# 手动安装指引的平台联动

2026-10-23。

- 沿用应用的自动桌面平台识别，开发时也跟随预览切换器；不新增持久化配置、IPC 或依赖。
- 当前平台/包管理器标识、终端说明、复制命令、FFmpeg 官网平台入口同步切换。消除固定同时列出三平台说明造成的歧义。
- macOS：Homebrew；Windows：WinGet；Linux：明确限定 Ubuntu/Debian 的 apt-get 示例，其他发行版自行使用对应包管理器。
- Linux 的 Deno 沿用官方安装文档，不展示不存在的官方 apt 源命令；ffprobe 沿用 FFmpeg 包安装。
- 复制成功反馈同时核对组件与具体命令，切平台不错误标记新命令已复制。

验证：50 项前端单元测试、ESLint、TypeScript/Vite 构建通过。`scripts/verify-install-guides-ui.mjs` 分别模拟 macOS/Windows/Linux User-Agent 自动识别，验证平台命令、复制内容、平台说明和链接；并在运行中切换全部预览平台及恢复自动。剪贴板为隔离 fixture，不写系统剪贴板、不安装或更新组件。仅浏览器模拟，不声称完成三个原生操作系统验收。本次未改 Rust，无需重复后端测试。

参考：既有命令保持不变；核对 [Homebrew yt-dlp](https://formulae.brew.sh/formula/yt-dlp)、[Deno 安装文档](https://docs.deno.com/runtime/getting_started/installation/)。FFmpeg 入口复用设计中的 build-mac/build-windows/build-linux 链接。
