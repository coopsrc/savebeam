import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { ErrorState, LoadingState } from "../../components/states/AppStates";
import { usePlatformProfile } from "../../app/platform/profile";
import { invokeCommand } from "../../ipc/client";
import type { ComponentInstallation, ComponentKind } from "../../types/domain";

const componentNames: Record<ComponentKind, string> = {
  yt_dlp: "yt-dlp",
  ffmpeg: "FFmpeg",
  ffprobe: "ffprobe",
  javascript_runtime: "JavaScript runtime",
};

const sourceNames: Record<NonNullable<ComponentInstallation["source"]>, string> = {
  app_managed: "应用管理",
  system: "系统安装",
  custom: "自定义路径",
};

const statusNames: Record<ComponentInstallation["status"], string> = {
  missing: "未检测到",
  available: "可用",
  outdated: "需要更新",
  unhealthy: "无法正常运行",
};

function recommendation(kind: ComponentKind, platform: "macos" | "windows" | "linux") {
  if (platform === "macos") {
    if (kind === "yt_dlp") return { command: "brew install yt-dlp" };
    if (kind === "ffmpeg" || kind === "ffprobe") {
      return { command: "brew install ffmpeg", note: "ffprobe 随 FFmpeg 一同提供。" };
    }
    return { command: "brew install deno" };
  }

  if (platform === "windows") {
    if (kind === "yt_dlp") return { command: "winget install --id yt-dlp.yt-dlp -e" };
    if (kind === "ffmpeg" || kind === "ffprobe") {
      return {
        command: "winget install --id Gyan.FFmpeg -e",
        note: "此 winget 包由 Gyan 提供；ffprobe 通常包含在该构建中。",
      };
    }
    return { command: "winget install --id DenoLand.Deno -e" };
  }

  if (kind === "yt_dlp")
    return {
      command: "sudo apt-get install yt-dlp",
      note: "Ubuntu/Debian 示例；其他发行版请使用其包管理器。",
    };
  if (kind === "ffmpeg" || kind === "ffprobe") {
    return {
      command: "sudo apt-get install ffmpeg",
      note: "Ubuntu/Debian 示例；ffprobe 随 FFmpeg 一同提供。",
    };
  }
  return {
    note: "Deno 没有官方 apt 源；请查看 Deno 官方安装说明或使用发行版推荐的包管理器。",
    url: "https://docs.deno.com/runtime/getting_started/installation/",
  };
}

