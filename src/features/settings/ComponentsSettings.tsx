import { t, useUiLocale } from "../../i18n/translate.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
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
import { componentRecommendation, installationPlatform } from "./componentInstallGuides";
import { localComponentSummary, normalizeComponentKinds } from "./componentStatus";

const componentNames: Record<ComponentKind, string> = {
  yt_dlp: "yt-dlp",
  ffmpeg: "FFmpeg",
  ffprobe: "ffprobe",
  javascript_runtime: "JavaScript runtime",
};

const sourceNames: Record<NonNullable<ComponentInstallation["source"]>, string> = {
  get app_managed() {
    return t("应用管理");
  },
  get system() {
    return t("系统安装");
  },
  get custom() {
    return t("自定义路径");
  },
};

const statusNames: Record<ComponentInstallation["status"], string> = {
  get missing() {
    return t("未检测到");
  },
  get available() {
    return t("可用");
  },
  get outdated() {
    return t("需要更新");
  },
  get unhealthy() {
    return t("无法正常运行");
  },
};

export function ComponentsSettings() {
  useUiLocale();

  const profile = usePlatformProfile();
  const platformGuide = installationPlatform(profile.platform);
  const [components, setComponents] = useState<ComponentInstallation[]>([]);
  const [customPaths, setCustomPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<{
    kind: ComponentKind;
    command: string;
  } | null>(null);
  const [removingKind, setRemovingKind] = useState<ComponentKind | null>(null);
  const [releases, setReleases] = useState<ComponentRelease[]>([]);
  const [checkingReleases, setCheckingReleases] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releaseChecked, setReleaseChecked] = useState(false);
  const releasePending = useRef(false);
  const [installingKind, setInstallingKind] = useState<ComponentKind | null>(null);
  const [installProgress, setInstallProgress] = useState<ComponentInstallProgress | null>(null);

  const acceptComponents = useCallback((result: ComponentInstallation[]) => {
    const normalized = normalizeComponentKinds(result);
    setComponents(normalized);
    setCustomPaths((previous) => {
      const next = { ...previous };
      for (const component of normalized) {
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
    setProbeError(null);
    try {
      const result = await invokeCommand<ComponentInstallation[]>("get_component_status");
      acceptComponents(result);
    } catch (cause) {
      setProbeError(cause instanceof Error ? cause.message : t("读取组件状态失败。"));
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
        if (active) setProbeError(cause instanceof Error ? cause.message : t("读取组件状态失败。"));
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
    if (releasePending.current) return;
    releasePending.current = true;
    setCheckingReleases(true);
    setReleaseError(null);
    setReleaseChecked(false);
    setReleases([]);
    try {
      setReleases(
        normalizeComponentKinds(await invokeCommand<ComponentRelease[]>("get_component_releases")),
      );
      setReleaseChecked(true);
    } catch (cause) {
      setReleaseError(cause instanceof Error ? cause.message : t("读取组件发行目录失败。"));
    } finally {
      releasePending.current = false;
      setCheckingReleases(false);
    }
  }, []);

  useEffect(() => {
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
  }, []);

  async function installRelease(kind: ComponentKind) {
    setInstallingKind(kind);
    setInstallProgress(null);
    setError(null);
    try {
      await invokeCommand<ComponentInstallation>("install_component_from_release", { kind });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("安装组件失败。"));
    } finally {
      setInstallingKind(null);
      setInstallProgress(null);
    }
  }

  async function cancelInstall(kind: ComponentKind) {
    try {
      await invokeCommand<void>("cancel_component_install", { kind });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("无法取消组件安装。"));
    }
  }

  async function saveCustomPath(kind: ComponentKind) {
    const path = customPaths[kind]?.trim();
    if (!path) {
      setError(t("请输入组件可执行文件的完整路径。"));
      return;
    }
    try {
      await invokeCommand<void>("set_component_custom_path", { kind, path });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("保存组件路径失败。"));
    }
  }

  async function resetCustomPath(kind: ComponentKind) {
    try {
      await invokeCommand<void>("clear_component_custom_path", { kind });
      setCustomPaths((previous) => ({ ...previous, [kind]: "" }));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("恢复自动检测失败。"));
    }
  }

  async function copyCommand(kind: ComponentKind, command: string) {
    try {
      await navigator.clipboard.writeText(command);
      const copied = { kind, command };
      setCopiedCommand(copied);
      window.setTimeout(
        () => setCopiedCommand((current) => (current === copied ? null : current)),
        1800,
      );
    } catch {
      setError(t("无法访问剪贴板。请手动选择并复制安装命令。"));
    }
  }

  async function removeManaged(kind: ComponentKind) {
    if (
      !window.confirm(
        t("确定删除 Savebeam 管理的 {0} 及其回滚版本？系统和自定义组件不会被删除。", [
          componentNames[kind],
        ]),
      )
    )
      return;
    setRemovingKind(kind);
    setError(null);
    try {
      await invokeCommand("remove_managed_component", { kind });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("无法删除应用管理组件。"));
    } finally {
      setRemovingKind(null);
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{t("运行组件")}</Title>
          <Text c="dimmed" size="sm" mt={4}>
            {t(
              "本机检测仅运行固定的版本参数，不联网。应用管理组件的安装或更新，请单独点击“检查组件更新”。",
            )}
          </Text>
        </div>
        <Group>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={() => void refresh()}
            loading={loading}
          >
            {t("重新检测")}
          </Button>
          <Button
            variant="light"
            onClick={() => void refreshReleases()}
            loading={checkingReleases}
            disabled={installingKind !== null}
          >
            {t("检查组件更新")}
          </Button>
        </Group>
      </Group>

      {error && (
        <ErrorState
          title={t("组件操作失败")}
          description={error}
          actionLabel={t("关闭提示")}
          onAction={() => setError(null)}
        />
      )}
      {probeError && (
        <ErrorState
          title={t("本机组件检测失败")}
          description={probeError}
          onAction={() => void refresh()}
        />
      )}
      {!loading && !probeError && (
        <Text
          role="status"
          size="sm"
          c={localComponentSummary(components).ready ? "green" : "dimmed"}
        >
          {localComponentSummary(components).message}
        </Text>
      )}
      {!loading && probeError && components.length > 0 && (
        <Text size="sm" c="dimmed">
          {t("下方保留上次成功检测结果，当前状态尚未确认。")}
        </Text>
      )}
      {releaseError && (
        <Alert
          role="alert"
          color="blue"
          title={t("在线组件目录暂不可用")}
          withCloseButton
          closeButtonLabel={t("关闭在线检查提示")}
          onClose={() => setReleaseError(null)}
        >
          {releaseError}{" "}
          {t(
            " 仅影响 Savebeam 管理组件的安装或更新，不影响已经可用的本机组件；本机状态以下方检测结果为准。可点击“检查组件更新”重试，或使用下方手动安装建议。",
          )}
        </Alert>
      )}
      {releaseChecked && !checkingReleases && !releaseError && (
        <Text role="status" size="sm" c="dimmed">
          {releases.length
            ? t(
                "在线组件目录已读取，当前平台有 {0} 个发行包；这不代表系统或自定义组件已是最新版。",
                [releases.length],
              )
            : t("当前平台暂无可用的应用管理发行包，不影响系统或自定义组件使用。")}
        </Text>
      )}
      {loading ? (
        <LoadingState label={t("正在检测组件…")} />
      ) : (
        <Stack gap="md">
          {components.map((component) => (
            <Paper key={component.kind} withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text fw={650}>{componentNames[component.kind]}</Text>
                    <Text size="sm" c="dimmed" mt={3}>
                      {component.executablePath ?? t("尚未找到可执行文件")}
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
                    <Badge variant="outline">
                      {t("来源：")}
                      {sourceNames[component.source]}
                    </Badge>
                  )}
                  {component.version && (
                    <Badge variant="outline">
                      {t("版本：")}
                      {component.version}
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {t("许可证：")}
                  {licenseSummary(component.kind)}
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
                            aria-label={t("正在下载 {0}", [componentNames[component.kind]])}
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
                            {t("取消")}
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
                              ? t("安装此版本")
                              : t("安装 / 更新到 {0}", [release.version])}
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
                      {t("删除应用管理版本")}
                    </Button>
                  </Group>
                )}
                <Group align="end" wrap="nowrap">
                  <TextInput
                    className="component-path-input"
                    label={t("自定义可执行文件路径")}
                    placeholder={t("输入完整路径，例如 /opt/homebrew/bin/yt-dlp")}
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
                    {t("使用此路径")}
                  </Button>
                  {component.source === "custom" && (
                    <Button variant="subtle" onClick={() => void resetCustomPath(component.kind)}>
                      {t("自动检测")}
                    </Button>
                  )}
                </Group>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      <Paper component="section" aria-label={t("手动安装建议")} withBorder radius="md" p="md">
        <Stack gap="sm">
          <div>
            <Group justify="space-between" gap="xs">
              <Text fw={650}>{t("手动安装建议")}</Text>
              <Badge variant="light">{platformGuide.label}</Badge>
            </Group>
            <Text size="sm" c="dimmed" mt={3}>
              {t("Savebeam 只提供命令和官方说明链接，不会代替你执行包管理器。")}
            </Text>
          </div>
          {(["yt_dlp", "ffmpeg", "ffprobe", "javascript_runtime"] as const).map((kind) => {
            const guide = componentRecommendation(kind, profile.platform);
            return (
              <Group
                role="group"
                aria-label={t("{0} 手动安装建议", [componentNames[kind]])}
                key={kind}
                justify="space-between"
                align="flex-start"
                wrap="nowrap"
              >
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
                      {t("查看 Deno 官方安装说明")}
                    </a>
                  )}
                </div>
                {guide.command && (
                  <Button
                    aria-label={t("复制 {0} 安装命令", [componentNames[kind]])}
                    size="xs"
                    variant="light"
                    onClick={() => void copyCommand(kind, guide.command!)}
                  >
                    {copiedCommand?.kind === kind && copiedCommand.command === guide.command
                      ? t("已复制")
                      : t("复制命令")}
                  </Button>
                )}
              </Group>
            );
          })}
          <Text size="xs" c="dimmed">
            {platformGuide.note}
          </Text>
          <a href={platformGuide.ffmpegUrl} target="_blank" rel="noreferrer">
            {t("FFmpeg 官网 ")}
            {profile.label} {t(" 下载入口")}
          </a>
        </Stack>
      </Paper>

      <Text size="xs" c="dimmed">
        {t(
          "自定义路径保存在本机，重启后继续使用；文件失效时请重新指定或恢复自动检测。应用管理组件只从已验签的 Savebeam GitHub Releases 清单安装；下载文件通过 SHA-256 校验后才会解压和启用。",
        )}
      </Text>
    </Stack>
  );
}

