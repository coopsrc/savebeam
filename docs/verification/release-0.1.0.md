# 0.1.0 手动下载发布

日期：2026-11-14。用户明确要求 GitHub Release 可直接下载安装包，每次发布使用版本 Tag；无需新增长期 release 分支。

- 采用 `main` 开发、固定的 annotated `vMAJOR.MINOR.PATCH` Tag 发布；Tag 与三处应用版本一致才构建。
- 推送 Tag 后两平台全量检查、打包、固定公钥更新签名校验；发布 job 仅在两平台成功后执行，并校验产物提交、版本、平台、长度/哈希、签名状态及法律文本。
- 先上传至 draft，核对上传文件集合与长度，再公开；拒绝覆盖已有 Release。导出合并的 SHA256SUMS / build-info 与声明文件，不公开临时凭据或任意文件。
- 发布流程回归覆盖版本差异、旧提交、缺平台、缺签名、篡改包/校验表/法律文本、额外文件和路径越界。现有正式 updater 拒绝 unsigned 的回归保持通过。
- `docs/releases/notes/0.1.0.md` 明确 unsigned/ad-hoc、无公证、组件需系统安装/自定义路径、站点限制及手动下载渠道；本次不生成 `latest.json` / `components.json`，不把 M6/M7/M8 整体验收标为通过。
- 本机 `pnpm check` 全量通过（77 前端测试、198 Rust 测试通过 / 1 公网元数据检查忽略），release 工作流 actionlint 通过。暂存脚本亦对上轮真实两平台 CI 产物运行成功，导出严格限定的 10 个公共资产。

## 实际发布结果

- [Release v0.1.0](https://github.com/coopsrc/savebeam/releases/tag/v0.1.0)，2026-11-14 09:59:56 UTC 公开（北京时间 17:59:56），非 draft、非 prerelease。
- annotated Tag `v0.1.0` 固定指向 `22e7d0d9175276016be3226f1e7f9bbfb0c46d0b`；后续验收记录只提交 main，不移动 Tag 或替换资产。
- [Tag 发布流水线 43582207619](https://github.com/coopsrc/savebeam/actions/runs/43582207619)：macOS、Windows 和 publish 三个 job 均成功。两平台各 77 前端测试；macOS 198、Windows 176 Rust 测试通过，各 1 公网元数据检查忽略；Windows 真实子进程取消测试通过。
- macOS 候选下载后单独通过提交/版本/长度/哈希、固定公钥更新签名及 DMG `hdiutil verify`。
- 实际下载 Release 的全部 10 个资产，复验 SHA256SUMS 九条记录、两平台构建信息与 Tag 源码、法律文本及两个版本绑定的更新包签名，全部通过。
- 无任何登录凭据的 HTTP 请求跟随重定向后，两平台安装包均返回 HTTP 200。Release 资产没有 Actions artifact 的 14 天自动过期限制。
- 本次仅公开应用手动下载，未上传 `latest.json`、`components.json` 或任何私钥。`signingMode=unsigned` / `osSignatureVerified=false` 保持真实；正式发行验收及组件许可门禁不因发布而关闭。

| 文件                           | 字节数  | SHA-256                                                            |
| ------------------------------ | ------- | ------------------------------------------------------------------ |
| `Savebeam_0.1.0_aarch64.dmg`   | 5182162 | `ad669a1f22fa9e969e38b3214290ffdde8a54e2906c596479734a4f39fc75d4b` |
| `Savebeam_0.1.0_x64-setup.exe` | 4123670 | `cfae36c2a91e61f2eaa0ff7ed5b8f74c144ec1d65071aff93c2c677f3263b4a3` |
| `Savebeam.app.tar.gz`          | 5223812 | `4161e0f2e1be0a75cf8ae04a9dd456aad54d048d40fbba4daa7358eda59bd82c` |
