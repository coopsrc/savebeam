import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconRefresh, IconRss } from "@tabler/icons-react";
import { subscriptionApi, type SeriesCandidate, type SeriesSubscription } from "./subscriptionApi";
import { isPending } from "./selection";
import { useAppStore } from "../../stores/appStore";
import type { DownloadOptionDefaults } from "../../types/domain";
import { DownloadOptionsModal } from "../download/DownloadOptionsModal";
import { useDownloadOptions } from "../download/useDownloadOptions";
import { useRetainedPageScroll } from "../../layout/useRetainedPageScroll";
import { SubscriptionEntries } from "./SubscriptionEntries";
import { mergeSubscriptionMetadata, patchEntryMetadata } from "./entryMetadata";

function message(error: unknown) {
  return error instanceof Error ? error.message : "订阅操作失败，请重试。";
}

export function SubscriptionsPage({ active }: { active: boolean }) {
  const root = useRetainedPageScroll(active);
  const location = useLocation();
  const navigate = useNavigate();
  const [url, setUrl] = useState(() => new URLSearchParams(location.search).get("url") ?? "");
  const [prefillEntry, setPrefillEntry] = useState(location.key);
  const prefill = active ? new URLSearchParams(location.search).get("url") : null;
  // A fresh explicit source fills the input, never starts checking or clears other series drafts.
  if (prefill !== null && prefillEntry !== location.key) {
    setPrefillEntry(location.key);
    setUrl(prefill);
  }
  const [subscriptions, setSubscriptions] = useState<SeriesSubscription[]>([]);
  const [candidates, setCandidates] = useState<SeriesCandidate[]>([]);
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [checkErrors, setCheckErrors] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [showDownloaded, setShowDownloaded] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [proxyChoices, setProxyChoices] = useState<Record<number, boolean>>({});
  const {
    options: defaultOptions,
    loading: loadingDefaults,
    error: defaultsError,
    retry: retryDefaults,
  } = useDownloadOptions();
  const [optionOverrides, setOptionOverrides] = useState<Record<number, DownloadOptionDefaults>>(
    {},
  );
  const [editingOptions, setEditingOptions] = useState<number | null>(null);
  const [removing, setRemoving] = useState<SeriesSubscription | null>(null);
  const stopChecks = useRef(false);
  useLayoutEffect(() => {
    if (!active) stopChecks.current = true;
  }, [active]);
  const [checkProgress, setCheckProgress] = useState("");
  const tasks = useAppStore((state) => state.downloadTasks);

  useEffect(() => {
    let disposed = false;
    void Promise.all([subscriptionApi.list(), subscriptionApi.candidates()])
      .then(([list, known]) => {
        if (!disposed) {
          setSubscriptions((previous) => mergeSubscriptionMetadata(previous, list));
          setCandidates(known);
          setBusy(null);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setError(message(error));
          setBusy(null);
        }
      });
    return () => {
      disposed = true;
      stopChecks.current = true;
    };
  }, []);

  // Refresh local state on task changes; this does not contact any video website.
  useEffect(() => {
    let disposed = false;
    void subscriptionApi
      .list()
      .then((list) => {
        if (!disposed) setSubscriptions((previous) => mergeSubscriptionMetadata(previous, list));
      })
      .catch(() => {});
    void subscriptionApi
      .candidates()
      .then((known) => {
        if (!disposed) setCandidates(known);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [tasks]);

  async function act(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (error: unknown) {
      setError(message(error));
    } finally {
      try {
        const list = await subscriptionApi.list();
        setSubscriptions((previous) => mergeSubscriptionMetadata(previous, list));
      } catch (error: unknown) {
        setError(message(error));
      }
      setBusy(null);
    }
  }

  async function check(id: number) {
    try {
      await subscriptionApi.check(id);
      setCheckErrors((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    } catch (error: unknown) {
      setCheckErrors((previous) => ({ ...previous, [id]: message(error) }));
    }
  }

  return (
    <main
      className="task-list-page subscriptions-page"
      ref={root}
      hidden={!active}
      style={active ? undefined : { display: "none" }}
    >
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={2}>系列订阅</Title>
            <Text c="dimmed" size="sm">
              本地保存订阅；手动检查更新，勾选后下载，不会自动下载。
            </Text>
          </div>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            disabled={!!busy || !subscriptions.length}
            loading={busy === "check-all"}
            onClick={() => {
              stopChecks.current = false;
              void act("check-all", async () => {
                let checked = 0;
                for (const item of subscriptions) {
                  if (stopChecks.current) break;
                  setCheckProgress(
                    `正在检查 ${checked + 1}/${subscriptions.length}：${item.title}`,
                  );
                  await check(item.id);
                  checked += 1;
                }
                setCheckProgress(
                  `已检查 ${checked}/${subscriptions.length} 个系列。失败项保留上次结果，可单独重试。`,
                );
              });
            }}
          >
            检查全部更新
          </Button>
        </Group>
        {checkProgress && (
          <Text size="sm" c="dimmed" role="status">
            {checkProgress}
          </Text>
        )}
        {busy === "check-all" && (
          <Button
            variant="subtle"
            onClick={() => {
              stopChecks.current = true;
              setCheckProgress("当前检查完成后停止后续检查（单项最长约 60 秒）。");
            }}
          >
            停止后续检查
          </Button>
        )}
        {error && (
          <Alert color="red" role="alert" title="操作失败">
            {error}
          </Alert>
        )}
        {defaultsError && (
          <Alert color="red" role="alert" title="无法读取下载选项">
            {defaultsError}
            <Button variant="subtle" onClick={retryDefaults}>
              重新读取下载选项
            </Button>
          </Alert>
        )}
        {notice && (
          <Alert color="green" role="status">
            {notice}
            <Button variant="subtle" size="xs" onClick={() => navigate("/tasks")}>
              查看任务
            </Button>
          </Alert>
        )}
        <Paper withBorder p="md" radius="md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && url.trim())
                void act("add", async () => {
                  await subscriptionApi.subscribe(url);
                  setUrl("");
                  setNotice(
                    "已添加订阅，首次检查建立基线；之后新出现的视频会标为新增。旧文件仅按历史中的视频 ID 识别，无法识别的仍列为待下载。",
                  );
                });
            }}
          >
            <Stack gap="sm">
              <Group>
                <IconRss size={20} />
                <Text fw={600}>添加系列订阅</Text>
              </Group>
              {candidates.length > 0 && (
                <Select
                  label="从已下载的系列选择"
                  placeholder="选择历史系列，或在下方填写链接"
                  value={null}
                  disabled={!!busy}
                  data={candidates.map((item) => ({ value: item.url, label: item.title }))}
                  onChange={(value) => {
                    if (value) setUrl(value);
                  }}
                  searchable
                />
              )}
              <TextInput
                label="系列 / 播放列表链接"
                placeholder="https://…"
                value={url}
                disabled={!!busy}
                onChange={(event) => setUrl(event.currentTarget.value)}
              />
              <Text size="xs" c="dimmed">
                使用设置中的全局 Cookie 授权。每次最多检查前 1000 项，最多订阅 100
                个系列；首次列表不会全部误记为已下载。
              </Text>
              <Group justify="flex-end">
                <Button type="submit" disabled={!!busy || !url.trim()} loading={busy === "add"}>
                  添加订阅并检查
                </Button>
              </Group>
            </Stack>
          </form>
        </Paper>
        <Checkbox
          label="显示已下载条目"
          checked={showDownloaded}
          onChange={(event) => setShowDownloaded(event.currentTarget.checked)}
        />
        {!subscriptions.length && (
          <Paper withBorder p="xl">
            <Text c="dimmed">
              {busy === "load"
                ? "正在读取本地订阅…"
                : "暂无订阅。添加已下载或持续更新的系列后，可在这里检查新增视频。"}
            </Text>
          </Paper>
        )}
        {subscriptions.map((item) => {
          const pending = item.entries.filter(isPending);
          const newItems = pending.filter((entry) => entry.isNew);
          const chosen = pending
            .filter((entry) => (selected[item.id] ?? []).includes(entry.id))
            .map((entry) => entry.id);
          const visible = item.entries.filter((entry) => showDownloaded || !entry.downloaded);
          return (
            <Paper
              key={item.id}
              withBorder
              p="md"
              radius="md"
              component="section"
              aria-label={item.title}
            >
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Title order={3}>{item.title}</Title>
                    <Text size="xs" c="dimmed" className="validated-url">
                      {item.url}
                    </Text>
                  </div>
                  <Group gap="xs">
                    <Badge color={newItems.length ? "orange" : "gray"}>
                      新增 {newItems.length}
                    </Badge>
                    <Badge variant="light">待下载 {pending.length}</Badge>
                    <Badge color="green" variant="light">
                      已下载 {item.entries.filter((entry) => entry.downloaded).length}
                    </Badge>
                  </Group>
                </Group>
                <Text size="xs" c="dimmed">
                  上次成功检查：{new Date(item.lastCheckedUnixMs).toLocaleString()} ·{" "}
                  {checkErrors[item.id] ? "本次检查失败，保留上次结果" : "仅表示上次检查时的状态"}
                </Text>
                {checkErrors[item.id] && (
                  <Alert color="red" role="alert">
                    {checkErrors[item.id]}
                  </Alert>
                )}
                {item.truncated && (
                  <Alert color="yellow">
                    列表未完整读取（最多前 1000 项）。结果仅覆盖已检查范围，不代表整个系列没有更新。
                  </Alert>
                )}
                <Group justify="space-between">
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="light"
                      disabled={!!busy}
                      loading={busy === `check-${item.id}`}
                      onClick={() => void act(`check-${item.id}`, () => check(item.id))}
                    >
                      检查更新
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!!busy || !newItems.length}
                      onClick={() =>
                        setSelected((previous) => ({
                          ...previous,
                          [item.id]: newItems.slice(0, 50).map((entry) => entry.id),
                        }))
                      }
                    >
                      选择新增
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!!busy || !pending.length}
                      onClick={() =>
                        setSelected((previous) => ({
                          ...previous,
                          [item.id]: pending.slice(0, 50).map((entry) => entry.id),
                        }))
                      }
                    >
                      选择待下载（最多 50 项）
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!!busy || !chosen.length}
                      onClick={() => setSelected((previous) => ({ ...previous, [item.id]: [] }))}
                    >
                      取消全选
                    </Button>
                  </Group>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    disabled={!!busy}
                    onClick={() => setRemoving(item)}
                  >
                    取消订阅
                  </Button>
                </Group>
                <Button
                  variant="subtle"
                  size="xs"
                  aria-expanded={!!expanded[item.id]}
                  onClick={() =>
                    setExpanded((previous) => ({ ...previous, [item.id]: !previous[item.id] }))
                  }
                >
                  {expanded[item.id] ? "收起条目" : `展开条目（${visible.length}）`}
                </Button>
                {expanded[item.id] && (
                  <SubscriptionEntries
                    id={item.id}
                    title={item.title}
                    active={active}
                    checkedAt={item.lastCheckedUnixMs}
                    entries={visible}
                    chosen={chosen}
                    disabled={!!busy}
                    onSelect={(id, checked) =>
                      setSelected((previous) => ({
                        ...previous,
                        [item.id]: checked
                          ? [...chosen, id]
                          : chosen.filter((value) => value !== id),
                      }))
                    }
                    onMetadata={(rows) =>
                      setSubscriptions((previous) =>
                        previous.map((series) =>
                          series.id === item.id
                            ? { ...series, entries: patchEntryMetadata(series.entries, rows) }
                            : series,
                        ),
                      )
                    }
                  />
                )}
                <Text size="xs" c="dimmed">
                  下载采用当前默认目录及重名策略，逐项自动匹配视频与音频并合并。保留“系列名称
                  [ID]/序号-标题 [视频 ID].扩展名”结构；实际格式及大小下载时确定。
                </Text>
                <Group justify="flex-end">
                  <Button
                    variant="subtle"
                    disabled={!!busy}
                    onClick={() => navigate(`/download?url=${encodeURIComponent(item.url)}`)}
                  >
                    选择画质与分 P
                  </Button>
                  <Checkbox
                    label="使用代理"
                    description="仅本次下载，使用设置中保存的自定义代理；不勾选则直连。"
                    checked={proxyChoices[item.id] ?? false}
                    disabled={!!busy}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setProxyChoices((previous) => ({ ...previous, [item.id]: checked }));
                    }}
                  />
                  <Button
                    variant="default"
                    disabled={!!busy || loadingDefaults || !!defaultsError}
                    onClick={() => setEditingOptions(item.id)}
                  >
                    高级设置
                  </Button>
                  <Button
                    disabled={!!busy || !chosen.length || loadingDefaults || !!defaultsError}
                    loading={busy === `download-${item.id}`}
                    onClick={() =>
                      void act(`download-${item.id}`, async () => {
                        const result = await subscriptionApi.download(
                          item.id,
                          chosen,
                          proxyChoices[item.id] ?? false,
                          optionOverrides[item.id] ?? defaultOptions,
                        );
                        result.tasks.forEach((task) =>
                          useAppStore.getState().upsertDownloadTask(task),
                        );
                        if (result.tasks.length) {
                          setNotice(
                            `已加入 ${result.tasks.length} 个下载任务，成功完成后才计为已下载。`,
                          );
                          setSelected((previous) => ({ ...previous, [item.id]: [] }));
                        }
                        if (result.error) setError(result.error);
                      })
                    }
                  >
                    下载所选 {chosen.length} 项
                  </Button>
                </Group>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
      {editingOptions !== null && (
        <DownloadOptionsModal
          opened={active}
          value={optionOverrides[editingOptions] ?? defaultOptions}
          onClose={() => setEditingOptions(null)}
          onApply={(value) =>
            setOptionOverrides((previous) => ({ ...previous, [editingOptions]: value }))
          }
        />
      )}
      <Modal
        opened={active && !!removing}
        returnFocus={active}
        onClose={() => {
          if (!busy) setRemoving(null);
        }}
        title="取消订阅"
        centered
      >
        <Stack>
          <Text>
            取消“{removing?.title}”的订阅？只移除订阅，不删除下载文件、历史记录或正在执行的任务。
          </Text>
          <Group justify="flex-end">
            <Button variant="default" disabled={!!busy} onClick={() => setRemoving(null)}>
              返回
            </Button>
            <Button
              color="red"
              disabled={!!busy}
              onClick={() => {
                if (removing)
                  void act("remove", async () => {
                    await subscriptionApi.remove(removing.id);
                    setRemoving(null);
                  });
              }}
            >
              确认取消订阅
            </Button>
          </Group>
        </Stack>
      </Modal>
    </main>
  );
}
