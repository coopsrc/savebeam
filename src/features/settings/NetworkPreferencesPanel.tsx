import { useEffect, useState } from "react";
import { Badge, Button, Group, Paper, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { invokeCommand, IpcError } from "../../ipc/client";
import type {
  ConnectionCheck,
  NetworkConnectionTestResult,
  NetworkPreferences,
} from "../../types/domain";
import { validateProxyUrl } from "./validateProxyUrl";

const defaults: NetworkPreferences = { proxyMode: "default", proxyUrl: "" };

export function NetworkPreferencesPanel() {
  const [preferences, setPreferences] = useState<NetworkPreferences>(defaults);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<NetworkConnectionTestResult | null>(null);

  useEffect(() => {
    let active = true;
    invokeCommand<NetworkPreferences>("get_network_preferences")
      .then((value) => {
        if (active) {
          setPreferences(value);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setError("无法读取网络设置，请重试或恢复默认网络。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  function change(next: NetworkPreferences) {
    setPreferences(next);
    setSaved(false);
    setError(null);
    setTestResult(null);
  }

  async function persist(next: NetworkPreferences) {
    if (loading || saving || testing) return;
    setSaved(false);
    const validation = next.proxyMode === "custom" ? validateProxyUrl(next.proxyUrl) : null;
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const value = await invokeCommand<NetworkPreferences>("save_network_preferences", {
        preferences: { ...next, proxyUrl: next.proxyMode === "custom" ? next.proxyUrl.trim() : "" },
      });
      setPreferences(value);
      setLoaded(true);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof IpcError ? reason.contextMessage : "无法保存网络设置，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!loaded || loading || saving || testing) return;
    const validation =
      preferences.proxyMode === "custom" ? validateProxyUrl(preferences.proxyUrl) : null;
    setTestResult(null);
    if (validation) {
      setError(validation);
      return;
    }
    setTesting(true);
    setError(null);
    try {
      setTestResult(
        await invokeCommand<NetworkConnectionTestResult>("test_network_connection", {
          preferences: {
            ...preferences,
            proxyUrl: preferences.proxyMode === "custom" ? preferences.proxyUrl.trim() : "",
          },
        }),
      );
    } catch (reason) {
      setError(reason instanceof IpcError ? reason.contextMessage : "无法完成连接测试，请重试。");
    } finally {
      setTesting(false);
    }
  }

  const disabled = loading || saving || testing || !loaded;
  return (
    <Paper component="section" aria-label="网络与代理" withBorder radius="md" p="md">
      <Stack gap="sm">
        <div>
          <Title order={3}>网络与代理</Title>
          <Text size="sm" c="dimmed" mt={3}>
            用于视频解析、下载、订阅检查和封面请求。组件下载与应用更新暂不使用此设置。
          </Text>
        </div>
        <Select
          label="连接方式"
          data={[
            { value: "default", label: "默认网络" },
            { value: "direct", label: "直连（不使用代理）" },
            { value: "custom", label: "自定义代理" },
          ]}
          value={preferences.proxyMode}
          disabled={disabled}
          allowDeselect={false}
          onChange={(value) => {
            if (value === "default" || value === "direct" || value === "custom")
              change({
                proxyMode: value,
                proxyUrl: value === "custom" ? preferences.proxyUrl : "",
              });
          }}
        />
        {preferences.proxyMode === "custom" ? (
          <TextInput
            label="代理地址"
            placeholder="http://127.0.0.1:7890"
            description="支持 HTTP、HTTPS、SOCKS4/4a、SOCKS5/5h。请填写实际代理端口；暂不支持账号密码。"
            value={preferences.proxyUrl}
            onChange={(event) => change({ ...preferences, proxyUrl: event.currentTarget.value })}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        ) : (
          <Text size="sm" c="dimmed">
            {preferences.proxyMode === "direct"
              ? "显式禁用此类请求的代理，不修改系统代理配置。"
              : "不覆盖工具的默认代理行为。GUI 不一定继承终端环境，连接失败时请使用自定义代理。"}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          保存后对新启动和重试的请求生效，正在运行的任务不受影响。代理仅解决网络连接问题，不代表可以访问所有视频。
        </Text>
        <Text size="xs" c="dimmed">
          测试当前填写的配置，不自动保存。测试会向 YouTube 发起一次不带 Cookie 的 HTTPS 请求，通常在
          12 秒内完成，不下载视频。
        </Text>
        {testResult && (
          <Paper component="section" aria-label="连接测试结果" withBorder p="sm">
            <Stack gap="sm" aria-live="polite">
              <ConnectionCheckRow title="代理端点（TCP）" result={testResult.proxy} />
              <ConnectionCheckRow title="YouTube 访问" result={testResult.youtube} />
            </Stack>
          </Paper>
        )}
        {error && (
          <Text c="red" size="sm" role="alert">
            {error}
          </Text>
        )}
        {saved && (
          <Text c="green" size="sm" role="status">
            网络设置已保存。
          </Text>
        )}
        <Group justify="flex-end">
          {!loaded && !loading && (
            <Button
              variant="subtle"
              onClick={() => {
                setLoading(true);
                setError(null);
                setReload((value) => value + 1);
              }}
            >
              重新读取网络设置
            </Button>
          )}
          <Button
            variant="subtle"
            disabled={loading || saving || testing}
            onClick={() => void persist(defaults)}
          >
            恢复默认网络
          </Button>
          <Button
            variant="light"
            loading={testing}
            disabled={disabled}
            onClick={() => void testConnection()}
          >
            测试连接
          </Button>
          <Button loading={saving} disabled={disabled} onClick={() => void persist(preferences)}>
            保存网络设置
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function ConnectionCheckRow({ title, result }: { title: string; result: ConnectionCheck }) {
  const styles = {
    success: { color: "green", label: "通过" },
    failed: { color: "red", label: "失败" },
    limited: { color: "yellow", label: "受限" },
    skipped: { color: "gray", label: "未执行" },
  } as const;
  const style = styles[result.status];
  return (
    <Stack gap={3}>
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Group gap="xs">
          {result.durationMs !== null && (
            <Text size="xs" c="dimmed">
              耗时 {result.durationMs} ms
            </Text>
          )}
          <Badge color={style.color} variant="light">
            {style.label}
          </Badge>
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        {result.message}
      </Text>
    </Stack>
  );
}
