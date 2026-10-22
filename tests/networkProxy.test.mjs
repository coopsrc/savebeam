import assert from "node:assert/strict";
import test from "node:test";
import { validateProxyUrl } from "../src/features/settings/validateProxyUrl.ts";

test("proxy form accepts supported schemes and IPv6 endpoints", () => {
  for (const value of [
    " http://127.0.0.1:7890 ",
    "https://proxy.example:443",
    "socks4://localhost:1080",
    "socks4a://localhost:1080",
    "socks5://localhost:1080",
    "socks5h://[::1]:1080",
  ])
    assert.equal(validateProxyUrl(value), null);
});
test("proxy form rejects credentials, unsupported schemes and option injection without echoing input", () => {
  for (const value of [
    "",
    "127.0.0.1:7890",
    "file:///secret",
    "ftp://localhost",
    "http://localhost:0",
    "http://localhost:65536",
    "http://user:secret@host",
    "http://@host",
    "http://host/path",
    "http://host?",
    "http://host#",
    "http://host\n--exec=secret",
    "http://host\\secret",
    "x".repeat(2049),
  ]) {
    const error = validateProxyUrl(value);
    assert.ok(error, value);
    assert.ok(!error.includes("secret"));
  }
});
