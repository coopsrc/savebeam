# 统一桌面侧栏尺寸

日期：2026-10-23（Asia/Shanghai）。

- macOS、Windows 和 Linux 共用现有 macOS 尺寸：展开 216px，紧凑 56px，导航项最小高度 34px；共享圆角选中表现、间距和内边距不变。
- 字体、Command/Ctrl 快捷键和 Finder/文件资源管理器文案仍分别保留。只统一导航几何尺寸，不改变下载逻辑、IPC、数据库或原生最小窗口。
- 新增纯配置单测，检查三平台尺寸相同、字体/快捷键/文案仍独立；原 profile 的导出接口兼容保留。
- `pnpm build`、`pnpm lint:frontend`、38 个前端单测及格式检查通过；保留既有大包提示，未改 Rust，未重跑 Rust 测试。
- `verify-download-layout-ui.mjs` 通过：1280×960 展开侧栏和 800×960 紧凑侧栏下逐一切换 macOS/Windows/Linux，断言三平台侧栏宽高、五个导航项坐标/尺寸以及工作区起点/宽度完全相同。展开宽为 216px，紧凑宽为 56px；系列双栏、策略菜单、单/系列不同宽度、0/1/50 项和缩放回归同时通过。
- `verify-sidebar-selection-ui.mjs` 同步为共享尺寸后，三平台 × 展开/紧凑 × 明/暗共 12 个场景通过，任务/设置/下载切换、选中样式与导航最小高度检查均正常。
- 截图 `/tmp/savebeam-sidebar-{macOS,Windows,Linux}-{full,compact}.png`，已目视检查 Windows 展开侧栏。均为本机浏览器 fixture；不替代 Windows/Linux 原生实机验收。
