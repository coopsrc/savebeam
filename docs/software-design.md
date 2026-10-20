# Savebeam 软件设计说明书

> 状态：Draft 1.1
> 更新日期：2026-10-20
> 适用项目：Savebeam Desktop
> 实施计划：[implementation-plan.md](implementation-plan.md)

## 1. 文档目的

本文档是 Savebeam 产品边界、技术选型、软件架构、交互设计、安全和数据策略的统一依据。任务、里程碑、提交规则和验收状态由《实施计划》单独管理；技术方案发生变化时，应先更新本文档，再调整实施计划和实现。

## 2. 产品定义

Savebeam 是一个本地优先的桌面媒体下载器。用户粘贴受支持的媒体链接，查看媒体信息和可用格式，选择下载选项，并在本机完成下载、合并和后处理。

### 2.1 核心价值

- 本地运行，不建设云端下载服务。
- URL、Cookie、下载历史和文件保留在用户设备上。
- 提供比命令行更易用的任务队列、进度、错误提示和组件管理体验。
- 下载引擎与 GUI 解耦，便于独立更新和故障隔离。

### 2.2 首发平台

- macOS，Apple Silicon 优先。
- Windows 10/11，x64 优先。
- Linux 作为后续桌面目标，优先支持 Ubuntu/Debian。

日常开发、调试和任务级验证统一在 macOS 上进行。Windows 和 Linux 的平台验证通过 CI、里程碑验收和发布前真实设备测试补充，不要求每个日常任务都在三个平台重复执行。

### 2.3 明确不在首版范围内

- Android 和 iOS 本地下载版本。
- 云端解析、云端代下载、账号系统和跨设备同步。
- DRM 破解、密钥提取、付费墙绕过。
- 文件分享、内容发布和内置媒体交易。
- 浏览器扩展和浏览器 Cookie 自动读取。
- 插件市场及第三方脚本执行。

## 3. 设计原则

1. **本地优先**：用户数据默认不离开设备。
2. **最小权限**：React 前端不能直接执行任意命令或访问任意文件。
3. **组件解耦**：yt-dlp、FFmpeg、ffprobe 和可用的 JavaScript runtime 作为独立外部程序运行。
4. **结构化通信**：优先使用 JSON、固定进度模板和稳定字段，不解析面向人的普通日志。
5. **来源可追溯**：记录组件版本、路径、来源、校验值和安装方式。
6. **失败可恢复**：任务可取消、失败可重试、组件更新可回滚。
7. **合规可见**：组件提供者、许可证和源代码地址在应用内可查看。
8. **先桌面后扩展**：不为了尚未确定的移动端牺牲桌面实现质量。

## 4. 当前技术基线

项目当前已经使用以下基础技术并通过 `pnpm tauri dev` 启动验证：

| 层级           | 技术                                                  |
| -------------- | ----------------------------------------------------- |
| 桌面容器       | Tauri 2                                               |
| 前端           | React 19、TypeScript、Vite                            |
| UI 组件        | Mantine、Tabler Icons                                 |
| 前端状态与导航 | Zustand、React Router `HashRouter`                    |
| 包管理器       | pnpm                                                  |
| 本地核心       | Rust 2024 Edition                                     |
| IDE            | RustRover                                             |
| 应用标识       | `com.coopsrc.matrix.savebeam`                         |
| 下载引擎       | yt-dlp，后续按需安装                                  |
| 媒体处理       | FFmpeg、ffprobe，后续按需安装                         |
| JS runtime     | Deno 优先，也支持 Node.js、Bun、QuickJS，后续按需安装 |
| 持久化         | SQLite，里程碑 M5 引入                                |

新依赖必须有明确用途，不应仅因模板或未来可能需要而提前加入。

### 4.1 日常开发环境

- 主开发平台：macOS。
- 主开发架构：Apple Silicon。
- IDE：RustRover。
- Node 环境：nvm 管理，项目使用 pnpm。
- 本地开发命令：`pnpm tauri dev`。
- 任务级验证默认在 macOS 执行，并在任务提交中记录实际运行的检查。
- 涉及平台条件编译、路径、进程管理、安装包或系统集成的任务，不能仅根据 macOS 结果宣称 Windows/Linux 已验证。
- Windows/Linux 验证失败应独立记录和修复，不应在未经验证时推断跨平台行为一致。

### 4.2 平台支持基线

