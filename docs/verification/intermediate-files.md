# 中间文件保留与命名验证

日期：2026-10-21。

下载页增加“保留中间文件”，默认关闭。`keepIntermediateFiles` 经 IPC 保存到任务中，SQLite v7 为旧任务默认置为 false。应用重启恢复、失败重试保留原选择。开启时传入 yt-dlp 的 `--keep-video`，支持合并前的独立视频/音频和 MP3 转换前的源文件。

## 命名与边界

下载、续传和合并期间由 yt-dlp 管理原生临时名称。任务成功、成品文件通过目录和非空校验后，才整理保留的分轨名称，例如：

```text
标题 [BV19wee6BEeP].mp4
标题 [BV19wee6BEeP].video.f30120.avc1.640033.3840x2160.5500kbps.mp4
标题 [BV19wee6BEeP].audio.f30280.mp4a.40.2.audio-only.152kbps.m4a
```

格式 ID 对应格式选择列表中的 `#30120`、`#30280`，编码使用上游原始标识；后缀表示各自容器。视频码率优先 vbr，音频优先 abr，缺失时回退该轨道 tbr；仍未知时标注 bitrate-unknown。音频没有分辨率，显示 audio-only，不继承视频参数。系列目录和序号标题、最终媒体及字幕/封面/JSON 名称不变。MP3 的保留源文件仍用 yt-dlp 原生名称。

以上示例已同步视频 ID 命名规则：`BV19wee6BEeP` 是视频 ID，与分轨格式 ID `30120`、`30280` 不同。长标题截短时保留末尾视频 ID；系列目录使用 `系列名称 [系列ID]`。最新命名验证见 [下载目录和命名规则验证](output-layout.md)。

仅处理已验证成品同目录中符合原生 `.f格式ID.扩展名` 规则的普通文件，拒绝源符号链接、越界文件和其他文件。通过同目录 hard-link + unlink 实现不覆盖已有目标的整理；不支持硬链接的文件系统、冲突、元数据不足等情况保留原始名称，不影响成品成功状态。取消或失败时不整理部分文件，便于原生续传。该选项不是“保留所有分片”；不额外启用 keep-fragments，也不清理此前保留的文件。

命名信息由固定的 after_move JSON 投影返回，仅包括路径、格式 ID、容器、编码、分辨率和码率，不返回完整 requested_formats、媒体 URL、Cookie 或请求头。预计文件大小、历史记录和成品大小合计不计保留的源文件。

## 已执行验证

- `pnpm check`：格式、ESLint、Clippy、TypeScript/Vite 构建、14 项前端测试和 86 项 Rust 测试通过。Vite 仍提示现有主包超过 500 kB，不影响构建。
- Rust 覆盖：默认关闭/开启 argv、旧任务反序列化默认值、数据库迁移/往返、重启恢复与重试、结构化分轨元数据解析、两轨独立命名、未知码率、长 Unicode 标题、系列目录、目标冲突、源符号链接、越界和无关文件拒绝。
- Chrome 模拟 IPC 六场景：自动匹配、手动音频、MP3、音视频一体、系列、未知大小。每种场景均检查默认不勾选、勾选/取消不白屏和正确提交布尔参数；预计输出面板保持 132px，未出现 pageerror。浏览器测试不替代原生 WebView 验收。
- 本机真实 yt-dlp（Homebrew 2026.8.19_2）与 FFmpeg：通过仅绑定回环地址的 HTTP 服务提供合成 H.264 160×90 视频和 AAC 音频，分别测试 keepvideo=false/true。关闭时仅保留合并后的 MP4，开启时保留 MP4 与两条原生 `.f30120.mp4` / `.f30280.m4a` 文件；ffprobe 确认 MP4 同时包含音频和视频。after_move 投影返回两轨真实路径及独立参数，不含媒体 URL。
- 同一回环夹具验证 MP3 转换：关闭时仅保留 MP3，开启时保留 MP3 与原始 M4A。

原生引擎保留/合并和 Rust 命名整理分别验证；未下载站点媒体或读取用户 Cookie，未做 Windows/Linux 实机、外置 FAT 文件系统或发布包验收。

参考：[yt-dlp 输出模板](https://github.com/yt-dlp/yt-dlp#output-template)、[后处理选项](https://github.com/yt-dlp/yt-dlp#post-processing-options)。
