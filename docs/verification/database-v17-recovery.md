# v17 封面缓存字段兼容恢复

2026-11-11，用户报告本地数据库打开/迁移失败。

只读检查确认：数据库完整性检查为 `ok`、`user_version=17`，`record_artwork` 仅有 `artwork_id` 和 `data_url`，缺少 `last_used`。上一任务开发过程中同一 v17 迁移先后有两种形状；已运行的数据库不会重放相同版本的迁移。该差异来自应用代码，无需要求用户清空数据。

恢复方案：冻结 v17 的初始两列结构，新增 v18 为缓存添加 `last_used NOT NULL DEFAULT 0`；兼容已经包含该列的另一种 v17，不重复添加，也不修改已有时间值。迁移按既有事务边界更新版本。任务、历史、设置、订阅、版本关联、图片内容和缓存引用均不删除。不执行用户数据库手动 SQL 修复或自动重置。

新增两种 v17 结构的升级/重复打开回归，核对历史路径、缓存引用及已有时间值保留；Rust 全量测试、Clippy 和格式检查通过。开发应用监听源码后自行重启并执行正常迁移，随后只读检查确认用户库为 v18、`last_used` 存在且 `quick_check=ok`；未手动重置或删除文件。

用户确实希望重置数据库时：先完全退出 Savebeam，再备份移走 `~/Library/Application Support/com.coopsrc.matrix.savebeam/` 中的 `savebeam.sqlite3` 及存在的 `savebeam.sqlite3-wal`、`savebeam.sqlite3-shm`。重新启动生成新库，清除本地任务、历史、订阅、数据库设置和封面缓存；不会删除下载目录中的媒体，WebView 保存的语言/主题偏好也不随数据库重置。