首个桌面版本采用以下最低支持基线：

- macOS 12.0 或更高版本，首发构建为 Apple Silicon。`bundle.macOS.minimumSystemVersion` 必须显式保持为 `12.0`，不能依赖 Tauri 默认值。
- Windows 10 1809（build 17763）或更高版本，首发构建为 x86_64。安装程序负责检测或安装 WebView2 Runtime。
- Linux 以 Ubuntu 22.04 LTS x86_64 或具有 WebKitGTK 4.1 的等价发行版作为兼容基线；Linux 正式安装包是否进入首发范围在 M8 前复核。

最低版本是产品支持边界，不代表仅凭编译成功即可宣称兼容。涉及路径、子进程、系统 WebView、安装器或签名的行为必须在对应平台完成验证。

### 4.3 标识与版本策略

- 正式 bundle identifier 为 `com.coopsrc.matrix.savebeam`，发布后不得因品牌文案或版本变化随意修改，否则系统会把应用视为不同产品。
- 应用版本遵循 SemVer `MAJOR.MINOR.PATCH`；1.0 前使用 `0.MINOR.PATCH`，不兼容的持久化或公开协议变化必须在发布说明中明确。
- `package.json` 的 `version` 是 Tauri 打包版本来源；`tauri.conf.json` 通过路径引用该文件，避免前端包与安装包版本分叉。
- `Cargo.toml` 的 crate 版本在发布任务中与应用版本同步；发布标签使用 `vMAJOR.MINOR.PATCH`。
- yt-dlp、FFmpeg、ffprobe 和 JavaScript runtime 保持各自版本，不跟随应用版本号；组件兼容矩阵独立维护。
- 数据库 schema version、IPC event schema version 和应用 SemVer 相互独立，升级时分别迁移和验证。

## 5. 总体架构

```text
┌───────────────────────────────────────────────┐
│ React UI                                      │
│ URL 输入 / 媒体预览 / 任务 / 历史 / 设置       │
└───────────────────────┬───────────────────────┘
                        │ 受限 Tauri IPC + Events
┌───────────────────────▼───────────────────────┐
│ Rust Application Core                         │
│                                               │
│ AppService                                    │
│ ├─ ComponentManager                           │
│ ├─ MediaInspector                             │
│ ├─ DownloadTaskManager                        │
│ ├─ ProcessSupervisor                          │
│ ├─ SettingsRepository                         │
│ ├─ HistoryRepository                          │
│ └─ UpdatePolicy                               │
└──────────────┬──────────────────────┬─────────┘
               │                      │
┌──────────────▼──────────────┐  ┌────▼─────────┐
│ External Components         │  │ SQLite       │
│ yt-dlp                      │  │ settings     │
│ FFmpeg / ffprobe            │  │ history      │
│ JS runtime (Deno preferred) │  │ task records │
└─────────────────────────────┘  └──────────────┘
```

### 5.1 信任边界

- React UI 只提交强类型请求，不接收或拼接任意 shell 命令。
- Rust 验证 URL、文件路径、格式 ID、任务 ID 和组件路径。
- 外部程序使用参数数组启动，禁止通过 `sh -c`、`cmd /c` 或字符串拼接执行。
- Tauri capability 仅开放实际需要的命令；不得向前端开放通用 shell execute 权限。
- 原始 stderr 只能进入脱敏诊断日志，不直接作为 HTML 渲染。

## 6. 前端设计

### 6.1 页面结构

```text
App
├─ 下载
│  ├─ URL 输入
│  ├─ 媒体信息预览
│  └─ 格式和下载选项
├─ 任务
│  ├─ 进行中
│  └─ 已完成/失败
├─ 历史
└─ 设置
   ├─ 下载设置
   ├─ 运行组件
   ├─ 隐私与日志
   └─ 关于与开源许可证
```

首版采用单窗口响应式布局，以 Mantine 提供基础控件、表单、弹窗和通知，以 Tabler Icons 提供图标。Savebeam 不直接使用 SwiftUI 或 WinUI 3，而是在共享 React 页面上遵循对应平台的信息架构和交互习惯。

### 6.2 UI 技术边界