function licenseSummary(kind: ComponentKind): string {
  if (kind === "yt_dlp")
    return t(
      "yt-dlp 源码为 Unlicense；独立可执行文件还包含第三方依赖，须按对应发行包附带 notices 展示。",
    );
  if (kind === "javascript_runtime") return t("Deno 使用 MIT 许可；具体发布包仍需核对其 notices。");
  return t("FFmpeg 构建许可取决于构建方启用的组件与编译选项；未确定构建前不推断为 LGPL 或 GPL。");
}

export function DiagnosticsPanel() {
  useUiLocale();

  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportReport() {
    setMessage(null);
    setError(null);
    setExporting(true);
    try {
      const approved = await confirm(
        t(
          "诊断文件只包含 Savebeam 版本、操作系统、CPU 架构和下载任务状态计数；不包含链接、标题、Cookie、日志或文件路径。文件只保存在你选择的位置，不会自动发送。是否继续？",
        ),
        { title: t("导出诊断信息"), kind: "info", okLabel: t("继续"), cancelLabel: t("取消") },
      );
      if (!approved) return;

      const destination = await save({
        title: t("保存 Savebeam 诊断信息"),
        defaultPath: "savebeam-diagnostics.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!destination) return;

      await invokeCommand("export_diagnostics", { destination });
      setMessage(t("诊断文件已保存到所选位置。"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("无法导出诊断文件。"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <div>
          <Text fw={650}>{t("诊断信息")}</Text>
          <Text size="sm" c="dimmed" mt={3}>
            {t("仅在你确认并选择保存位置后生成本地 JSON 报告；不会自动上传。")}
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
            {t("导出诊断信息")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function CookiePreferencesPanel() {
  useUiLocale();

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
        setError(reason instanceof Error ? reason.message : t("无法读取登录 Cookie 设置。")),
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
        title: t("选择 cookies.txt"),
        filters: [{ name: t("Cookie 文本文件"), extensions: ["txt"] }],
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
      setError(t("无法打开系统文件选择器，请稍后重试。"));
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
      setError(reason instanceof Error ? reason.message : t("无法保存登录 Cookie 设置。"));
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
          <Text fw={650}>{t("Cookie 与登录")}</Text>
          <Text size="sm" c="dimmed" mt={3}>
            {t("配置后全局用于解析媒体信息和下载，适用于需要登录才能查看的内容或更高画质。")}
          </Text>
        </div>
        <Select
          label={t("登录信息来源")}
          data={[
            { value: "none", label: t("不使用登录信息") },
            { value: "file", label: t("使用 cookies.txt 文件") },
            { value: "browser", label: t("从本机浏览器读取") },
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
              {t("选择 cookies.txt")}
            </Button>
            {preferences.cookiesFilePath && (
              <Text size="sm" c="dimmed">
                {t("已选择：")}
                {preferences.cookiesFilePath.split(/[\\/]/).pop() ?? "cookies.txt"}
              </Text>
            )}
          </Group>
        )}
        {source === "browser" && (
          <Select
            label={t("选择浏览器")}
            placeholder={t("选择已登录的浏览器")}
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
            <Alert color="yellow" title={t("敏感权限确认")}>
              {t(
                "yt-dlp 将在本机读取登录 Cookie，并同时用于解析和下载。Cookie 可代表你的账号访问网站； cookies.txt 可能被 yt-dlp 更新，浏览器配置可能需要先退出浏览器。应用不会读取或上传 Cookie 内容。仅对你信任的网站使用。",
              )}
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
              label={t("我授权 Savebeam 全局使用所选登录 Cookie 进行媒体解析和下载")}
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
            {t("Cookie 设置已保存。")}
          </Text>
        )}
        <Group justify="flex-end">
          <Button onClick={() => void savePreferences()} loading={saving}>
            {t("保存 Cookie 设置")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function DownloadPreferencesPanel() {
  useUiLocale();

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
        setError(reason instanceof Error ? reason.message : t("无法读取下载设置。")),
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
      setError(reason instanceof Error ? reason.message : t("无法保存下载设置。"));
    } finally {
      setSaving(false);
    }
  }

  async function chooseDirectory() {
    setSelectingDirectory(true);
    setError(null);
    try {
      const selected = await open({
        title: t("选择默认下载目录"),
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
      setError(t("无法打开系统文件夹选择器，请手动填写目录或稍后重试。"));
    } finally {
      setSelectingDirectory(false);
    }
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <div>
          <Text fw={650}>{t("下载设置")}</Text>
          <Text size="sm" c="dimmed" mt={3}>
            {t("目录必须已存在；留空时使用系统下载目录。")}
          </Text>
        </div>
        <TextInput
          label={t("默认下载目录")}
          placeholder={t("留空使用系统下载目录")}
          value={preferences.outputDirectory}
          disabled={saving || selectingDirectory}
          rightSectionWidth={44}
          rightSectionPointerEvents="auto"
          rightSection={
            <Tooltip label={t("选择文件夹")}>
              <ActionIcon
                type="button"
                variant="subtle"
                color="gray"
                size={32}
                aria-label={t("选择下载文件夹")}
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
          <Select
            label={t("文件重名时")}
            value={preferences.conflictStrategy}
            data={[
              { value: "skip", label: t("跳过已有文件") },
              { value: "overwrite", label: t("覆盖已有文件") },
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
            {t("设置已保存。")}
          </Text>
        )}
        <Group justify="flex-end">
          <Button onClick={() => void save()} loading={saving} disabled={selectingDirectory}>
            {t("保存下载设置")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
