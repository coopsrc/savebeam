import type { ReactNode } from "react";
import { Alert, Button, Loader, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconAlertTriangle, IconPackageOff } from "@tabler/icons-react";

type ActionProps = {
  actionLabel?: string;
  onAction?: () => void;
};

type EmptyStateProps = ActionProps & {
  title: string;
  description: string;
  icon?: ReactNode;
};

export function EmptyState({ title, description, icon, actionLabel, onAction }: EmptyStateProps) {
  return (
    <section className="state-view" aria-labelledby="empty-state-title">
      <Stack align="center" gap="sm" ta="center">
        <ThemeIcon size={52} radius="xl" variant="light" color="gray" aria-hidden="true">
          {icon ?? <IconPackageOff size={26} stroke={1.7} />}
        </ThemeIcon>
        <Title id="empty-state-title" order={3}>
          {title}
        </Title>
        <Text maw={420} c="dimmed" size="sm">
          {description}
        </Text>
        {actionLabel && onAction && (
          <Button mt="xs" variant="light" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </Stack>
    </section>
  );
}

type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = "正在处理…" }: LoadingStateProps) {
  return (
    <div className="state-inline" role="status" aria-live="polite">
      <Loader size="sm" aria-hidden="true" />
      <Text size="sm">{label}</Text>
    </div>
  );
}

type ErrorStateProps = ActionProps & {
  title?: string;
  description: string;
};

export function ErrorState({
  title = "操作未能完成",
  description,
  actionLabel = "重试",
  onAction,
}: ErrorStateProps) {
  return (
    <Alert
      color="red"
      icon={<IconAlertTriangle size={18} stroke={1.8} />}
      title={title}
      role="alert"
    >
      <Stack gap="sm">
        <Text size="sm">{description}</Text>
        {onAction && (
          <div>
            <Button size="xs" variant="light" color="red" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        )}
      </Stack>
    </Alert>
  );
}

type ComponentMissingStateProps = {
  componentName: string;
  description?: string;
  onOpenSettings?: () => void;
};

export function ComponentMissingState({
  componentName,
  description = "安装或配置该组件后即可继续。",
  onOpenSettings,
}: ComponentMissingStateProps) {
  return (
    <Alert
      color="yellow"
      icon={<IconPackageOff size={18} stroke={1.8} />}
      title={`缺少 ${componentName}`}
      role="status"
    >
      <Stack gap="sm">
        <Text size="sm">{description}</Text>
        {onOpenSettings && (
          <div>
            <Button size="xs" variant="light" color="yellow" onClick={onOpenSettings}>
              打开组件设置
            </Button>
          </div>
        )}
      </Stack>
    </Alert>
  );
}