- Mantine 是唯一基础组件库，不同时引入另一套完整设计系统。
- React Router 使用 `HashRouter`，避免桌面资源协议下的历史路由问题。
- Zustand 只管理任务、组件状态的前端投影及临时 UI 状态；Rust 核心仍是业务状态的唯一真实来源。
- 页面和 feature 不直接调用 Tauri API，所有 `invoke` 和事件监听集中在 `ipc/`。
- 不使用 Mantine 或 React 组件直接执行 shell、访问 SQLite 或扫描文件系统。
- 主题通过平台 profile 和 CSS design tokens 调整，不复制三套业务页面。

建议的前端目录：

```text
src/
├─ app/
│  ├─ App.tsx
│  ├─ router.tsx
│  ├─ providers.tsx
│  └─ theme.ts
├─ layout/
│  ├─ AppShell.tsx
│  ├─ Sidebar.tsx
│  ├─ PageHeader.tsx
│  └─ StatusBar.tsx
├─ platform/
│  ├─ platform.ts
│  ├─ macos.ts
│  ├─ windows.ts
│  └─ linux.ts
├─ features/
├─ pages/
├─ stores/
├─ ipc/
├─ types/
└─ utils/
```

### 6.3 共享应用外壳

所有桌面平台共享相同的信息架构：左侧导航区域、右侧内容区域、页面工具栏和可选全局状态栏。

```text
┌───────────────────────────────────────────────┐
│ 系统原生标题栏                                 │
├──────────────┬────────────────────────────────┤
│ 左侧导航区域  │ 页面工具栏                      │
│              ├────────────────────────────────┤
│ 下载         │                                │
│ 任务      2  │                                │
│ 历史         │           内容区域              │
│              │                                │
│              │                                │
│ 设置         │                                │
├──────────────┴────────────────────────────────┤
│ 可选：组件与全局任务状态                        │
└───────────────────────────────────────────────┘
```

- 下载、任务、历史为主导航项。
- 设置固定在导航区域底部。
- 任务导航项可以显示运行中数量 badge。
- 页面级主要操作放在内容区工具栏，不塞入全局导航。
- 首版保留系统窗口装饰，不自绘 macOS 交通灯或 Windows 窗口按钮。
- 默认窗口建议为 `1120 × 720`，最小窗口建议为 `800 × 600`。

### 6.4 平台 profile

平台差异通过 `PlatformProfile`、根节点 `data-platform` 和主题 token 表达：

```text
PlatformProfile
├─ sidebarWidth
├─ compactSidebarWidth
├─ navigationItemHeight
├─ selectionStyle
├─ systemFont
├─ revealFileLabel
└─ modifierKey
```

macOS 参考 SwiftUI `NavigationSplitView`：

- Sidebar 建议宽度 `216px`，导航项高度约 `34px`。
- 选中项使用圆角浅色填充，不使用 Windows 左侧强调线。
- 字体使用 `-apple-system` 系统字体栈。
- 页面标题、工具栏、sheet 和设置入口遵循 macOS 习惯。
- 文件操作文案使用“在 Finder 中显示”。
- 快捷键使用 `Command` 修饰键，并支持 `Command+,` 打开设置。

Windows 参考 WinUI 3 `NavigationView`：

- Sidebar 建议宽度 `232px`，导航项高度约 `42px`。
- 选中项使用 Fluent 风格填充和左侧强调线。
- 字体使用 `Segoe UI Variable`、`Segoe UI` 系统字体栈。
- 提示、确认和状态分别参考 `InfoBar`、`ContentDialog`、`ProgressBar` 的交互语义。
- 文件操作文案使用“在文件资源管理器中显示”。
- 快捷键使用 `Ctrl` 修饰键。

Linux 使用中性桌面风格：

- 保持同一侧栏与内容布局。
- 使用系统字体和普通不透明背景。
- 不默认模拟 Mica 或 macOS 毛玻璃。
- 文件操作文案使用“在文件管理器中显示”。

平台 profile 只改变表现、文案和快捷键，不改变下载状态机、数据模型或 IPC 协议。开发环境允许强制选择 profile，以便在 macOS 上检查三套视觉变量；这不等同于完成 Windows/Linux 原生验证。

### 6.5 窗口与导航响应规则

| 内容宽度    | 导航形态                                   |
| ----------- | ------------------------------------------ |
| `≥ 960px`   | 完整图标和文字导航                         |
| `760–959px` | `56px` 紧凑图标导航，文字通过 tooltip 提供 |
| `< 760px`   | 不作为正式支持尺寸；由最小窗口宽度避免进入 |

