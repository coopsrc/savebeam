//! Bounded local image loading so remote thumbnails do not require WebView
//! network permissions or a WebView-origin Referer. No cookies are forwarded.

use std::{io::Read, time::Duration};

use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Url, blocking::Client, redirect::Policy};

const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024;

pub fn load_thumbnail(url: &str, webpage_url: &str, user_agent: Option<&str>) -> Option<String> {
    let page = web_url(webpage_url)?;
    let image = web_url(page.join(url).ok()?.as_str())?;
    let client = Client::builder()
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(4))
        .referer(false)
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 || web_url(attempt.url().as_str()).is_none() {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .ok()?;
    let response = client
        .get(image)
        .header(
            "Referer",
            format!("{}/", page.origin().ascii_serialization()),
        )
        .header("User-Agent", user_agent.unwrap_or("Savebeam/0.1"))
        .send()
        .ok()?
        .error_for_status()
        .ok()?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_IMAGE_BYTES)
    {
        return None;
    }
    image_data_url(response)
}

fn web_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}

fn image_data_url(reader: impl Read) -> Option<String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return None;
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if bytes.get(4..12) == Some(b"ftypavif") || bytes.get(4..12) == Some(b"ftypavis") {
        "image/avif"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    use super::{MAX_IMAGE_BYTES, image_data_url, load_thumbnail, web_url};

    #[test]
    fn rejects_non_images_credentials_and_oversized_bodies() {
        assert!(image_data_url(&b"<html>Access denied</html>"[..]).is_none());
        assert!(image_data_url(&b"<svg onload='bad()'/>"[..]).is_none());
        assert!(image_data_url(std::io::repeat(0).take(MAX_IMAGE_BYTES + 1)).is_none());
        assert!(web_url("file:///etc/passwd").is_none());
        assert!(web_url("https://user:password@example.com/image.jpg").is_none());
    }

    #[test]
    fn loads_image_with_page_origin_referer_without_cookie_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut chunk = [0; 1024];
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let count = stream.read(&mut chunk).unwrap();
                assert_ne!(count, 0);
                request.extend_from_slice(&chunk[..count]);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n\x89PNG\r\n\x1a\n").unwrap();
            String::from_utf8(request).unwrap().to_lowercase()
        });
        let image = load_thumbnail(
            &format!("http://{address}/cover"),
            "https://www.bilibili.com/video/example?token=private",
            Some("TestAgent"),
        )
        .unwrap();
        assert_eq!(image, "data:image/png;base64,iVBORw0KGgo=");
        let request = worker.join().unwrap();
        assert!(request.contains("referer: https://www.bilibili.com/\r\n"));
        assert!(request.contains("user-agent: testagent\r\n"));
        assert!(!request.contains("cookie:"));
        assert!(!request.contains("authorization:"));
        assert!(!request.contains("token=private"));
    }
}
