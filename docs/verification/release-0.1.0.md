# 0.1.0 手动下载发布

日期：2026-11-14。用户明确要求 GitHub Release 可直接下载安装包，每次发布使用版本 Tag；无需新增长期 release 分支。

- 采用 `main` 开发、固定的 annotated `vMAJOR.MINOR.PATCH` Tag 发布；Tag 与三处应用版本一致才构建。
- 推送 Tag 后两平台全量检查、打包、固定公钥更新签名校验；发布 job 仅在两平台成功后执行，并校验产物提交、版本、平台、长度/哈希、签名状态及法律文本。
- 先上传至 draft，核对上传文件集合与长度，再公开；拒绝覆盖已有 Release。导出合并的 SHA256SUMS / build-info 与声明文件，不公开临时凭据或任意文件。
- 发布流程回归覆盖版本差异、旧提交、缺平台、缺签名、篡改包/校验表/法律文本、额外文件和路径越界。现有正式 updater 拒绝 unsigned 的回归保持通过。
- `docs/releases/notes/0.1.0.md` 明确 unsigned/ad-hoc、无公证、组件需系统安装/自定义路径、站点限制及手动下载渠道；本次不生成 `latest.json` / `components.json`，不把 M6/M7/M8 整体验收标为通过。
- 本机 `pnpm check` 全量通过（77 前端测试、198 Rust 测试通过 / 1 公网元数据检查忽略），release 工作流 actionlint 通过。暂存脚本亦对上轮真实两平台 CI 产物运行成功，导出严格限定的 10 个公共资产。

Tag 的远程构建和公开下载结果在执行后补充。