这是桌面应用，不为首版增加移动式汉堡菜单或覆盖式抽屉。窗口缩放不能导致主要操作、进度或错误信息不可访问。

### 6.6 共享交互规则

- 应用启动时不自动读取剪贴板；只有用户点击“粘贴”后才读取一次。
- 粘贴 URL 后不自动发起网络解析，用户点击“解析”或按 Enter 明确触发。
- 普通用户优先看到“最佳质量、1080p、720p、仅音频”，原始 format ID 放入高级格式列表。
- 组件缺失不阻止进入应用；在用户首次解析或下载时展示安装引导。
- 缺少 yt-dlp 时阻止解析；缺少 FFmpeg 或 JS runtime 时按实际能力降级并给出说明。
- 任务阶段分别显示准备、下载、后处理和完成；FFmpeg 合并阶段不能继续显示为“下载中”。
- 未知总大小使用不确定进度条，不显示虚假的 `0 B` 或百分比。
- 清除历史默认不删除媒体文件；删除实际文件必须使用独立操作并确认。
- 默认文件冲突策略为自动追加序号。
- 应用前台使用应用内通知，后台完成时才考虑系统通知，避免双重提醒。
- 首版不展示“暂停”能力，直到跨平台验证能够准确表达其语义。

### 6.7 前端状态划分

- 服务端状态：媒体信息、任务状态、组件状态，由 Rust 核心提供。
- UI 状态：当前页面、表单展开状态、筛选条件，仅保存在前端。
- 持久化设置：由 Rust Repository 保存，前端不直接操作数据库。

### 6.8 前端与 Rust 接口

建议的 IPC 命令：

```text
get_app_status
detect_components
inspect_media
create_download
cancel_download
retry_download
list_tasks
list_history
get_settings
update_settings
install_component
update_component
remove_component
select_custom_component
```

建议的事件：

```text
component://state-changed
download://state-changed
download://progress
download://log
```

事件载荷必须包含 schema version，便于后续兼容升级。

IPC 协议约定：

- Rust 命令名使用 `snake_case`；命令参数沿用 Tauri 默认映射，Rust 侧为 `snake_case`、前端调用侧为 `camelCase`。序列化到前端的结构字段统一使用 `camelCase`。
- Rust 命令统一返回 `CommandResult<T>`。成功时直接返回 `T`，失败时由 Tauri 序列化 `AppError`，不再增加第二层 success/error envelope。
- `AppError` 使用 `{ code, message, retryable, diagnostic? }`；`code` 为稳定的 `snake_case` 值，`message` 可直接展示，`diagnostic` 必须先脱敏且不能代替用户提示。
- 事件名使用 `domain://past-tense` 或 `domain://noun` 格式，并集中定义常量，业务代码不得散落字符串字面量。
- 所有事件统一使用 `{ schemaVersion, payload }` envelope；首版 `schemaVersion` 为 `1`。

## 7. Rust 核心设计

### 7.1 推荐模块结构

```text
src-tauri/src/
├─ lib.rs
├─ commands/
├─ domain/
│  ├─ component.rs
│  ├─ media.rs
│  ├─ download.rs
│  └─ error.rs
├─ services/
│  ├─ component_manager.rs
│  ├─ media_inspector.rs
│  ├─ download_task_manager.rs
│  └─ process_supervisor.rs
├─ infrastructure/
│  ├─ process/
│  ├─ storage/
│  ├─ database/
│  └─ platform/
└─ security/
   ├─ path_policy.rs
   └─ redaction.rs
```

### 7.2 下载引擎抽象

业务层不应散落 yt-dlp 命令参数。所有引擎调用通过统一接口完成：

```text
DownloadEngine
├─ inspect(url)
├─ start(options)
├─ cancel(task_id)
├─ validate_environment()
└─ engine_version()
```

首个实现为 `YtDlpProcessEngine`。接口存在的目的主要是隔离 yt-dlp 和业务层，而不是承诺首版支持多个下载引擎。

### 7.3 进程管理

`ProcessSupervisor` 负责：

- 为每个任务保存进程句柄和状态。
- 逐行读取 stdout/stderr，避免缓冲区阻塞。
- 将结构化进度转换成领域事件。
- 用户取消时终止完整进程树，避免遗留 FFmpeg。
- 应用退出时处理仍在运行的任务。
- 对异常退出、超时和不可识别输出提供统一错误。

