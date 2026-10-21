# 下载目录和命名规则验证

当前规则已加入视频 ID 与分类/系列 ID。

单视频使用 `%(title)s%(id& [{}]|)s.%(ext)s`，直接写入默认下载目录。分类/系列使用 `系列名称 [系列ID]/序号-视频标题 [视频ID].扩展名`；模板按 playlist_title、series、playlist 依次取系列名称，缺失时使用“未命名系列”，目录 ID 优先 playlist_id、其次 series_id，缺失则省略整个后缀。序号优先取 playlist_index、其次 episode_number，缺失时为 1。

视频 ID 使用解析器的 id，不使用格式选择的 format_id。普通 B 站视频得到 BV 号，多 P 保留 `_p2` 等子项标识避免重名；YouTube 等站点使用各自原始视频 ID，不从用户输入链接硬编码截取。不把视频 ID 回退作为分类 ID，也不把链接或 NA 写入未知 ID 位置。只影响后续下载，不修改磁盘上已有文件。

所有附属文件继承同一目录和标题前缀。字幕保留语言标识，JSON 保留 yt-dlp 原生 `.info.json` 扩展名，封面使用图片扩展名。系列模式关闭额外的 playlist 元数据文件写入，使文件围绕各视频组织。同名文件继续遵循全局的跳过/覆盖设置，默认跳过。

使用本机真实 yt-dlp（Homebrew 2026.8.19_2）的文件名生成器进行离线验证，结果示例为：

```text
下载目录/
  中文视频 标题 [BV19wee6BEeP].mp4
  中文视频 标题 [BV19wee6BEeP].zh-Hans.vtt
  中文视频 标题 [BV19wee6BEeP].info.json
  中文视频 标题 [BV19wee6BEeP].jpg
  Rust 课程 [list123]/
    2-中文视频 标题 [BV19wee6BEeP].mp4
    2-中文视频 标题 [BV19wee6BEeP].zh-Hans.vtt
    2-中文视频 标题 [BV19wee6BEeP].info.json
```

还验证了 series/episode_number 回退、完全缺少系列元数据的回退，以及标题中的斜杠、冒号、问号和百分号。启用 Windows 兼容文件名清理后，斜杠只作为标题中的替换字符，不能从标题创建额外目录；中文和空格保留。

新增可重复执行的离线验证脚本，直接读取 Rust 中的实际模板，避免测试复制旧模板：

```sh
node scripts/verify-output-naming.mjs /path/to/python-with-yt-dlp
```

本机使用 Homebrew yt-dlp 自带的 Python 运行通过。11 项具名用例覆盖 BV 号、YouTube ID、多 P、单视频忽略系列目录、系列及其 ID 回退与优先级、未知 ID 省略、MP3 后缀；另验证所有附属文件的公共前缀、同标题不同 ID 不重名，以及标题/视频 ID/系列 ID 中不安全字符的清理。此脚本不请求网络、不读取用户 Cookie、不创建下载目录或写媒体文件，也不为应用增加 Python 运行依赖。

`pnpm check` 通过：14 项前端测试、87 项 Rust 测试以及格式、lint 和生产构建。Rust 补充长标题保留视频 ID 的测试，保留分轨的系列目录/成品/原生源文件均使用带 ID 的前缀验证，不改变无覆盖整理和安全边界。

Rust 测试覆盖单视频和系列 argv 模板、系列子目录输出识别与大小合计，并确认指向下载根目录外的子目录符号链接不能通过完成校验。上述命名验证未请求站点媒体或用户 Cookie。
