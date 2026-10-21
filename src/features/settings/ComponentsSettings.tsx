import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Progress,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconFolderOpen, IconRefresh, IconTrash } from "@tabler/icons-react";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { ErrorState, LoadingState } from "../../components/states/AppStates";
import { usePlatformProfile } from "../../app/platform/profile";
import { invokeCommand } from "../../ipc/client";
import type {
  ComponentInstallation,
  ComponentInstallProgress,
  ComponentKind,
  ComponentRelease,
  CookiePreferences,
  CookieBrowser,
  DownloadPreferences,
} from "../../types/domain";
import { IPC_EVENTS, listenToEvent } from "../../ipc/events";

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
  const [removingKind, setRemovingKind] = useState<ComponentKind | null>(null);
  const [releases, setReleases] = useState<ComponentRelease[]>([]);
  const [checkingReleases, setCheckingReleases] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [installingKind, setInstallingKind] = useState<ComponentKind | null>(null);
  const [installProgress, setInstallProgress] = useState<ComponentInstallProgress | null>(null);

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

  const refreshReleases = useCallback(async () => {
    setCheckingReleases(true);
    setReleaseError(null);
    try {
      setReleases(await invokeCommand<ComponentRelease[]>("get_component_releases"));
    } catch (cause) {
      setReleaseError(cause instanceof Error ? cause.message : "读取组件发行目录失败。");
    } finally {
      setCheckingReleases(false);
    }
  }, []);

  useEffect(() => {
    void invokeCommand<ComponentRelease[]>("get_component_releases")
      .then(setReleases)
      .catch((cause: unknown) =>
        setReleaseError(cause instanceof Error ? cause.message : "读取组件发行目录失败。"),
      );
    let unlisten: (() => void) | undefined;
    let active = true;
    void listenToEvent<ComponentInstallProgress>(
      IPC_EVENTS.componentInstallProgress,
      (progress) => {
        if (active) setInstallProgress(progress);
      },
    )
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [refreshReleases]);

  async function installRelease(kind: ComponentKind) {
    setInstallingKind(kind);
    setInstallProgress(null);
    setError(null);
    try {
      await invokeCommand<ComponentInstallation>("install_component_from_release", { kind });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "安装组件失败。");
    } finally {
      setInstallingKind(null);
      setInstallProgress(null);
    }
  }

  async function cancelInstall(kind: ComponentKind) {
    try {
      await invokeCommand<void>("cancel_component_install", { kind });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法取消组件安装。");
    }
  }

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

  async function removeManaged(kind: ComponentKind) {
    if (
      !window.confirm(
        `确定删除 Savebeam 管理的 ${componentNames[kind]} 及其回滚版本？系统和自定义组件不会被删除。`,
      )
    )
      return;
    setRemovingKind(kind);
    setError(null);
    try {
      await invokeCommand("remove_managed_component", { kind });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法删除应用管理组件。");
    } finally {
      setRemovingKind(null);
    }
  }

  return (
    <main className="settings-page">
      <Stack gap="lg">
        <CookiePreferencesPanel />
        <DownloadPreferencesPanel />
        <DiagnosticsPanel />
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>运行组件</Title>
            <Text c="dimmed" size="sm" mt={4}>
              Savebeam 不会覆盖系统或自定义组件。组件检测只运行固定的版本参数。
            </Text>
          </div>
          <Group>
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              onClick={() => void refresh()}
              loading={loading}
            >
              重新检测
            </Button>
            <Button
              variant="light"
              onClick={() => void refreshReleases()}
              loading={checkingReleases}
              disabled={installingKind !== null}
            >
              检查组件更新
            </Button>
          </Group>
        </Group>

        {error && (
          <ErrorState title="组件操作失败" description={error} onAction={() => void refresh()} />
        )}
        {releaseError && (
          <Text role="alert" c="orange" size="sm">
            暂时无法检查应用管理组件：{releaseError} 可使用下方手动安装建议，或稍后重试。
          </Text>
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
                  <Text size="xs" c="dimmed">
                    许可证：{licenseSummary(component.kind)}
                  </Text>
                  {(() => {
                    const release = releases.find((item) => item.kind === component.kind);
                    if (!release) return null;
                    const isInstalling = installingKind === component.kind;
                    const progressPercent =
                      installProgress && installProgress.totalBytes > 0
                        ? Math.min(
                            100,
                            (installProgress.downloadedBytes / installProgress.totalBytes) * 100,
                          )
                        : 0;
                    return (
                      <Stack gap="xs">
                        <Text size="sm" c="dimmed">
                          GitHub Releases：{release.version} · {release.provider}
                        </Text>
                        {isInstalling ? (
                          <Group align="end" wrap="nowrap">
                            <Progress
                              flex={1}
                              value={progressPercent}
                              aria-label={`正在下载 ${componentNames[component.kind]}`}
                            />
                            <Text size="xs" c="dimmed" miw={72} ta="right">
                              {progressPercent.toFixed(0)}%
                            </Text>
                            <Button
                              size="xs"
                              color="red"
                              variant="subtle"
                              onClick={() => void cancelInstall(component.kind)}
                            >
                              取消
                            </Button>
                          </Group>
                        ) : (
                          <Group justify="flex-end">
                            <Button
                              size="sm"
                              variant="light"
                              loading={checkingReleases}
                              disabled={installingKind !== null}
                              onClick={() => void installRelease(component.kind)}
                            >
                              {component.version === release.version
                                ? "安装此版本"
                                : `安装 / 更新到 ${release.version}`}
                            </Button>
                          </Group>
                        )}
                      </Stack>
                    );
                  })()}
                  {component.source === "app_managed" && (
                    <Group justify="flex-end">
                      <Button
                        color="red"
                        variant="subtle"
                        leftSection={<IconTrash size={15} />}
                        loading={removingKind === component.kind}
                        onClick={() => void removeManaged(component.kind)}
                      >
                        删除应用管理版本
                      </Button>
                    </Group>
                  )}
                  <Group align="end" wrap="nowrap">
                    <TextInput
                      className="component-path-input"
                      label="自定义可执行文件路径"
                      placeholder="输入完整路径，例如 /opt/homebrew/bin/yt-dlp"
                      value={customPaths[component.kind] ?? ""}
                      onChange={(event) => {
                        const path = event.currentTarget.value;
                        setCustomPaths((previous) => ({
                          ...previous,
                          [component.kind]: path,
                        }));
                      }}
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
          自定义路径仅保存在本次运行内存中。应用管理组件只从已验签的 Savebeam GitHub Releases
          清单安装；下载文件通过 SHA-256 校验后才会解压和启用。
        </Text>
      </Stack>
    </main>
  );
}

function licenseSummary(kind: ComponentKind): string {
  if (kind === "yt_dlp")
    return "yt-dlp 源码为 Unlicense；独立可执行文件还包含第三方依赖，须按对应发行包附带 notices 展示。";
  if (kind === "javascript_runtime") return "Deno 使用 MIT 许可；具体发布包仍需核对其 notices。";
  return "FFmpeg 构建许可取决于构建方启用的组件与编译选项；未确定构建前不推断为 LGPL 或 GPL。";
}

function DiagnosticsPanel() {
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportReport() {
    setMessage(null);
    setError(null);
    setExporting(true);
    try {
      const approved = await confirm(
        "诊断文件只包含 Savebeam 版本、操作系统、CPU 架构和下载任务状态计数；不包含链接、标题、Cookie、日志或文件路径。文件只保存在你选择的位置，不会自动发送。是否继续？",
        { title: "导出诊断信息", kind: "info", okLabel: "继续", cancelLabel: "取消" },
      );
      if (!approved) return;

      const destination = await save({
        title: "保存 Savebeam 诊断信息",
        defaultPath: "savebeam-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!destination) return;

      await invokeCommand("export_diagnostics", { destination });
      setMessage("诊断文件已保存到所选位置。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法导出诊断文件。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <div>
          <Text fw={650}>隐私与诊断</Text>
          <Text size="sm" c="dimmed" mt={3}>
            仅在你确认并选择保存位置后生成本地 JSON 报告；不会自动上传。
          </Text>
        </div>
        {error && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
        {message && (
          <Text size="sm" c="green" role="status">
            {message}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="light" loading={exporting} onClick={() => void exportReport()}>
            导出诊断信息
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function CookiePreferencesPanel() {
  const [preferences, setPreferences] = useState<CookiePreferences>({
    cookiesFilePath: null,
    cookiesBrowser: null,
    accessConfirmed: false,
  });
  const [source, setSource] = useState<"none" | "file" | "browser">("none");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invokeCommand<CookiePreferences>("get_cookie_preferences")
      .then((value) => {
        setPreferences(value);
        setSource(value.cookiesFilePath ? "file" : value.cookiesBrowser ? "browser" : "none");
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "无法读取登录 Cookie 设置。"),
      );
  }, []);

  function changeSource(value: "none" | "file" | "browser") {
    setSource(value);
    setPreferences((current) => ({
      ...current,
      cookiesFilePath: value === "file" ? current.cookiesFilePath : null,
      cookiesBrowser: value === "browser" ? current.cookiesBrowser : null,
      accessConfirmed: value === "none" ? false : current.accessConfirmed,
    }));
    setSaved(false);
  }

  async function chooseCookiesFile() {
    try {
      const selected = await open({
        title: "选择 cookies.txt",
        filters: [{ name: "Cookie 文本文件", extensions: ["txt"] }],
        multiple: false,
        directory: false,
        fileAccessMode: "scoped",
      });
      if (typeof selected === "string") {
        setPreferences((value) => ({
          ...value,
          cookiesFilePath: selected,
          accessConfirmed: false,
        }));
        setSaved(false);
      }
    } catch {
      setError("无法打开系统文件选择器，请稍后重试。");
    }
  }

  async function savePreferences() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await invokeCommand<CookiePreferences>("save_cookie_preferences", {
        preferences,
      });
      setPreferences(next);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存登录 Cookie 设置。");
    } finally {
      setSaving(false);
    }
  }

  const browserOptions: { value: CookieBrowser; label: string }[] = [
    { value: "brave", label: "Brave" },
    { value: "chrome", label: "Google Chrome" },
    { value: "chromium", label: "Chromium" },
    { value: "edge", label: "Microsoft Edge" },
    { value: "firefox", label: "Firefox" },
    { value: "opera", label: "Opera" },
    { value: "safari", label: "Safari" },
    { value: "vivaldi", label: "Vivaldi" },
    { value: "whale", label: "Whale" },
  ];

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <div>
          <Text fw={650}>Cookie 与登录</Text>
          <Text size="sm" c="dimmed" mt={3}>
            配置后全局用于解析媒体信息和下载，适用于需要登录才能查看的内容或更高画质。
          </Text>
        </div>
        <Select
          label="登录信息来源"
          data={[
            { value: "none", label: "不使用登录信息" },
            { value: "file", label: "使用 cookies.txt 文件" },
            { value: "browser", label: "从本机浏览器读取" },
          ]}
          value={source}
          onChange={(value) =>
            changeSource(value === "file" || value === "browser" ? value : "none")
          }
          allowDeselect={false}
        />
        {source === "file" && (
          <Group align="center" wrap="wrap">
            <Button variant="default" onClick={() => void chooseCookiesFile()}>
              选择 cookies.txt
            </Button>
            {preferences.cookiesFilePath && (
              <Text size="sm" c="dimmed">
                已选择：{preferences.cookiesFilePath.split(/[\\/]/).pop() ?? "cookies.txt"}
              </Text>
            )}
          </Group>
        )}
        {source === "browser" && (
          <Select
            label="选择浏览器"
            placeholder="选择已登录的浏览器"
            data={browserOptions}
            value={preferences.cookiesBrowser}
            onChange={(value) => {
              setPreferences((current) => ({
                ...current,
                cookiesBrowser: value as CookieBrowser | null,
                accessConfirmed: false,
              }));
              setSaved(false);
            }}
            searchable
            allowDeselect={false}
          />
        )}
        {source !== "none" && (
          <>
            <Alert color="yellow" title="敏感权限确认">
              yt-dlp 将在本机读取登录 Cookie，并同时用于解析和下载。Cookie 可代表你的账号访问网站；
              cookies.txt 可能被 yt-dlp 更新，浏览器配置可能需要先退出浏览器。应用不会读取或上传
              Cookie 内容。仅对你信任的网站使用。
            </Alert>
            <Checkbox
              checked={preferences.accessConfirmed}
              disabled={
                (source === "file" && !preferences.cookiesFilePath) ||
                (source === "browser" && !preferences.cookiesBrowser)
              }
              onChange={(event) => {
                const accessConfirmed = event.currentTarget.checked;
                setPreferences((value) => ({
                  ...value,
                  accessConfirmed,
                }));
                setSaved(false);
              }}
              label="我授权 Savebeam 全局使用所选登录 Cookie 进行媒体解析和下载"
            />
          </>
        )}
        {error && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
        {saved && (
          <Text size="sm" c="green" role="status">
            Cookie 设置已保存。
          </Text>
        )}
        <Group justify="flex-end">
          <Button onClick={() => void savePreferences()} loading={saving}>
            保存 Cookie 设置
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function DownloadPreferencesPanel() {
  const [preferences, setPreferences] = useState<DownloadPreferences>({
    outputDirectory: "",
    maxConcurrent: 1,
    conflictStrategy: "skip",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectingDirectory, setSelectingDirectory] = useState(false);

  useEffect(() => {
    invokeCommand<DownloadPreferences>("get_download_preferences")
      .then(setPreferences)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "无法读取下载设置。"),
      );
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      setPreferences(
        await invokeCommand<DownloadPreferences>("save_download_preferences", { preferences }),
      );
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存下载设置。");
    } finally {
      setSaving(false);
    }
  }

  async function chooseDirectory() {
    setSelectingDirectory(true);
    setError(null);
    try {
      const selected = await open({
        title: "选择默认下载目录",
        directory: true,
        multiple: false,
        defaultPath: preferences.outputDirectory.trim() ? preferences.outputDirectory : undefined,
        fileAccessMode: "scoped",
      });
      if (typeof selected === "string") {
        setPreferences((current) => ({ ...current, outputDirectory: selected }));
        setSaved(false);
      }
    } catch {
      setError("无法打开系统文件夹选择器，请手动填写目录或稍后重试。");
    } finally {
      setSelectingDirectory(false);
    }
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <div>
          <Text fw={650}>下载设置</Text>
          <Text size="sm" c="dimmed" mt={3}>
            目录必须已存在；留空时使用系统下载目录。并发数限制为 1–4。
          </Text>
        </div>
        <TextInput
          label="默认下载目录"
          placeholder="留空使用系统下载目录"
          value={preferences.outputDirectory}
          disabled={saving || selectingDirectory}
          rightSectionWidth={44}
          rightSectionPointerEvents="auto"
          rightSection={
            <Tooltip label="选择文件夹">
              <ActionIcon
                type="button"
                variant="subtle"
                color="gray"
                size={32}
                aria-label="选择下载文件夹"
                loading={selectingDirectory}
                disabled={saving || selectingDirectory}
                onClick={() => void chooseDirectory()}
              >
                <IconFolderOpen size={20} aria-hidden="true" />
              </ActionIcon>
            </Tooltip>
          }
          onChange={(event) => {
            const outputDirectory = event.currentTarget.value;
            setPreferences((value) => ({ ...value, outputDirectory }));
            setSaved(false);
            setError(null);
          }}
        />
        <Group grow align="end">
          <NumberInput
            label="最大并发任务数"
            min={1}
            max={4}
            step={1}
            value={preferences.maxConcurrent}
            onChange={(value) =>
              setPreferences((current) => ({
                ...current,
                maxConcurrent: typeof value === "number" ? value : 1,
              }))
            }
          />
          <Select
            label="文件重名时"
            value={preferences.conflictStrategy}
            data={[
              { value: "skip", label: "跳过已有文件" },
              { value: "overwrite", label: "覆盖已有文件" },
            ]}
            onChange={(value) => {
              if (value === "skip" || value === "overwrite")
                setPreferences((current) => ({ ...current, conflictStrategy: value }));
            }}
          />
        </Group>
        {error && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
        {saved && (
          <Text size="sm" c="green" role="status">
            设置已保存。
          </Text>
        )}
        <Group justify="flex-end">
          <Button onClick={() => void save()} loading={saving} disabled={selectingDirectory}>
            保存下载设置
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