首版不承诺真正意义上的“暂停”。yt-dlp 的断点续传和重新开始任务可以提供接近恢复的体验，但 UI 不应把取消后重试描述为无损暂停，除非经过跨平台验证。

## 8. 组件管理设计

### 8.1 必需组件

| 组件               | 用途                                                                        | 必需性               |
| ------------------ | --------------------------------------------------------------------------- | -------------------- |
| yt-dlp             | URL解析与媒体下载                                                           | 必需                 |
| FFmpeg             | 合并与后处理                                                                | 高质量音视频下载必需 |
| ffprobe            | 媒体信息检查                                                                | 推荐，与 FFmpeg 同源 |
| JavaScript runtime | yt-dlp JavaScript challenge 支持；Deno 优先，也可使用 Node.js、Bun、QuickJS | 完整站点兼容推荐     |

### 8.2 三种组件来源

```text
AppManaged  应用下载并管理
System      winget / Homebrew / apt 等管理
Custom      用户选择已有可执行文件
```

来源一旦确定，更新职责也随之确定：

- `AppManaged`：应用负责下载、校验、更新、回滚和删除。
- `System`：应用仅检测并展示更新命令，不覆盖系统文件。
- `Custom`：应用仅检测，用户自行维护。

### 8.3 应用管理安装

- yt-dlp：使用其官方 GitHub Releases。
- JavaScript runtime：应用管理方式默认安装 Deno，并使用其官方 Releases；系统或自定义方式可复用 Node.js、Bun、QuickJS。
- FFmpeg：使用 FFmpeg 官网各平台下载入口列出的可信构建提供者。
- 下载地址和哈希来自受签名保护的组件清单。
- 下载到临时文件，校验通过后再原子移动到组件目录。
- 新版本通过 `--version` 和基本能力测试后才切换为当前版本。
- 至少保留一个上一版本用于回滚。

FFmpeg 页面入口：

- Linux：<https://ffmpeg.org/download.html#build-linux>
- Windows：<https://ffmpeg.org/download.html#build-windows>
- macOS：<https://ffmpeg.org/download.html#build-mac>

UI 应表述为“从 FFmpeg 官网列出的构建来源下载”，并展示实际构建提供者，不应把第三方构建描述成 FFmpeg 项目官方编译的二进制。

### 8.4 系统包管理器

- Windows：winget。
- macOS：Homebrew。
- Ubuntu/Debian：apt。
- 其他 Linux：根据 `/etc/os-release` 提供相应说明。

应用不收集管理员密码，也不静默执行 `sudo`。首版提供命令展示、复制、打开终端和重新检测。系统仓库版本可能过旧，必须执行最低版本和能力检查。

### 8.5 查找顺序

1. 用户明确选择的自定义路径。
2. 应用管理的当前版本。
3. 系统常见安装位置。
4. 当前进程可见的 `PATH`。

macOS 从 Finder 启动时不能假设继承交互式 shell 的 PATH；Windows 包管理器安装后也可能需要重新启动应用才能读取新环境。

## 9. 下载工作流

### 9.1 媒体检查

```text
用户输入 URL
→ 前端执行基础格式检查
→ Rust 进行 scheme/长度/策略校验
→ ComponentManager 检查环境
→ yt-dlp 输出 JSON
→ Rust 过滤并转换为 MediaInfo
→ 前端展示媒体与格式
```

### 9.2 下载任务

```text
用户提交 DownloadOptions
→ Rust 再次验证所有字段
→ 创建任务记录
→ 启动 yt-dlp
→ 接收结构化进度
→ 通过 Tauri Event 更新 UI
→ FFmpeg 后处理
→ 验证输出文件
→ 写入历史记录
```

### 9.3 任务状态

```text
Queued
Preparing
Downloading
PostProcessing
Completed
Failed
Cancelling
Cancelled
```

状态转换由 Rust 核心控制，前端不能直接修改任务状态。

### 9.4 错误分类

首版至少统一为以下用户可理解的错误：

```text
InvalidUrl
UnsupportedUrl
ComponentMissing
ComponentTooOld
VideoUnavailable
LoginRequired
PrivateContent
RateLimited
NetworkFailure
DiskFull
PermissionDenied
MergeFailed
Cancelled
Unknown
```

每个错误包含稳定代码、用户提示、是否可重试和脱敏诊断信息。

