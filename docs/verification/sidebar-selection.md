# 侧栏统一选中样式

日期：2026-10-22。

macOS、Windows、Linux 的 `selectionStyle` 均为 `rounded-fill`；共享 10px 圆角、浅色强调背景、强调色图标，不再渲染 Windows 左侧强调线或 Linux 专用背景。平台字体、侧栏宽度、导航项高度、快捷键和文件操作文案保持原值。

`pnpm check` 通过：25 项前端测试、125 项 Rust 测试，以及格式、ESLint、Clippy 和构建；保留既有 Vite 大包提示。

```sh
node scripts/verify-sidebar-selection-ui.mjs /path/to/playwright/index.mjs http://127.0.0.1:1421/
```

12 个浏览器预览场景覆盖 3 个平台 profile × 1280/800px × 明/暗主题；逐一切换任务、设置、下载，确认唯一选中项、10px 圆角、对应主题的浅色填充、无强调线，导航项高度仍分别为 34/42/40px，宽侧栏为 216/232/224px、紧凑侧栏为 56px，无 pageerror。

截图为 `/tmp/savebeam-sidebar-macos.png`、`/tmp/savebeam-sidebar-windows.png`、`/tmp/savebeam-sidebar-linux.png`。平台预览不等同于 Windows/Linux 原生系统验收。
