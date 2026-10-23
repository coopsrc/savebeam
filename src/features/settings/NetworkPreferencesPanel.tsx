import { t, useUiLocale } from "../../i18n/translate.ts";
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
  useUiLocale();

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
        if (active) setError(t("无法读取网络设置，请重试或恢复默认网络。"));
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
      setError(
        reason instanceof IpcError ? reason.contextMessage : t("无法保存网络设置，请重试。"),
      );
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
      setError(
        reason instanceof IpcError ? reason.contextMessage : t("无法完成连接测试，请重试。"),
      );
    } finally {
      setTesting(false);
    }
  }

  const disabled = loading || saving || testing || !loaded;
  return (
    <Paper component="section" aria-label={t("网络与代理")} withBorder radius="md" p="md">
      <Stack gap="sm">
        <div>
          <Title order={3}>{t("网络与代理")}</Title>
          <Text size="sm" c="dimmed" mt={3}>
            {t(
              "保存自定义代理后，可在添加下载时勾选“使用代理”，统一用于该次解析、大小估算、封面与下载；不勾选则直连。订阅检查沿用此处的连接方式。组件下载与应用更新暂不使用此设置。",
            )}
          </Text>
        </div>
        <Select
          label={t("连接方式")}
          data={[
            { value: "default", label: t("默认网络") },
            { value: "direct", label: t("直连（不使用代理）") },
            { value: "custom", label: t("自定义代理") },
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
            label={t("代理地址")}
            placeholder="http://127.0.0.1:7890"
            description={t(
              "支持 HTTP、HTTPS、SOCKS4/4a、SOCKS5/5h。请填写实际代理端口；暂不支持账号密码。",
            )}
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
              ? t("显式禁用此类请求的代理，不修改系统代理配置。")
              : t("不覆盖工具的默认代理行为。GUI 不一定继承终端环境，连接失败时请使用自定义代理。")}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          {t(
            "任务会保存是否使用代理；勾选的任务在启动或重试时读取最新自定义地址，未勾选的任务始终直连。正在运行的任务不受影响。代理仅解决网络连接问题，不代表可以访问所有视频。",
          )}
        </Text>
        <Text size="xs" c="dimmed">
          {t(
            "测试当前填写的配置，不自动保存。测试会向 YouTube 发起一次不带 Cookie 的 HTTPS 请求，通常在 12 秒内完成，不下载视频。",
          )}
        </Text>
        {testResult && (
          <Paper component="section" aria-label={t("连接测试结果")} withBorder p="sm">
            <Stack gap="sm" aria-live="polite">
              <ConnectionCheckRow title={t("代理端点（TCP）")} result={testResult.proxy} />
              <ConnectionCheckRow title={t("YouTube 访问")} result={testResult.youtube} />
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
            {t("网络设置已保存。")}
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
              {t("重新读取网络设置")}
            </Button>
          )}
          <Button
            variant="subtle"
            disabled={loading || saving || testing}
            onClick={() => void persist(defaults)}
          >
            {t("恢复默认网络")}
          </Button>
          <Button
            variant="light"
            loading={testing}
            disabled={disabled}
            onClick={() => void testConnection()}
          >
            {t("测试连接")}
          </Button>
          <Button loading={saving} disabled={disabled} onClick={() => void persist(preferences)}>
            {t("保存网络设置")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function ConnectionCheckRow({ title, result }: { title: string; result: ConnectionCheck }) {
  useUiLocale();

  const styles = {
    success: { color: "green", label: t("通过") },
    failed: { color: "red", label: t("失败") },
    limited: { color: "yellow", label: t("受限") },
    skipped: { color: "gray", label: t("未执行") },
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
              {t("耗时 ")}
              {result.durationMs} ms
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
