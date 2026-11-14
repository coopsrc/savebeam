# 首次公开推送与双平台 CI

日期：2026-11-14。用户明确授权首次推送公开源码及运行未签名检查，不创建或发布 Release。

- 首次通过现有 SSH 授权推送 `28ea66c` 到 `coopsrc/savebeam/main`；HTTPS OAuth 凭据缺少工作流写入权限，没有扩大其权限或替换凭据。
- 新仓库仅手动触发的构建工作流未注册，增加仅工作流自身在 main 修改时触发的 unsigned 检查；signed 仍仅手动启动。推送构建与 GitHub Release 发布保持分离。
- Windows 首轮因自动 CRLF 检出导致 210 项格式检查失败；新增 `.gitattributes`，以 `core.autocrlf=true` 的隔离克隆验证 LF 检出及 Prettier 全量通过。
- macOS 基线 CI 已通过。打包中的 notices 重生成发现本地 pnpm list 去重结果漏了 csstype/get-nonce/scheduler；改为遍历实际安装 manifest 的生产/peer/optional 闭包，585 依赖文本与干净 CI 一致。增加缺依赖拒绝、共享依赖与 UTF-8/LF 的 Python 回归。
- Windows 原生 Clippy 暴露 Unix 测试 imports/helper 缺 cfg 和非 Unix 文件判断冗余；修复条件编译，保持共享测试运行，不通过关闭 lint 绕过。
- 取消/超时使用自有 PID/进程组；Windows 使用固定 System32 taskkill 的 PID + 子树参数，不使用命令 shell 或镜像通配符；子进程不弹控制台。元数据读取与组件 probe 共用清理逻辑。新增 Windows 原生测试：实际启动子进程，取消后查询其 PID，验证不再运行；已在 Windows runner 通过。

## 原生组件与测试

[运行 43570843859](https://github.com/coopsrc/savebeam/actions/runs/43570843859)，提交 `e4c5afeecf1ea9a19f1918c582cd760694020cd8`，两平台均成功。

| 平台                    | Rust 测试                              | 真实二进制                                                                   |
| ----------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| macOS 15 arm64          | 198 passed / 1 ignored                 | yt-dlp 2026.10.26、Deno 2.9.8                                                |
| Windows Server 2022 x64 | 176 passed / 1 ignored；包含进程树取消 | yt-dlp 2026.10.26、Deno 2.9.8、FFmpeg/ffprobe n9.0.2-57-gd838f9f9ae-20261113 |

数量差异来自 Unix 专项测试的条件编译；共享测试没有为通过 CI 而关闭。唯一 ignored 项为显式启用的公网 Bilibili 元数据检查，需要 `SAVEBEAM_LIVE_YTDLP`；未将外部站点限制解释为通过。

上述六个原生组件均实际下载并验证长度/SHA-256、拒绝错误哈希、测试真实 HTTPS 取消后的半成品清理、安全解压、版本探测、同版本替换及失败健康检查回滚。文件均在 runner 临时目录。结果日志作为 Actions artifact 保留 14 天。审核 JSON 仅更新这六项目标的哈希/原生测试状态；二进制 notices、其他架构和发布批准仍未通过。

## 安装包候选

[运行 43570348830](https://github.com/coopsrc/savebeam/actions/runs/43570348830)，应用源码提交 `f89871d1523bb65fb3c1a532c3d267e9e798b20f`，macOS/Windows 均成功。之后的 `e4c5afe` 仅增加开发验收 helper、组件 CI 和文档，不改变应用行为；其 [基础 CI 43570843852](https://github.com/coopsrc/savebeam/actions/runs/43570843852) 也通过。

macOS arm64 DMG/APP 更新包与 Windows x64 NSIS 构建成功。下载两平台产物后独立复验 SHA256SUMS、build-info 的提交/版本/长度、固定公钥的更新包签名及其版本绑定均通过；附带 LICENSE/NOTICE/THIRD_PARTY_NOTICES 与源码对应字节一致。DMG `hdiutil verify`、解压后 `codesign --verify --deep --strict` 通过（ad-hoc，不是 Developer ID）。`Contents/MacOS` 只有 `savebeam`，法律资源齐全。

| 文件                           | 字节数  | SHA-256                                                            |
| ------------------------------ | ------- | ------------------------------------------------------------------ |
| `Savebeam_0.1.0_aarch64.dmg`   | 5182165 | `0e3a21f3bc640a172d01397df1fb522d4f3c9827f96595d5f1c0927e4cbc56dd` |
| `Savebeam.app.tar.gz`          | 5223818 | `cb946cb23374394bec08e0d6dc25097327658f1af1cf095683c7f085de09f3db` |
| `Savebeam_0.1.0_x64-setup.exe` | 4122153 | `c2c28fef1305a3d4feeaecd980ff77615ffe75d2a16472011ba48fb808150040` |

候选 `signingMode=unsigned`、`osSignatureVerified=false`。更新签名只证明包来源与绑定版本，不能替代 OS 发行证书/公证。Actions 产物在公开仓库可下载，保留 14 天；没有生成公开 `latest.json`，没有创建或发布 Release。

正式签名/公证、已安装应用 GUI/辅助技术与真实跨版本更新仍未完成；CI 构建成功不能替代这些验收。
