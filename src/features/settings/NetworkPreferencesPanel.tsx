import { useEffect, useState } from "react";
import { Button, Group, Paper, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { invokeCommand, IpcError } from "../../ipc/client";
import type { NetworkPreferences } from "../../types/domain";
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
  }

  async function persist(next: NetworkPreferences) {
    setSaved(false);
    const validation = next.proxyMode === "custom" ? validateProxyUrl(next.proxyUrl) : null;
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
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

  const disabled = loading || saving || !loaded;
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
            disabled={loading || saving}
            onClick={() => void persist(defaults)}
          >
            恢复默认网络
          </Button>
          <Button loading={saving} disabled={disabled} onClick={() => void persist(preferences)}>
            保存网络设置
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
