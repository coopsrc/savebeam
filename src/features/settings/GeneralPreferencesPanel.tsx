import { Paper, Select, Stack, Text, Title } from "@mantine/core";
import { useUiPreferences } from "../../stores/uiPreferencesStore";
import { t, useUiLocale } from "../../i18n/translate";
import type { UiTheme, UiLanguage } from "../../app/uiPreferences";

export function GeneralPreferencesPanel() {
  useUiLocale();
  const { preferences, setPreferences, error } = useUiPreferences();
  const system = { value: "system", label: t("跟随系统") };
  return (
    <Paper component="section" aria-label={t("通用")} withBorder p="lg" radius="md">
      <Stack gap="md">
        <Title order={2}>{t("通用")}</Title>
        <Text c="dimmed" size="sm">
          {t("主题和语言即时生效并保存在本机，不影响下载任务。")}
        </Text>
        <Select
          label={t("主题")}
          data={[system, { value: "light", label: t("亮色") }, { value: "dark", label: t("暗色") }]}
          value={preferences.theme}
          allowDeselect={false}
          onChange={(theme) => theme && setPreferences({ ...preferences, theme: theme as UiTheme })}
        />
        <Select
          label={t("界面语言")}
          data={[
            system,
            { value: "zh-CN", label: "简体中文" },
            { value: "en-US", label: "English" },
          ]}
          value={preferences.language}
          allowDeselect={false}
          onChange={(language) =>
            language && setPreferences({ ...preferences, language: language as UiLanguage })
          }
        />
        <Text c="dimmed" size="xs">
          {t("仅改变界面语言；视频标题、文件名、站点内容和原始日志保持原文。")}
        </Text>
        {error && (
          <Text c="red" role="alert">
            {t(error)}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
