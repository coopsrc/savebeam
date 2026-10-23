import { t, useUiLocale } from "../../i18n/translate.ts";
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
  useUiLocale();

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

export function LoadingState({ label = t("正在处理…") }: LoadingStateProps) {
  useUiLocale();

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
  title = t("操作未能完成"),
  description,
  actionLabel = t("重试"),
  onAction,
}: ErrorStateProps) {
  useUiLocale();

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
  description = t("安装或配置该组件后即可继续。"),
  onOpenSettings,
}: ComponentMissingStateProps) {
  useUiLocale();

  return (
    <Alert
      color="yellow"
      icon={<IconPackageOff size={18} stroke={1.8} />}
      title={t("缺少 {0}", [componentName])}
      role="status"
    >
      <Stack gap="sm">
        <Text size="sm">{description}</Text>
        {onOpenSettings && (
          <div>
            <Button size="xs" variant="light" color="yellow" onClick={onOpenSettings}>
              {t("打开组件设置")}
            </Button>
          </div>
        )}
      </Stack>
    </Alert>
  );
}
