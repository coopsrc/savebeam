# 首次公开推送与双平台 CI

日期：2026-11-14。用户明确授权首次推送公开源码及运行未签名检查，不创建或发布 Release。

- 首次通过现有 SSH 授权推送 `28ea66c` 到 `coopsrc/savebeam/main`；HTTPS OAuth 凭据缺少工作流写入权限，没有扩大其权限或替换凭据。
- 新仓库仅手动触发的构建工作流未注册，增加仅工作流自身在 main 修改时触发的 unsigned 检查；signed 仍仅手动启动。推送构建与 GitHub Release 发布保持分离。
- Windows 首轮因自动 CRLF 检出导致 210 项格式检查失败；新增 `.gitattributes`，以 `core.autocrlf=true` 的隔离克隆验证 LF 检出及 Prettier 全量通过。
- macOS 基线 CI 已通过。打包中的 notices 重生成发现本地 pnpm list 去重结果漏了 csstype/get-nonce/scheduler；改为遍历实际安装 manifest 的生产/peer/optional 闭包，585 依赖文本与干净 CI 一致。增加缺依赖拒绝、共享依赖与 UTF-8/LF 的 Python 回归。
- Windows 原生 Clippy 暴露 Unix 测试 imports/helper 缺 cfg 和非 Unix 文件判断冗余；修复条件编译，保持共享测试运行，不通过关闭 lint 绕过。
- 取消/超时使用自有 PID/进程组；Windows 使用固定 System32 taskkill 的 PID + 子树参数，不使用命令 shell 或镜像通配符；子进程不弹控制台。元数据读取与组件 probe 共用清理逻辑。新增 Windows 原生测试：实际启动子进程，取消后查询其 PID，验证不再运行。本机 Unix 回归 198 passed / 1 ignored；Windows 新回归及安装包产物等待本次 CI 结果确认。

正式签名/公证、已安装应用 GUI/辅助技术与真实跨版本更新仍未完成；CI 构建成功不能替代这些验收。
