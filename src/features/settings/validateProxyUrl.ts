/** Fast form feedback only; Rust validates again before saving and launching requests. */
export function validateProxyUrl(input: string): string | null {
  const value = input.trim();
  if (
    !value ||
    value.length > 2048 ||
    /[\s\\]/u.test(value) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    return "请输入完整代理地址，不要包含空白、控制字符或命令参数。";
  try {
    const url = new URL(value);
    if (
      !new Set(["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"]).has(
        url.protocol,
      ) ||
      !url.hostname ||
      url.port === "0"
    )
      return "代理仅支持 HTTP、HTTPS 或 SOCKS，主机和端口必须有效。";
    if (url.username || url.password || value.includes("@"))
      return "暂不支持在代理地址中填写账号密码，请使用本机无认证代理。";
    if ((url.pathname && url.pathname !== "/") || value.includes("?") || value.includes("#"))
      return "代理地址不能包含路径、查询参数或片段。";
    return null;
  } catch {
    return "代理地址格式无效，请填写协议、主机和端口。";
  }
}
