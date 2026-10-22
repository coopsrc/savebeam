//! Explicit user-triggered checks. No database, cookies, media, redirect or body reads.
use crate::{
    domain::{
        error::{AppError, ErrorCode},
        network::{
            ConnectionCheck, ConnectionCheckStatus, NetworkConnectionTestResult,
            NetworkPreferences, ProxyMode,
        },
    },
    security::network_proxy::{normalize, proxy_argument},
};
use reqwest::{Client, Url, redirect::Policy};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const YOUTUBE_TEST_URL: &str = "https://www.youtube.com/generate_204";
const PROXY_TIMEOUT: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Default)]
pub struct NetworkConnectionTester {
    busy: AtomicBool,
}
struct TestGuard<'a>(&'a AtomicBool);
impl Drop for TestGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn check(
    status: ConnectionCheckStatus,
    message: &str,
    started: Option<Instant>,
    http_status: Option<u16>,
) -> ConnectionCheck {
    ConnectionCheck {
        status,
        message: message.into(),
        duration_ms: started.map(|value| value.elapsed().as_millis() as u64),
        http_status,
    }
}

impl NetworkConnectionTester {
    pub async fn test(
        &self,
        preferences: &NetworkPreferences,
    ) -> Result<NetworkConnectionTestResult, AppError> {
        self.test_target(
            preferences,
            YOUTUBE_TEST_URL,
            PROXY_TIMEOUT,
            REQUEST_TIMEOUT,
        )
        .await
    }