## 10. 数据与隐私

### 10.1 SQLite 数据

计划保存：

- 用户设置。
- 下载任务与最终状态。
- 下载历史、标题、来源 URL、输出路径和完成时间。
- 已知组件版本、来源和安装路径。

默认不保存：

- Cookie 内容。
- Authorization header。
- 带临时签名参数的媒体直链。
- yt-dlp 完整未脱敏日志。

### 10.2 Cookie策略

MVP 不读取浏览器 Cookie。后续首先支持用户显式选择 `cookies.txt`，并满足：

- 不复制进数据库。
- 不写入普通日志。
- UI 明确说明敏感性和账号风险。
- 传给 yt-dlp 后不产生额外永久副本。

### 10.3 日志脱敏

至少过滤：

- `Cookie`、`Authorization` 等 header。
- URL query 中的 token、signature、key 等字段。
- 用户主目录的完整路径，可在用户主动导出诊断包时选择保留。

## 11. 安全设计

- 仅允许 `http` 和 `https` URL；本地文件导入属于未来独立功能。
- 限制 URL 和文件名长度。
- 输出路径必须经过规范化和允许目录检查。
- 下载组件时验证 TLS、固定来源、架构和哈希/签名。
- 解压组件时防御 Zip Slip 和符号链接逃逸。
- 不执行从 yt-dlp 输出、媒体标题或远端元数据中得到的命令。
- Tauri CSP 在进入正式 UI 阶段启用，不保留 `csp: null` 到发布版本。
- 发布前审计 Tauri capability，删除未使用权限。

## 12. 开源许可证与内容合规

### 12.1 组件许可证

- 主安装包默认不包含 yt-dlp、FFmpeg 和 JavaScript runtime。
- 应用内提供组件名称、版本、来源、许可证、项目主页和源代码地址。
- 如果未来通过自有服务器/CDN、离线安装包或重新打包方式提供组件，应按再分发场景重新审核。
- FFmpeg 许可证取决于具体构建配置，不能只根据“FFmpeg”名称推断 LGPL或 GPL。
- GUI 与外部组件通过命令行、JSON和进度输出进行独立进程通信。

### 12.2 产品行为边界

- 不提供 DRM规避、密钥提取或付费访问控制绕过。
- 产品文案不使用“破解”“免费下载付费内容”等描述。
- 不使用第三方平台 Logo 暗示合作或授权。
- 使用条款明确要求用户仅下载其拥有权利、获得授权或法律允许保存的内容。
- 免责声明不能替代实际功能和营销层面的合规控制。

## 13. 测试策略

### 13.1 Rust 单元测试

- 组件版本解析和路径选择。
- 命令参数构造。
- 进度行解析。
- 任务状态转换。
- 错误分类和日志脱敏。
- 路径规范化和归档解压防护。

### 13.2 前端测试

- URL 表单验证。
- 组件缺失引导。
- 媒体格式选择。
- 任务状态和错误展示。
- 设置表单与无障碍键盘操作。

### 13.3 集成测试

- 使用假的 yt-dlp/FFmpeg 可执行程序产生确定性输出，不依赖真实网站。
- 验证进度事件、取消、错误退出和进程清理。
- 少量真实站点检查只作为手动兼容性测试，不作为稳定 CI 测试。

### 13.4 发布验证

- Windows 与 macOS 各执行一次全新环境安装。
- 验证无组件、系统组件、应用管理组件、自定义路径四种状态。
- 验证路径包含空格、中文和长文件名。
- 验证网络中断、磁盘空间不足和应用退出。
- 验证签名、公证、安装包升级和组件回滚。

## 14. 待决策的技术事项

以下事项必须在对应里程碑开始前决定：

- M2：各平台最低组件版本及系统路径清单。
- M4：默认格式策略、文件冲突策略和最大并发。
- M5：具体 SQLite crate 与 migration 实现。
- M6：各平台 FFmpeg 构建提供者和签名/哈希信任链。
- M8：应用签名主体、正式发行渠道和更新服务位置。

## 15. 文档维护关系

- 本文档只维护技术方案和架构决策，不维护任务完成状态。
- [实施计划](implementation-plan.md)维护任务、里程碑、提交规范和验收状态。
- `docs/verification/` 保存已经完成的里程碑验收证据。
- 技术方案变化时先更新本文档，再更新实施计划中的受影响任务。
