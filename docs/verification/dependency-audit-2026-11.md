# 发布依赖与声明复核

日期：2026-11-14；macOS Apple Silicon。与 2026-10 的报告并存，本报告为当前锁文件结果。

## 整改与验证

- `rusqlite 0.41.1` / bundled `libsqlite3-sys 0.39.1`（SQLite 3.54.1），关闭 [RUSTSEC-2026-0459](https://rustsec.org/advisories/RUSTSEC-2026-0459.html) 的恶意数据库/WAL 内存泄露问题。
- Tokio `1.54.1`、rustix `1.1.6`，关闭 [Interval 竞态](https://rustsec.org/advisories/RUSTSEC-2026-0384.html) 和 [xattr 未初始化内存](https://rustsec.org/advisories/RUSTSEC-2026-0486.html) 问题。
- ZIP 升级至稳定 `9.5.1`，关闭旧 2.6.1 的四项提取告警。适配 fallible 名称解码，继续手动限长读取、拒绝重复/符号链接及固定执行权限，不调用通用 archive extract。
- ESLint/TypeScript ESLint 更新，针对尚依赖 minimatch 10 的上游使用显式 `pnpm-workspace.yaml` override 到 `11.0.8`。`pnpm audit --registry=https://registry.npmjs.org --json`：242 依赖，0 告警（包含开发依赖）。ESLint 及全部 70 个前端测试通过。
- Rust 全回归：197 passed、1 ignored；数据库迁移/恢复、封面缓存、队列和 ZIP 恶意条目等回归继续通过。Clippy、前端构建通过。
- OSV `querybatch` 对完整锁文件再次扫描；仅剩下表中的 Linux 栈告警，没有把未扫描或网络失败解释为通过。

## 当前剩余扫描结果

| 包                                                          | 告警                                    | 处理                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| glib 0.18.5                                                 | GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429 | Linux GTK 栈 VariantStrIter soundness，当前 macOS/Windows 发行目标不编入。Linux 发行前仍需上游栈升级或经过审查的可达性整改，不做全局豁免。 |
| proc-macro-error 1.0.4                                      | RUSTSEC-2024-0370                       | 构建依赖不再维护，跟踪 Tauri/GTK 上游升级。                                                                                                |
| zbus_names 4.3.5 / zvariant 5.15.1 / zvariant_derive 5.15.1 | RUSTSEC-2026-0371 / 0370 / 0372         | Linux 专属包并入 zbus 6 后不再独立维护，尚非已报告的可利用漏洞。                                                                           |

## 许可证与来源

应用自身采用 Apache-2.0。生成器从锁定 Rust 全平台图（含构建依赖）和已安装 npm 生产图生成离线 notices，列出源包下载地址、元数据许可及对应完整文本。缺失文本会令生成失败。

`supplemental-notices.json` 保留发行 crate 的 `.cargo_vcs_info` 对应精确 Git commit、上游文本 URL、SHA-256 和说明；生成时复核文本哈希。r-efi/Stylo 使用其明确声明的标准 MIT/MPL 文本，并保留作者/声明原文。多重许可声明未推断为全部同时适用。

仍有一项来源复核：`react-remove-scroll-bar 2.3.8` npm 包声明 MIT，却没有 LICENSE，发布 gitHead 也无法从公开上游读取。已提供标准 MIT 文本和作者元数据并在 notices 中显式说明，但不能把它称为已取得该版本完整作者授权文本。正式发行前应向上游补取文件或经项目所有者审查替代版本。没有隐藏此门禁。

第三方可执行组件的打包依赖、FFmpeg 构建许可与 source offer 单独在组件发行审核中处理，本报告不替代其二进制再分发审查。