    // The target is deliberately private; IPC callers cannot turn this into an arbitrary URL probe.
    async fn test_target(
        &self,
        preferences: &NetworkPreferences,
        target: &str,
        proxy_timeout: Duration,
        request_timeout: Duration,
    ) -> Result<NetworkConnectionTestResult, AppError> {
        let preferences = normalize(preferences)?;
        if self
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(AppError::new(
                ErrorCode::NetworkFailure,
                "已有连接测试正在进行，请稍后重试。",
                true,
            ));
        }
        let _guard = TestGuard(&self.busy);
        let proxy = if preferences.proxy_mode == ProxyMode::Custom {
            let endpoint = Url::parse(&preferences.proxy_url)
                .map_err(|_| AppError::new(ErrorCode::InvalidUrl, "代理地址格式无效。", false))?;
            let host = endpoint
                .host_str()
                .unwrap_or("")
                .trim_start_matches('[')
                .trim_end_matches(']');
            let port = endpoint.port_or_known_default().unwrap_or(1080);
            let started = Instant::now();
            match tokio::time::timeout(proxy_timeout, tokio::net::TcpStream::connect((host, port)))
                .await
            {
                Ok(Ok(_stream)) => check(
                    ConnectionCheckStatus::Success,
                    "代理端点 TCP 连接成功；尚不代表协议或转发可用。",
                    Some(started),
                    None,
                ),
                result => {
                    let message = if result.is_err() {
                        "连接代理端点超时，请检查代理地址、端口和软件运行状态。"
                    } else {
                        "无法连接代理端点，请检查地址、端口和代理软件。"
                    };
                    return Ok(NetworkConnectionTestResult {
                        proxy: check(ConnectionCheckStatus::Failed, message, Some(started), None),
                        youtube: check(
                            ConnectionCheckStatus::Skipped,
                            "代理端点无法连接，未发起 YouTube 请求。",
                            None,
                            None,
                        ),
                    });
                }
            }
        } else {
            check(
                ConnectionCheckStatus::Skipped,
                if preferences.proxy_mode == ProxyMode::Direct {
                    "当前为直连模式，不检测代理端点。"
                } else {
                    "当前为默认网络，未单独检测环境代理端点。"
                },
                None,
                None,
            )
        };
        let started = Instant::now();
        let builder = Client::builder()
            .timeout(request_timeout)
            .connect_timeout(request_timeout)
            .redirect(Policy::none())
            .referer(false)
            .user_agent("Savebeam/0.1 network-check");
        let builder = match proxy_argument(&preferences)? {
            None => builder,
            Some(value) if value.is_empty() => builder.no_proxy(),
            Some(value) => builder
                .no_proxy()
                .proxy(reqwest::Proxy::all(value).map_err(|_| {
                    AppError::new(ErrorCode::InvalidUrl, "无法使用此代理配置。", false)
                })?),
        };
        let client = builder
            .build()
            .map_err(|_| AppError::new(ErrorCode::NetworkFailure, "无法初始化连接测试。", true))?;
        // send() only waits for response headers; we never collect or persist the body.
        let youtube = match client
            .get(target)
            .header("Cache-Control", "no-cache")
            .send()
            .await
        {
            Ok(response) if response.status() == reqwest::StatusCode::NO_CONTENT => check(
                ConnectionCheckStatus::Success,
                "YouTube 连通性检查通过；不代表视频解析或下载一定成功。",
                Some(started),
                Some(204),
            ),
            Ok(response) => {
                let status = response.status().as_u16();
                check(
                    ConnectionCheckStatus::Limited,
                    &format!(
                        "YouTube 返回 HTTP {status}，不是预期的 204；访问受限或响应异常，不能确认正常使用。本测试不跟随重定向。"
                    ),
                    Some(started),
                    Some(status),
                )
            }
            Err(error) => check(
                ConnectionCheckStatus::Failed,
                if error.is_timeout() {
                    "访问 YouTube 超时，请检查代理转发、DNS 或网络规则。"
                } else {
                    "无法完成到 YouTube 的 HTTPS 请求，请检查代理协议、DNS、TLS 或网络规则。端点端口可连接不代表代理转发可用。"
                },
                Some(started),
                None,
            ),
        };
        Ok(NetworkConnectionTestResult { proxy, youtube })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    fn http_server(
        status: u16,
        proxy_probe: bool,
        delay: Duration,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            if proxy_probe {
                let _ = listener.accept().unwrap();
            }
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut byte = [0];
            while !bytes.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                bytes.push(byte[0]);
            }
            thread::sleep(delay);
            let _ = write!(
                stream,
                "HTTP/1.1 {status} Test\r\nLocation: http://untrusted.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            String::from_utf8(bytes).unwrap().to_lowercase()
        });
        (format!("http://{address}"), worker)
    }

    #[test]
    fn custom_proxy_test_is_two_stages_without_cookies_or_body_collection() {
        let (proxy, worker) = http_server(204, true, Duration::ZERO);
        let value = NetworkPreferences {
            proxy_mode: ProxyMode::Custom,
            proxy_url: proxy,
        };
        let tester = NetworkConnectionTester::default();
        let result = runtime()
            .block_on(tester.test_target(
                &value,
                "http://youtube.invalid/generate_204",
                PROXY_TIMEOUT,
                REQUEST_TIMEOUT,
            ))
            .unwrap();
        assert_eq!(result.proxy.status, ConnectionCheckStatus::Success);
        assert_eq!(result.youtube.status, ConnectionCheckStatus::Success);
        assert_eq!(result.youtube.http_status, Some(204));
        assert!(result.proxy.duration_ms.is_some());
        assert!(!tester.busy.load(Ordering::Acquire));
        let request = worker.join().unwrap();
        assert!(request.starts_with("get http://youtube.invalid/generate_204 http/1.1"));
        assert!(!request.contains("cookie:"));
        assert!(!request.contains("authorization:"));
    }
    #[test]
    fn unavailable_proxy_skips_youtube_instead_of_falling_back_to_direct() {
        let unavailable = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", unavailable.local_addr().unwrap());
        drop(unavailable);
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let value = NetworkPreferences {
            proxy_mode: ProxyMode::Custom,
            proxy_url: endpoint,
        };
        let result = runtime()
            .block_on(NetworkConnectionTester::default().test_target(
                &value,
                &format!("http://{}/", target.local_addr().unwrap()),
                PROXY_TIMEOUT,
                REQUEST_TIMEOUT,
            ))
            .unwrap();
        assert_eq!(result.proxy.status, ConnectionCheckStatus::Failed);
        assert_eq!(result.youtube.status, ConnectionCheckStatus::Skipped);
        assert!(target.accept().is_err());
    }
    #[test]
    fn non_204_responses_are_limited_not_success_and_redirects_are_not_followed() {
        let rt = runtime();
        for status in [200, 302, 403, 429, 503] {
            let (target, worker) = http_server(status, false, Duration::ZERO);
            let result = rt
                .block_on(NetworkConnectionTester::default().test_target(
                    &NetworkPreferences {
                        proxy_mode: ProxyMode::Direct,
                        proxy_url: String::new(),
                    },
                    &target,
                    PROXY_TIMEOUT,
                    REQUEST_TIMEOUT,
                ))
                .unwrap();
            assert_eq!(result.proxy.status, ConnectionCheckStatus::Skipped);
            assert_eq!(result.youtube.status, ConnectionCheckStatus::Limited);
            assert_eq!(result.youtube.http_status, Some(status));
            worker.join().unwrap();
        }
    }
    #[test]
    fn timeout_releases_the_guard_and_busy_or_invalid_tests_start_no_requests() {
        let tester = NetworkConnectionTester::default();
        let (target, worker) = http_server(204, false, Duration::from_millis(100));
        let direct = NetworkPreferences {
            proxy_mode: ProxyMode::Direct,
            proxy_url: String::new(),
        };
        let rt = runtime();
        let result = rt
            .block_on(tester.test_target(
                &direct,
                &target,
                PROXY_TIMEOUT,
                Duration::from_millis(30),
            ))
            .unwrap();
        assert_eq!(result.youtube.status, ConnectionCheckStatus::Failed);
        assert!(!tester.busy.load(Ordering::Acquire));
        worker.join().unwrap();
        tester.busy.store(true, Ordering::Release);
        assert!(rt.block_on(tester.test(&direct)).is_err());
        tester.busy.store(false, Ordering::Release);
        let invalid = NetworkPreferences {
            proxy_mode: ProxyMode::Custom,
            proxy_url: "http://user:secret@localhost".into(),
        };
        let error = rt.block_on(tester.test(&invalid)).unwrap_err();
        assert!(!error.message.contains("secret"));
        assert!(!tester.busy.load(Ordering::Acquire));
    }
}
