# 合集内分 P 下载验证

2026-10-23，macOS 日常开发环境。

## 问题与方案

示例合集 `306979414_6546672` 的第 13 项 `BV1uVy7BCErV` 包含 P1 解说版、P2 纯享版。外层 `--playlist-items 13` 会继续过滤内部列表，导致内部为空；嵌套对象还会省略 `playlist_index`，不能误报为 ID 已变化。

现在通过根 `requested_entries` 核对外层位置和 ID，单独读取父 BV 的轻量 P 清单，独立按 5 P 读取格式。列表原地展示两个可勾选的子项，分别继承或覆盖画质、显示规格和大小。任务使用内层 P 序号和子 ID guard，命名保留原合集目录、外层序号和 P 序号。

schema v15 仅新增可空 `download_tasks.playlist_part_json`，保存原合集 URL/名称/ID、父 BV/序号、P 序号和数量。旧任务 NULL，不重写原参数或移动文件。P 任务快照经重开、取消/恢复/重试和历史版本重下保留。

订阅仍按父视频展示，“选择画质与分 P”进入下载页选择。订阅快速下载入口尚不自动拆分；执行 guard 不会下载错误替代视频，失败提示提供此入口。完成台账记录子 P，仅所有已知 P 完成才登记父视频；活跃父/子任务防重。

## 自动验证

格式检查、ESLint、TypeScript/Vite 构建、Clippy 均通过。全量 Rust 175 项通过（另 1 项联网测试默认忽略，已单独运行通过），前端 48 项通过。保留现有 Vite 单包超过 500 kB 提示，不属于本次功能范围。

- Rust：分 P 独立 selector/ID guard、真实形态无外层 index 的位置映射、重排/错误映射拒绝、重复/非法身份及嵌套拒绝。
- 文件数据库重开、任务取消/恢复/重试、高级快照/代理/画质及版本重下上下文。
- 订阅只完成 P1 不标记父视频，P2 完成并刷新后才标记父视频；旧 schema 迁移及原有回归。
- 前端单元测试：顺序、父选择展开、P 独立勾选、画质覆盖继承、部分入队后不重选已入队 P。
- `verify-playlist-quality-ui.mjs`：7 个原有场景、3 个分 P 场景（正常、部分入队、读取失败），含侧栏往返、单独画质与估算大小。
- 设置页回归确认不展示全局音频选项；本次下载高级弹窗仍支持音频选择。原有设置、订阅/元数据 UI 回归通过。
- `verify-playlist-parts-ytdlp.mjs`：真实 yt-dlp 离线验证普通/特殊合集名称的目录一致、百分号不插值、路径不逃逸、字幕/JSON/封面同前缀。不访问媒体。

## 真实站点元数据

本机 yt-dlp 2026.10.21，显式直连、忽略配置、不读取 Cookie、不下载媒体。Rust 实际链路通过：外层解析第 13 项、发现两 P、独立读取两 P 标题/可用格式、匹配规格和估算大小。

可选测试（默认忽略，CI 不依赖真实站点）：

```sh
SAVEBEAM_LIVE_YTDLP=/opt/homebrew/bin/yt-dlp cargo test --manifest-path src-tauri/Cargo.toml --locked services::playlist_parts::tests::live_bilibili_collection_part_metadata -- --ignored --exact --test-threads=1
```

## 验收边界

没有真实下载视频、读取用户 Cookie 或发布软件，测试使用独立数据库而非用户数据库。原生 macOS WebView 实际下载/合并，以及 Windows/Linux 原生环境仍需手动验收。当前仅一层 Bilibili BV 分 P，P 数量大于 50 明确拒绝；展开列表及单批最多 50 个成品，不支持任意递归或分页。
