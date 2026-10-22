//! Proxy endpoints are data, not shell commands. Do not persist credentials.
use std::ffi::OsString;

use reqwest::Url;

use crate::domain::{
    error::{AppError, ErrorCode},
    network::{NetworkPreferences, ProxyMode},
};

fn invalid(message: &str) -> AppError {
    // Never echo a rejected URL or parser error: it may contain a password.
    AppError::new(ErrorCode::InvalidUrl, message, false)
}

pub fn normalize(preferences: &NetworkPreferences) -> Result<NetworkPreferences, AppError> {
    if preferences.proxy_mode != ProxyMode::Custom {
        return Ok(NetworkPreferences {
            proxy_mode: preferences.proxy_mode,
            proxy_url: String::new(),
        });
    }
    let value = preferences.proxy_url.trim();
    if value.is_empty()
        || value.len() > 2048
        || value.chars().any(char::is_whitespace)
        || value.chars().any(char::is_control)
        || value.contains('\\')
    {
        return Err(invalid(
            "请输入完整代理地址，不要包含空白、控制字符或命令参数。",
        ));
    }
    let mut url =
        Url::parse(value).map_err(|_| invalid("代理地址格式无效，请填写协议、主机和端口。"))?;
    if !matches!(
        url.scheme(),
        "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h"
    ) || url.host_str().is_none()
        || url
            .port_or_known_default()
            .or_else(|| url.scheme().starts_with("socks").then_some(1080))
            == Some(0)
    {
        return Err(invalid(
            "代理仅支持 HTTP、HTTPS 或 SOCKS，主机和端口必须有效。",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() || value.contains('@') {
        return Err(invalid(
            "暂不支持在代理地址中填写账号密码，请使用本机无认证代理。",
        ));
    }
    if !matches!(url.path(), "" | "/") || url.query().is_some() || url.fragment().is_some() {
        return Err(invalid("代理地址不能包含路径、查询参数或片段。"));
    }
    url.set_path("/");
    Ok(NetworkPreferences {
        proxy_mode: ProxyMode::Custom,
        proxy_url: url.to_string(),
    })
}

/// None preserves tool defaults; Some("") explicitly disables proxies.
pub fn proxy_argument(preferences: &NetworkPreferences) -> Result<Option<String>, AppError> {
    let value = normalize(preferences)?;
    Ok(match value.proxy_mode {
        ProxyMode::Default => None,
        ProxyMode::Direct => Some(String::new()),
        ProxyMode::Custom => Some(value.proxy_url),
    })
}

pub fn proxy_args(preferences: &NetworkPreferences) -> Result<Vec<OsString>, AppError> {
    Ok(proxy_argument(preferences)?
        .map(|value| vec!["--proxy".into(), value.into()])
        .unwrap_or_default())
}

/// Explicit task choice wins over global defaults. Never fall back to direct on proxy failure.
pub fn for_task(
    saved: &NetworkPreferences,
    use_proxy: Option<bool>,
) -> Result<NetworkPreferences, AppError> {
    match use_proxy {
        Some(false) => Ok(NetworkPreferences {
            proxy_mode: ProxyMode::Direct,
            proxy_url: String::new(),
        }),
        Some(true) if saved.proxy_mode != ProxyMode::Custom => Err(invalid(
            "请先在设置中选择自定义代理并保存，再勾选使用代理。",
        )),
        _ => normalize(saved),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_choice_overrides_global_mode_but_legacy_tasks_keep_inheritance() {
        let saved = NetworkPreferences {
            proxy_mode: ProxyMode::Custom,
            proxy_url: "socks5h://127.0.0.1:1080".into(),
        };
        assert_eq!(
            proxy_argument(&for_task(&saved, Some(false)).unwrap()).unwrap(),
            Some(String::new())
        );
        assert_eq!(
            for_task(&saved, Some(true)).unwrap(),
            normalize(&saved).unwrap()
        );
        assert_eq!(for_task(&saved, None).unwrap(), normalize(&saved).unwrap());
        for mode in [ProxyMode::Default, ProxyMode::Direct] {
            let value = NetworkPreferences {
                proxy_mode: mode,
                proxy_url: String::new(),
            };
            assert!(
                for_task(&value, Some(true))
                    .unwrap_err()
                    .message
                    .contains("设置")
            );
        }
        let invalid = NetworkPreferences {
            proxy_url: "http://user:secret@host".into(),
            ..saved
        };
        assert!(for_task(&invalid, Some(true)).is_err());
        assert_eq!(
            for_task(&invalid, Some(false)).unwrap().proxy_mode,
            ProxyMode::Direct
        );
    }

    #[test]
    fn distinguishes_default_direct_and_custom_without_shell_interpolation() {
        assert!(
            proxy_args(&NetworkPreferences::default())
                .unwrap()
                .is_empty()
        );
        let mut value = NetworkPreferences {
            proxy_mode: ProxyMode::Direct,
            proxy_url: "unused".into(),
        };
        assert_eq!(
            proxy_args(&value).unwrap(),
            [OsString::from("--proxy"), OsString::from("")]
        );
        assert_eq!(normalize(&value).unwrap().proxy_url, "");
        value.proxy_mode = ProxyMode::Custom;
        for scheme in ["http", "https", "socks4", "socks4a", "socks5", "socks5h"] {
            value.proxy_url = format!(" {scheme}://127.0.0.1:7890 ");
            let args = proxy_args(&value).unwrap();
            assert_eq!(args.len(), 2);
            assert_eq!(args[1], format!("{scheme}://127.0.0.1:7890/").as_str());
        }
        value.proxy_url = "http://[::1]:7890".into();
        assert!(normalize(&value).is_ok());
    }

    #[test]
    fn rejects_credentials_options_paths_and_invalid_endpoints_without_echoing_input() {
        for url in [
            "",
            "ftp://example.com",
            "file:///tmp/proxy",
            "http://",
            "--exec=bad",
            "http://127.0.0.1:0",
            "http://localhost:65536",
            "http://host/path",
            "http://host/?token=secret",
            "http://host/#secret",
            "http://user:secret@host",
            "http://@host",
            "http://host\n--exec=secret",
            "http://host\\secret",
        ] {
            let value = NetworkPreferences {
                proxy_mode: ProxyMode::Custom,
                proxy_url: url.into(),
            };
            let error = normalize(&value).unwrap_err();
            assert!(!error.message.contains("secret"));
            assert!(error.diagnostic.is_none());
        }
    }
}
