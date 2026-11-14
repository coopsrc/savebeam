# Savebeam

Savebeam 是一个本地优先的桌面媒体下载器。应用使用 Tauri 2、React、TypeScript 和 Rust 构建；yt-dlp、FFmpeg、ffprobe 与 JavaScript runtime 作为独立组件管理，不随当前开发包内置。

已提供媒体解析、下载队列、历史记录、系列订阅和本地组件管理。技术方案参见[软件设计说明书](docs/software-design.md)，任务与里程碑参见[实施计划](docs/implementation-plan.md)；开发验证不等同于跨平台正式发行验收。

## 下载

[GitHub Releases](https://github.com/coopsrc/savebeam/releases) 提供 macOS Apple Silicon 的 `.dmg` 和 Windows x64 的 `-setup.exe`；请选择安装包，`Source code` 是源码。0.1.0 尚无正式系统发行签名/Apple 公证，详见[发布说明](docs/releases/notes/0.1.0.md)。运行组件需要在设置中按平台安装或指定路径。

开发使用 `main`，每次发布创建固定版本 Tag（如 `v0.1.0`），由 CI 构建并附加安装包至对应 Release。目前不使用长期 release 分支；需要并行维护旧版本时再从对应 Tag 建立维护分支。发布步骤见[发行流程](docs/releases/desktop-release.md)。

历史记录和已完成任务的“来源与版本”可主动检查疑似来源变化，并重新下载到独立版本目录，保留旧文件。元数据或成品摘要不同不代表已确认 UP 主换源；旧下载没有来源基线时显示无法判断。详情见[版本行为与验证](docs/verification/source-versions.md)。自定义运行组件路径已保存到本地设置，重启后继续生效。

## 媒体代理

“设置 → 网络与代理”支持默认网络、直连和自定义代理，例如 `http://127.0.0.1:7890`、`socks5h://127.0.0.1:1080`（请按实际代理软件填写端口）。保存后用于新启动/重试的媒体解析、下载、订阅检查和封面请求；正在运行的任务不受影响。首版不支持代理账号密码，不修改系统代理，也不接管组件和应用更新。代理不能代替 Cookie 授权或保证所有 YouTube 视频可下载。详见[代理验证与边界](docs/verification/network-proxy.md)。

## 开发环境

日常开发和任务级验证以 macOS Apple Silicon 为主，推荐使用 RustRover。

需要预先安装：

- Xcode Command Line Tools。
- [Rust stable toolchain](https://rustup.rs/)；项目会自动要求 `rustfmt` 和 `clippy` 组件。
- nvm；项目 Node 主版本记录在 `.nvmrc`。
- pnpm；精确版本记录在 `package.json` 的 `packageManager` 字段。

初始化环境：

```shell
nvm install
nvm use
corepack enable
corepack prepare pnpm@12.4.1 --activate
pnpm install --frozen-lockfile
```

项目 `.npmrc` 只影响当前仓库，默认使用 `https://registry.npmmirror.com/`。如需恢复 npm 官方 registry，可修改该文件为：

```ini
registry=https://registry.npmjs.org/
```

## RustRover

1. 在 RustRover 中打开仓库根目录，不要只打开 `src-tauri`。
2. 将 Node.js interpreter 指向 `nvm` 当前启用的 Node 24。
3. 将 pnpm 配置为项目 package manager。
4. 确认 Rust toolchain 使用项目根目录 `rust-toolchain.toml` 指定的 stable channel。
5. 日常运行可以使用内置 Terminal 执行 `pnpm tauri dev`；后续如增加 Run Configuration，应调用同一命令。

## 常用命令

| 命令                | 用途                                             |
| ------------------- | ------------------------------------------------ |
| `pnpm tauri dev`    | 启动 Vite 与 Tauri 桌面开发环境                  |
| `pnpm build`        | 执行 TypeScript 检查并生成前端生产构建           |
| `pnpm format`       | 格式化前端、配置、文档和 Rust 源码               |
| `pnpm format:check` | 检查 Prettier 与 rustfmt，不修改文件             |
| `pnpm lint`         | 执行 ESLint 与 Clippy，Rust warning 视为错误     |
| `pnpm test:rust`    | 执行 Rust 单元测试和文档测试                     |
| `pnpm check`        | 依次执行格式、lint、前端构建和 Rust 测试完整检查 |

提交任务前至少运行：

```shell
pnpm check
```

## 提交流程

- 每个实施任务完成并验证后形成一笔独立提交。
- 一个里程碑全部任务完成后执行完整验收，并提交一笔包含验收记录的里程碑验证提交。
- macOS 验证结果不能替代 Windows 或 Linux 专项验证；未执行的平台必须明确记录为未验证。
- 里程碑验收证据保存在 `docs/verification/`。
