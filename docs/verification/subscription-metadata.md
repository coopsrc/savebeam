# 订阅条目信息与滚动条端部

日期：2026-10-23（Asia/Shanghai）；任务 SUB-METADATA-T1。

## 原因与实现

- 本机 yt-dlp 2026.10.21 的 B 站合集 flat-playlist `_get_entries` 仅生成视频 URL/ID，未携带 API 中的逐条标题和时长；应用原来直接存成“未命名视频”。已通过本机提取器离线输入重现，并与 [yt-dlp 官方 B 站提取器](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py) 对照。
- 现在轻量检查仍用于新增 ID/重排，不一次深入全部 1000 项。展开列表或检查已展开系列后，按每批最多 5 条、每轮自动最多 50 条补全缺失标题；额外项目或时长可点击“继续 / 重试读取信息”。始终 skip-download，沿用全局网络/Cookie 授权，UI 不显示或接收完整媒体 JSON。信息读取不会创建任务。
- schema v14 只增加可空 `subscription_entries.duration_seconds`。标题/时长保存在原记录；每次轻量检查缺失字段时保留已有值。旧占位标题在界面显示“标题待补全”，不作为真实视频名。信息写回按订阅 ID、视频 ID、原始位置和可用状态验证；失败、重复/错 ID、嵌套列表、重排、取消订阅时不写错条目，不改变已下载状态或检查时间。前端也验证返回 ID/位置，并防止迟到的空列表覆盖已补全信息。
- 前端所有展开列表的读取共用串行通道，后端独立互斥，避免一页展开多个系列时同时启动大量进程。隐藏/收起停止后续批次，当前批次允许保存结果；返回不重置自动预算。失败等待明确重试；勾选、下载高级设置和滚动不因元数据到达而重置。
- 原订阅列表是裸 `overflowY:auto`，并未使用下载页滚动条规则，因此 macOS 仍显示带方形端部的原生轨道。现使用最高 320px 的 ScrollArea，轨道上下各 6px 内缩、透明背景和圆角滑块；浅色/深色沿用主题色。未修改应用侧栏或下载页滚动结构。

## 验证证据

- Rust 全量 169 项（`cargo test --manifest-path src-tauri/Cargo.toml --locked -- --test-threads=2`），新增测试覆盖 v13→v14 迁移保留已有记录、缓存重开/空检查不退化、失败不覆盖、重排/取消后不写回、投影 ID/位置/重复/嵌套及隐私字段、1–1000 原序号和每批 5 条参数限制；普通前 50 项边界未放宽。
- 前端 46 项测试；新增覆盖空/旧占位标题、时长格式、元数据匹配与选择标记保持、迟到空结果不覆盖缓存，以及不跨订阅来源合并信息。
- `verify-subscription-metadata-ytdlp.mjs /opt/homebrew/Cellar/yt-dlp/2026.10.21/libexec/bin/python`：真实本机 yt-dlp 离线重现 B 站缺标题；自定义 fixture 提取器只深入第 72、1000 项，返回正确标题/时长和原序号，其余 998 项不深入；没有请求真实站点、下载媒体或读取用户 Cookie。
- `verify-subscription-metadata-ui.mjs` 共 11 组：17 条自动补全、失败重试、隐藏时只结束当前批次、停止/继续、65 条列表自动上限 50 且路由往返不重置预算；三平台明暗预览分别验证顶部/底部轨道间距、完整圆角、PageDown 与拖动滑块。缓存完整时没有补全请求；补全前勾选在隐藏/返回/标题到达后保持。无 pageerror，诊断内容不显示。
- 已查看 macOS 浅色顶部/底部与深色底部截图，轨道无方框，滑块上下圆角与留白完整。临时截图：`/tmp/savebeam-sub-scroll-macOS-light-top.png`、`/tmp/savebeam-sub-scroll-macOS-light-bottom.png`、`/tmp/savebeam-sub-scroll-macOS-dark-bottom.png`。
- 原有 `verify-subscriptions-ui.mjs` 6 组与 `verify-navigation-retention-ui.mjs` 通过：勾选、每次代理/高级快照、取消订阅、检查失败、搜索、外层/内层滚动与侧栏往返未退化。
- TypeScript/Vite、Prettier/rustfmt、ESLint、Clippy 验证；保留既有 Vite 超过 500kB 提示，不声称完成分包。

## 验收边界

- 以上 UI 为 Chrome fixture + 三平台样式预览，不等同于 macOS 原生 WebView、Windows 或 Linux 实机验收。此次没有读取用户订阅数据库、Cookie 或修改实际媒体，也没有发布/推送。
- 真实站点可能要求 Cookie、代理或触发限流；失败会显示原因并保留缓存，不保证所有视频信息均可读取。建议重启开发应用使 Rust 新命令与 v14 迁移生效，再展开原有订阅；无须删除或重新订阅。
- 现显示标题、时长、视频 ID 和原状态，不新增逐项封面下载或分辨率/码率策略；后两者不属于本轮修复。时长未知时不伪造，最终媒体标题及格式仍以实际下载解析为准。
