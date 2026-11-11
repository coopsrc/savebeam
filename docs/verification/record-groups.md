# 合集及多 P 的任务/历史归组

2026-11-11，macOS 开发环境。用户确认同一来源后续下载“合并”，忽略未完成的第二句，不扩展整组批量操作。

## 行为

- 系列合集、独立多 P 在任务和历史中各显示一条默认收起的分组，补下、订阅更新及版本重下沿用来源组。展开后保留独立子项及既有操作；普通单视频保持独立。
- 任务摘要按当前可见任务统计数量、状态及完成条数进度；历史显示记录数、最近完成时间及大小合计。子项按原始项/P 序号排列，同项历史版本仍独立保留。搜索可匹配父标题、子标题或路径，筛选后显示当前结果数。
- 首次展开才挂载子卡片；展开后收起不卸载。任务页增加会话保留，任务/历史分组展开状态、内部滚动及弹窗草稿随侧栏往返保留。隐藏页或收起分组不留下可见版本/删除弹窗。

## 数据边界

SQLite v16 增加可空 `download_tasks.group_json`。Rust 由真实父来源及显示提示创建、校验上下文，保留到队列、重开、重试和版本重下。Bilibili 合集使用空间路径及 sid，多 P 使用 BV；YouTube 列表的 watch/playlist 链接按 list 合并。已知跟踪参数不拆组；不同来源、不同合集或不同类型不合并。未知站点只保守规范化 URL，不按标题或文件路径推断身份。

旧任务只按已保存的 playlist/分 P 上下文推断；没有父标题时显示来源链接，普通单视频不猜测归组。升级不访问站点，不改写原格式、选项、成品路径。分组无独立下载进程，不合并或删除原任务/历史数据库行。

子项删除仍是终态任务软隐藏；历史删除仍默认保留文件，可显式选择移入回收站。原版本关联、其他子项、订阅完成台账和输出目录边界不变。

## 验证

- `pnpm lint:frontend`、`pnpm build`、`pnpm test:frontend`：通过，63 项；新增归组排序、跨批次/版本、真实标题优先及部分失败汇总测试。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked -- --test-threads=2`：182 通过，1 个既有手动测试忽略。新增 v15→v16 幂等升级、稳定来源键、普通单视频隔离及文件数据库重开/历史搜索/单项隐藏删除验证；既有分 P、队列重试和来源版本测试通过。
- `scripts/verify-record-groups-ui.mjs`：1280×800，中文亮色/英文暗色。验证默认收起、不提前读取整组已完成成品、实时补下后父项数量不增加、部分失败进度、20 P 内部滚动及侧栏恢复、隐藏任务删除弹窗及返回恢复、单项任务/历史删除、旧版本保留、搜索和成品 IPC 参数。
- `verify-task-actions-ui.mjs`：10 个既有任务操作场景通过；`verify-media-versions-ui.mjs`：9 个状态/错误/保留场景通过；`verify-navigation-retention-ui.mjs`：既有历史/订阅草稿及滚动保留通过；`verify-playlist-quality-ui.mjs`：12 个系列/分 P 策略及入队场景通过。
- 本次截图 `/tmp/savebeam-task-groups-zh-CN.png`、`/tmp/savebeam-task-groups-en-US.png`、`/tmp/savebeam-record-groups-zh-CN.png`、`/tmp/savebeam-record-groups-en-US.png`，已检查中英文亮暗排布。构建保留既有大于 500 kB 的 bundle 提示。

UI 使用隔离 IPC fixture 和临时 1421 开发服务器；数据库测试使用临时文件/内存，不读取用户数据库、Cookie，不下载媒体或删除用户文件。未进行 Windows/Linux 原生或真实站点下载验收。