export function ComponentsSettings() {
  const profile = usePlatformProfile();
  const [components, setComponents] = useState<ComponentInstallation[]>([]);
  const [customPaths, setCustomPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<ComponentKind | null>(null);

  const acceptComponents = useCallback((result: ComponentInstallation[]) => {
    setComponents(result);
    setCustomPaths((previous) => {
      const next = { ...previous };
      for (const component of result) {
        if (component.source === "custom" && component.executablePath) {
          next[component.kind] = component.executablePath;
        }
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeCommand<ComponentInstallation[]>("get_component_status");
      acceptComponents(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取组件状态失败。");
    } finally {
      setLoading(false);
    }
  }, [acceptComponents]);

  useEffect(() => {
    let active = true;
    async function loadInitialComponents() {
      try {
        const result = await invokeCommand<ComponentInstallation[]>("get_component_status");
        if (active) acceptComponents(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "读取组件状态失败。");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadInitialComponents();
    return () => {
      active = false;
    };
  }, [acceptComponents]);

  async function saveCustomPath(kind: ComponentKind) {
    const path = customPaths[kind]?.trim();
    if (!path) {
      setError("请输入组件可执行文件的完整路径。");
      return;
    }
    try {
      await invokeCommand<void>("set_component_custom_path", { kind, path });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存组件路径失败。");
    }
  }

  async function resetCustomPath(kind: ComponentKind) {
    try {
      await invokeCommand<void>("clear_component_custom_path", { kind });
      setCustomPaths((previous) => ({ ...previous, [kind]: "" }));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复自动检测失败。");
    }
  }

  async function copyCommand(kind: ComponentKind, command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedKind(kind);
      window.setTimeout(() => setCopiedKind(null), 1800);
    } catch {
      setError("无法访问剪贴板。请手动选择并复制安装命令。");
    }
  }

  return (
    <main className="settings-page">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>运行组件</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Savebeam 不会覆盖系统或自定义组件。组件检测只运行固定的版本参数。
            </Text>
          </div>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={() => void refresh()}
            loading={loading}
          >
            重新检测
          </Button>
        </Group>

        {error && (
          <ErrorState title="组件操作失败" description={error} onAction={() => void refresh()} />
        )}
        {loading ? (
          <LoadingState label="正在检测组件…" />
        ) : (
          <Stack gap="md">
            {components.map((component) => (
              <Paper key={component.kind} withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text fw={650}>{componentNames[component.kind]}</Text>
                      <Text size="sm" c="dimmed" mt={3}>
                        {component.executablePath ?? "尚未找到可执行文件"}
                      </Text>
                    </div>
                    <Badge
                      color={
                        component.status === "available"
                          ? "green"
                          : component.status === "missing"
                            ? "gray"
                            : "yellow"
                      }
                      variant="light"
                    >
                      {statusNames[component.status]}
                    </Badge>
                  </Group>
                  <Group gap="xs">
                    {component.source && (
                      <Badge variant="outline">来源：{sourceNames[component.source]}</Badge>
                    )}
                    {component.version && (
                      <Badge variant="outline">版本：{component.version}</Badge>
                    )}
                  </Group>
                  <Group align="end" wrap="nowrap">
                    <TextInput
                      className="component-path-input"
                      label="自定义可执行文件路径"
                      placeholder="输入完整路径，例如 /opt/homebrew/bin/yt-dlp"
                      value={customPaths[component.kind] ?? ""}
                      onChange={(event) =>
                        setCustomPaths((previous) => ({
                          ...previous,
                          [component.kind]: event.currentTarget.value,
                        }))
                      }
                    />
                    <Button variant="light" onClick={() => void saveCustomPath(component.kind)}>
                      使用此路径
                    </Button>
                    {component.source === "custom" && (
                      <Button variant="subtle" onClick={() => void resetCustomPath(component.kind)}>
                        自动检测
                      </Button>
                    )}
                  </Group>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}

        <Paper withBorder radius="md" p="md">
          <Stack gap="sm">
            <div>
              <Text fw={650}>手动安装建议</Text>
              <Text size="sm" c="dimmed" mt={3}>
                Savebeam 只提供命令和官方说明链接，不会代替你执行包管理器。
              </Text>
            </div>
            {(["yt_dlp", "ffmpeg", "ffprobe", "javascript_runtime"] as const).map((kind) => {
              const guide = recommendation(kind, profile.platform);
              return (
                <Group key={kind} justify="space-between" align="flex-start" wrap="nowrap">
                  <div className="package-guide-copy">
                    <Text size="sm" fw={550}>
                      {componentNames[kind]}
                    </Text>
                    {guide.command ? (
                      <Text size="sm" className="package-command">
                        {guide.command}
                      </Text>
                    ) : null}
                    {guide.note && (
                      <Text size="xs" c="dimmed">
                        {guide.note}
                      </Text>
                    )}
                    {guide.url && (
                      <a href={guide.url} target="_blank" rel="noreferrer">
                        查看 Deno 官方安装说明
                      </a>
                    )}
                  </div>
                  {guide.command && (
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => void copyCommand(kind, guide.command!)}
                    >
                      {copiedKind === kind ? "已复制" : "复制命令"}
                    </Button>
                  )}
                </Group>
              );
            })}
            <Text size="xs" c="dimmed">
              macOS 命令来自 Homebrew；Windows 使用 WinGet；Linux 命令为 Ubuntu/Debian 示例。
            </Text>
            <a href="https://ffmpeg.org/download.html" target="_blank" rel="noreferrer">
              FFmpeg 官网平台下载入口
            </a>
          </Stack>
        </Paper>

        <Text size="xs" c="dimmed">
          自定义路径仅保存在本次运行内存中；持久化设置将在后续任务中接入。当前不提供组件下载或更新。
        </Text>
      </Stack>
    </main>
  );
}
