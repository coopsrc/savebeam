# 媒体封面预览修复

日期：2026-10-21。

原实现将远程图片 URL 直接赋给 WebView 图片元素，而应用 CSP 的 `img-src` 只允许本地资源、blob 和 data；站点要求的 Referer 也无法按需传递。

现在解析媒体信息后，由 Rust 加载封面，将识别出的 PNG/JPEG/GIF/WebP/AVIF 图片作为 `thumbnailDataUrl` 返回。请求使用媒体页面 origin 作为 Referer，并使用解析器提供的 User-Agent；不转发 Cookie、Authorization 或页面 URL 中的查询参数。响应最多 4 MiB、总超时 8 秒、最多跟随 3 次重定向。CSP 保持原有图片来源限制。

WebView 使用返回的图片数据预览；缺少图片或解码失败显示“封面暂不可用”。原始 `thumbnailUrl` 保留为元数据，并支持从 `thumbnails` 列表选取回退 URL。

自动化验证覆盖：本地 HTTP 服务器检查请求头、图片 data URL 生成，以及非图片内容、带凭据 URL、非 HTTP(S) URL 和超大响应的拒绝。真实站点 CDN 的可用性仍取决于网络和上游访问规则。
