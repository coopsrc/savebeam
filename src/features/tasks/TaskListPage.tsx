import { useState } from "react";
import { Alert, Progress, Stack, Text } from "@mantine/core";
import { useNavigate } from "react-router-dom";
import { t, useUiLocale, getUiLocale } from "../../i18n/translate";
import { getLocalizedErrorMessage } from "../../i18n/errorMessages";
import { useAppStore } from "../../stores/appStore";
import { useRetainedPageScroll } from "../../layout/useRetainedPageScroll";
import { EmptyState } from "../../components/states/AppStates";
import { taskRecordGroups, taskGroupSummary } from "../records/groupRecords";
import { RecordGroup } from "../records/RecordGroup";
import { TaskCard } from "./TaskCard";

export function TaskListPage({ active }: { active: boolean }) {
  useUiLocale();
  const root = useRetainedPageScroll(active);
  const tasks = useAppStore((s) => s.downloadTasks);
  const error = useAppStore((s) => s.lastDownloadError);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();
  const groups = taskRecordGroups(tasks);
  return (
    <main
      className="task-list-page"
      ref={root}
      hidden={!active}
      style={active ? undefined : { display: "none" }}
    >
      <Stack gap="md">
        {error && (
          <Alert
            color="red"
            title={t("下载任务失败")}
            role="alert"
            onClose={() => useAppStore.getState().setLastDownloadError(null)}
            withCloseButton
          >
            {getUiLocale() === "zh-CN"
              ? error.message
              : getLocalizedErrorMessage(error, getUiLocale())}
          </Alert>
        )}
        {!groups.length ? (
          <EmptyState
            title={t("暂无未完成任务")}
            description={t("下载完成的内容可在历史中查看；失败或取消的任务可在这里重试。")}
            actionLabel={t("添加视频链接")}
            onAction={() => navigate("/download")}
          />
        ) : (
          groups.map((group) => {
            if (!group.context)
              return <TaskCard key={group.key} task={group.items[0]} active={active} />;
            const summary = taskGroupSummary(group.items);
            return (
              <RecordGroup
                key={group.key}
                context={group.context}
                taskId={group.items[0].id}
                expanded={!!expanded[group.key]}
                onToggle={() => setExpanded((v) => ({ ...v, [group.key]: !v[group.key] }))}
                active={active}
                summary={
                  <Stack gap={6}>
                    <Text size="sm" c="dimmed">
                      {t("共 {0} 条 · 完成 {1} · 进行中 {2} · 失败 {3} · 已取消 {4}", [
                        group.items.length,
                        summary.counts.completed,
                        summary.active,
                        summary.counts.failed,
                        summary.counts.cancelled,
                      ])}
                    </Text>
                    <Progress.Root>
                      <Progress.Section
                        value={summary.percent}
                        withAria={false}
                        role="progressbar"
                        aria-label={t("分组完成进度：{0}", [group.context.title])}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(summary.percent)}
                        aria-valuetext={t("已完成 {0}/{1} 条", [
                          summary.counts.completed,
                          group.items.length,
                        ])}
                        color={
                          summary.status === "failed"
                            ? "red"
                            : summary.status === "completed"
                              ? "green"
                              : "blue"
                        }
                      />
                    </Progress.Root>
                  </Stack>
                }
              >
                {group.items
                  .filter((task) => task.status !== "completed")
                  .map((task) => (
                    <TaskCard key={task.id} task={task} active={active && !!expanded[group.key]} />
                  ))}
              </RecordGroup>
            );
          })
        )}
      </Stack>
    </main>
  );
}
