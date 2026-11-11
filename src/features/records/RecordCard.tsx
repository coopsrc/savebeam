import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Alert, Group, Image, Paper, Stack, Text } from "@mantine/core";
import { IconPhoto, IconRefresh } from "@tabler/icons-react";
import { invokeCommand } from "../../ipc/client";
import { t, useUiLocale } from "../../i18n/translate";

function RecordCover({ taskId, active }: { taskId: string; active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    if (!active || !root.current || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(true);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [active, visible]);
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const epoch = ++revision.current;
    void invokeCommand<string | null>("get_record_thumbnail", { taskId, refresh: false })
      .then((value) => {
        if (!disposed && epoch === revision.current) setImage(value);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [taskId, visible]);
  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const epoch = ++revision.current;
    try {
      const value = await invokeCommand<string | null>("get_record_thumbnail", {
        taskId,
        refresh: true,
      });
      if (epoch !== revision.current) return;
      if (value) setImage(value);
      else setError(t("来源未提供可用封面。"));
    } catch (reason) {
      if (epoch === revision.current)
        setError(reason instanceof Error ? reason.message : t("封面读取失败。"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={root} className="record-cover">
      {image ? (
        <Image src={image} alt="" h="100%" fit="cover" onError={() => setImage(null)} />
      ) : (
        <IconPhoto aria-hidden size={28} />
      )}
      <ActionIcon
        className="record-cover-refresh"
        aria-label={image ? t("刷新封面") : t("读取封面")}
        title={error ?? (image ? t("刷新封面") : t("读取封面"))}
        loading={busy}
        variant="light"
        onClick={() => void refresh()}
      >
        <IconRefresh size={14} />
      </ActionIcon>
      {error && (
        <Alert className="record-cover-error" role="alert" color="orange" p={4}>
          {error}
        </Alert>
      )}
    </div>
  );
}

/** Shared task/history geometry; only status, progress and actions differ. */
export function RecordCard({
  title,
  taskId,
  active,
  badge,
  metadata,
  actions,
  children,
  label,
  className,
}: {
  title: string;
  taskId: string;
  active: boolean;
  badge?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  label?: string;
  className?: string;
}) {
  useUiLocale();
  return (
    <Paper
      component="section"
      aria-label={label}
      withBorder
      radius="md"
      p="md"
      className={`record-card ${className ?? ""}`}
    >
      <Stack gap="sm">
        <Group align="start" wrap="nowrap">
          <RecordCover taskId={taskId} active={active} />
          <Stack gap={6} style={{ minWidth: 0, flex: 1 }}>
            <Group justify="space-between" align="start" wrap="nowrap">
              <Text fw={650} style={{ minWidth: 0, overflowWrap: "anywhere", flex: 1 }}>
                {title}
              </Text>
              {badge}
            </Group>
            {metadata}
          </Stack>
        </Group>
        {children}
        {actions && (
          <Group justify="flex-end" gap="xs">
            {actions}
          </Group>
        )}
      </Stack>
    </Paper>
  );
}
