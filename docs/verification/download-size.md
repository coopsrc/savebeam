# 下载大小显示验证

日期：2026-10-22。

- 大小位于现有操作行、开始按钮左侧；没有新增预计输出卡片或文件名预览。
- 单视频以选中的视频与音频文件大小（优先准确值，其次近似值）合计，含音轨视频只算一次。任一轨道未知则不显示部分总量。
- 系列先平铺解析列表，只有点击“估算大小”才用 `--no-flat-playlist --playlist-items` 对选择的原始序号解析；格式与系列下载一致，为 `bestvideo+bestaudio/best`。估算保留 `--skip-download`，不会下载媒体。
- 每次 1–50 个不重复序号，只投影 ID/字节大小，不返回直链、请求头或 Cookie。未知、ID 变化、重复条目、缺失音轨、溢出不会成为虚假完整总量。
- 后端全局并发保护、60 秒进程超时和 JSON 上限沿用；前端更换链接/重新解析后忽略旧响应，勾选变化只重新汇总当前条目。
- MP3 转换大小待定；所有数值为近似成品媒体大小，不含附属文件、中间文件和封装开销。

验证命令：`pnpm check`；`node scripts/verify-download-size-ui.mjs <playwright/index.mjs> http://127.0.0.1:1421/`；`node scripts/verify-download-layout-ui.mjs <playwright/index.mjs> http://127.0.0.1:1421/`。

UI 使用本地 fixture，不访问视频网站或真实 Cookie。覆盖音轨变更、稀疏序号、部分未知、完整总量、重试失败和 MP3 未知；布局脚本覆盖平台、宽度、主题、滚动与开始按钮位置。截图：`/tmp/savebeam-size-single.png`、`/tmp/savebeam-size-series.png`。真实网站可能缺少码率/大小信息，无法保证精确预报；原生 WebView 仍需人工确认。
