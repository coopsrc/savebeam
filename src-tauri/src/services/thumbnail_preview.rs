//! Bounded local image loading so remote thumbnails do not require WebView
//! network permissions or a WebView-origin Referer. No cookies are forwarded.

use std::{io::Read, time::Duration};

use crate::{domain::network::NetworkPreferences, security::network_proxy::proxy_argument};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{Url, blocking::Client, redirect::Policy};

const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024;

pub fn load_thumbnail(url: &str, webpage_url: &str, user_agent: Option<&str>) -> Option<String> {
    load_thumbnail_with_network(url, webpage_url, user_agent, &NetworkPreferences::default())
}

pub fn load_thumbnail_with_network(
    url: &str,
    webpage_url: &str,
    user_agent: Option<&str>,
    network: &NetworkPreferences,
) -> Option<String> {
    let page = web_url(webpage_url)?;
    let image = web_url(page.join(url).ok()?.as_str())?;
    let builder = Client::builder()
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(4))
        .referer(false)
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 || web_url(attempt.url().as_str()).is_none() {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }));
    let builder = match proxy_argument(network).ok()? {
        None => builder,
        Some(value) if value.is_empty() => builder.no_proxy(),
        Some(value) => builder.no_proxy().proxy(reqwest::Proxy::all(value).ok()?),
    };
    let client = builder.build().ok()?;
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

    #[test]
    fn thumbnail_uses_the_configured_http_proxy_without_cookie_or_proxy_credentials() {
        use crate::domain::network::{NetworkPreferences, ProxyMode};
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
        let preferences = NetworkPreferences {
            proxy_mode: ProxyMode::Custom,
            proxy_url: format!("http://{address}"),
        };
        let image = super::load_thumbnail_with_network(
            "http://cover.invalid/cover.png",
            "https://www.youtube.com/watch?v=test",
            None,
            &preferences,
        )
        .unwrap();
        assert!(image.starts_with("data:image/png;base64,"));
        let request = worker.join().unwrap();
        assert!(request.starts_with("get http://cover.invalid/cover.png http/1.1"));
        assert!(request.contains("referer: https://www.youtube.com/"));
        assert!(!request.contains("cookie:"));
        assert!(!request.contains("authorization:"));
    }

    #[test]
    fn rejected_or_unreachable_proxy_does_not_fall_back_to_the_target_server() {
        use crate::domain::network::{NetworkPreferences, ProxyMode};
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let url = format!("http://{}/cover.png", target.local_addr().unwrap());
        let unavailable = TcpListener::bind("127.0.0.1:0").unwrap();
        let dead_proxy = format!("http://{}", unavailable.local_addr().unwrap());
        drop(unavailable);
        for proxy in ["http://user:secret@localhost".to_string(), dead_proxy] {
            let value = NetworkPreferences {
                proxy_mode: ProxyMode::Custom,
                proxy_url: proxy,
            };
            assert!(
                super::load_thumbnail_with_network(&url, "https://example.com", None, &value)
                    .is_none()
            );
            assert!(target.accept().is_err());
        }
    }

    #[test]
    fn thumbnail_socks5h_sends_the_hostname_to_the_proxy_instead_of_resolving_it_locally() {
        use crate::domain::network::{NetworkPreferences, ProxyMode};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut greeting = [0; 2];
            stream.read_exact(&mut greeting).unwrap();
            assert_eq!(greeting[0], 5);
            let mut methods = vec![0; greeting[1] as usize];
            stream.read_exact(&mut methods).unwrap();
            assert!(methods.contains(&0));
            stream.write_all(&[5, 0]).unwrap();
            let mut header = [0; 4];
            stream.read_exact(&mut header).unwrap();
            assert_eq!(header, [5, 1, 0, 3]);
            let mut count = [0; 1];
            stream.read_exact(&mut count).unwrap();
            let mut hostname = vec![0; count[0] as usize];
            stream.read_exact(&mut hostname).unwrap();
            assert_eq!(hostname, b"cover.invalid");
            let mut port = [0; 2];
            stream.read_exact(&mut port).unwrap();
            assert_eq!(u16::from_be_bytes(port), 80);
            stream
                .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 80])
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0; 1];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n\x89PNG\r\n\x1a\n").unwrap();
        });
        let preferences = NetworkPreferences {
            proxy_mode: ProxyMode::Custom,
            proxy_url: format!("socks5h://{address}"),
        };
        assert!(
            super::load_thumbnail_with_network(
                "http://cover.invalid/test.png",
                "https://example.com",
                None,
                &preferences
            )
            .is_some()
        );
        worker.join().unwrap();
    }
}
