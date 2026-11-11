# 窗口缩放后右侧列表溢出修复

2026-11-11，macOS 开发环境。用户截图显示窗口缩窄后右侧视频条目溢出卡片，覆盖底部操作。

复现：新增隔离测试在读取 17 项合集详情期间按 1600→1280→1200→1199→1440→1280 连续缩放。在 WebKit 26.0（Playwright build 2215）测到右侧卡片高 400px，内部 Stack 却高 1369px、列表高 1167px，确认框跟随内容越界；同一场景 Chrome 正常。旧静态尺寸检查不足以覆盖 WebKit 的这次布局失约束。

修复仅涉及下载页双栏 CSS：右卡片相对定位，内部 Stack 按既有 padding 约束四边，获得明确高度；固定区保持自然高度，列表 `flex: 1 1 0px` 填充剩余空间并独立滚动，卡片及内部内容防溢出。保留右栏与左侧媒体/画质卡片整体上下对齐、右下独立开始按钮，窄窗口恢复原正常文档流。不改选择、画质匹配、下载参数或数据持久化。

验证：

- `verify-download-resize-ui.mjs` 支持 `chromium`/`webkit` 参数，覆盖两引擎×合集/20 P×中文亮色/英文暗色共 8 场景，每场连续缩放，详情分批补全长标题/规格，包含未匹配条目提示、画质展开/收起、滚动到末项。检查列表/确认区都位于卡片内部、开始操作区在卡片下方、两栏上下对齐且无横向溢出。
- `verify-download-layout-ui.mjs` 原单视频/系列静态尺寸、空/单/50 项连续缩放、菜单及提交回归通过；`verify-playlist-quality-ui.mjs` 12 个策略/独立多 P/部分入队场景通过。
- 前端 ESLint、TypeScript/Vite 构建、64 项单元测试通过；保留既有 bundle 大小提示。无 Rust 修改，不重复执行 Rust 全量测试。
- 已查看 WebKit 底部边界截图 `/tmp/savebeam-resize-webkit-collection-zh-CN.png` 与 `/tmp/savebeam-resize-webkit-multipart-en-US.png`，确认列表末项留在滚动区，确认框和开始操作无遮挡；其他截图按引擎/类型/locale 保存同目录。

仅使用本地 IPC fixtures，不访问真实视频、Cookie 或用户数据库，不新增应用依赖。WebKit 浏览器回归提高 macOS 渲染覆盖，但不等同于所有系统版本的原生 Tauri 窗口或 Windows/Linux 实机验证。
