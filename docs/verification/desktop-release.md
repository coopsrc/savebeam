# 桌面发布候选与生命周期验收

日期：2026-11-14；macOS Apple Silicon。**M8 整体验收未通过；以下为实现/本机候选验证，不能推断 Windows 或正式签名通过。**

## 发布实现

- 手动 Windows x64 NSIS / macOS arm64 APP+DMG 流水线；依赖 Actions 固定 commit，环境/主分支限制、最小权限、临时凭据清理，无自动公开发布。
- unsigned 模式与 signed 模式分离；signed 缺少 Developer ID/Notary 或 Windows 发行证书时失败，不降级为 unsigned 并标成功。
- 签名包及版本使用独立 Minisign 校验；构建产物带 SHA256SUMS、构建元数据和法律声明。开发 CLI 默认不编入应用包；收集器再次检查只含主程序。
- `latest.json` 生成要求双平台、OS 签名已验证、原始字节哈希一致、签名有效且绑定版本。未签名候选不能进入该公开元数据。
- 组件签名工作流增加准确清单字节对应的审核门禁；未完成平台与 notices 审核即拒绝签发。

## 本机实际结果

| 项目           | 结果与范围                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release 构建   | `pnpm tauri build --config /tmp/savebeam-final-release.json -- --locked` 通过；APP 10.30 MiB、DMG 4.93 MiB、updater tar.gz 4.97 MiB。                       |
| 包内容         | macOS arm64，`Contents/MacOS` 仅 `savebeam`；法律文件在 `Contents/Resources/legal/`。                                                                       |
| 本地包完整性   | ad-hoc `codesign --verify --deep --strict` 通过；DMG 校验、只读挂载及复制到临时 Applications 目录通过。**无 Developer ID / Notary / Gatekeeper 正式验收。** |
| 更新包         | 使用固定公钥校验通过；篡改字节拒绝，宣布版本不同于签名版本拒绝。未替换用户当前应用。                                                                        |
| 原生启动       | 独立 identifier、显式 `/tmp` appDirectoriesOverride 的 debug 验证包成功启动，建立 schema 21 / integrity ok。不是正式安装包启动验收。                        |
| 原生升级/重启  | 在该隔离 profile 中恢复 v20 结构，重启迁移至 21；并发偏好与自定义组件路径保留，完整性检查通过。                                                             |
| 数据备份与移除 | 对隔离 profile 使用 SQLite backup；删除临时安装的应用 bundle 后 profile 仍在且完整。未删用户下载文件/数据库。                                               |
| 数据/任务回归  | 198 Rust 测试通过、1 ignored，覆盖旧结构升级、文件缺失恢复、终态历史、任务快照、组件失败回滚及 probe 子进程超时清理。                                       |
| UI 与策略      | 74 前端测试通过；中英文应用更新、政策、反馈、并发设置 UI 回归通过；设置 Tab 的原有导航/草稿/滚动和三平台预览已通过。                                        |
| 工作流         | actionlint 1.7.12 校验通过；本机验证配置与产物/清单生成的拒绝边界。远端 workflow 未运行，不等同于 Windows 编译成功。                                        |
| 第三方站点     | 官方原生 yt-dlp 读取用户提供的 Bilibili BV1uVy7BCErV（P1）在当前网络返回 HTTP 412；未提供 Cookie 或规避限制，未声称真实站点下载通过。                       |

另以应用管理的 Deno 读取 YouTube Sc9HOaCIrmU，直连在 60 秒内未完成，已停止整个测试进程组。没有使用 Cookie/代理或规避限制，不能据此声称 YouTube 下载已验证。

最终本机候选保存在 `src-tauri/target/release/candidate/`（Git 忽略），包括 DMG、updater tar.gz、sig、SHA256SUMS、build-info 和 notices。此包仅供本机内部验证。

```text
e137c461adcdd01667798e63bacba0feb9bc2c9375323d79e4b2558ff4adf71b  Savebeam_0.1.0_aarch64.dmg
28ad515a29cf1bf6a9b6d2edc62ef35dacb6d8507a45893c2de46c6a860add45  Savebeam.app.tar.gz
```

## 尚未关闭的实际门禁

1. 项目没有 Developer ID Application / Notary 或 Windows 代码签名凭据，不能执行正式签名验收。
2. Windows 原生构建、安装/升级/卸载、进程取消及辅助技术未运行；macOS 正式 release 安装启动、跨版本真实更新和 VoiceOver 人工巡检仍未完成。屏幕捕获工具未能获取验证窗口图像，不以此替代人工巡检。
3. GitHub 仓库当前为空且公开，本地尚未配置 remote；没有首次公开推送、Release 或 workflow dispatch。
4. 组件各目标的真实二进制/notices 审核及生产签名目录端到端仍打开；当前审核 JSON 故意不批准发布。
5. [依赖审计](dependency-audit-2026-11.md) 中的 Linux GTK 风险与一项 npm 作者许可来源复核仍需处理，不能把 notices 文本“已生成”当成法律审核全部关闭。

发行凭据与全新环境就绪后，按 [发布说明](../releases/desktop-release.md) 执行候选构建、双平台安装/升级/卸载和带匹配数据库快照的回滚矩阵。M6/M7/M8 全部门禁关闭前，不创建里程碑完成提交。
