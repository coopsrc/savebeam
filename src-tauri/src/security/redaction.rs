//! Redaction helpers for diagnostic text crossing trust boundaries.

use std::env;

const SENSITIVE_QUERY_KEYS: &[&str] = &[
    "token",
    "signature",
    "sig",
    "key",
    "auth",
    "cookie",
    "session",
    "credential",
    "password",
    "expires",
    "policy",
];

const SENSITIVE_HEADERS: &[&str] = &[
    "cookie:",
    "set-cookie:",
    "authorization:",
    "proxy-authorization:",
];

/// Removes credential-like query values, sensitive headers, and home paths.
pub fn redact_diagnostic(input: &str) -> String {
    let homes = ["HOME", "USERPROFILE"]
        .into_iter()
        .filter_map(|variable| env::var(variable).ok())
        .collect::<Vec<_>>();
    let redacted = redact_home_paths(input, &homes);

    let mut output = String::with_capacity(redacted.len());
    for line in redacted.split_inclusive('\n') {
        let line_without_newline = line.strip_suffix('\n').unwrap_or(line);
        let lower = line_without_newline.to_ascii_lowercase();
        if SENSITIVE_HEADERS
            .iter()
            .any(|header| lower.trim_start().starts_with(header))
        {
            output.push_str("[REDACTED HEADER]");
        } else {
            output.push_str(&redact_query_values(line_without_newline));
        }
        if line.ends_with('\n') {
            output.push('\n');
        }
    }
    output
}

fn redact_home_paths(input: &str, homes: &[String]) -> String {
    homes
        .iter()
        .filter(|home| !home.is_empty())
        .fold(input.to_owned(), |value, home| value.replace(home, "~"))
}

fn redact_query_values(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(query_start) = input[cursor..].find('?') {
        let query_start = cursor + query_start;
        output.push_str(&input[cursor..=query_start]);
        let query_end = input[query_start + 1..]
            .find(|character: char| {
                character.is_whitespace() || character == '"' || character == '\''
            })
            .map(|offset| query_start + 1 + offset)
            .unwrap_or(input.len());
        let query = &input[query_start + 1..query_end];
        let mut first = true;
        for pair in query.split('&') {
            if !first {
                output.push('&');
            }
            first = false;
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            output.push_str(key);
            if pair.contains('=') {
                output.push('=');
                if is_sensitive_key(key) {
                    output.push_str("[REDACTED]");
                } else {
                    output.push_str(value);
                }
            }
        }
        cursor = query_end;
    }
    output.push_str(&input[cursor..]);
    output
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    SENSITIVE_QUERY_KEYS
        .iter()
        .any(|sensitive| key.contains(sensitive))
}

#[cfg(test)]
mod tests {
    use super::{redact_diagnostic, redact_home_paths};

    #[test]
    fn redacts_sensitive_query_values_and_preserves_safe_parameters() {
        let value = redact_diagnostic(
            "https://video.example/watch?v=abc&signature=secret&quality=720&auth_token=also-secret",
        );
        assert_eq!(
            value,
            "https://video.example/watch?v=abc&signature=[REDACTED]&quality=720&auth_token=[REDACTED]"
        );
    }

    #[test]
    fn redacts_sensitive_headers_and_home_directory_paths() {
        let input = "Cookie: SID=secret\npath=/Users/example/private/file";
        let value = redact_home_paths(&redact_diagnostic(input), &["/Users/example".into()]);
        assert!(value.starts_with("[REDACTED HEADER]\n"));
        assert!(!value.contains("/Users/example"));
    }
}
