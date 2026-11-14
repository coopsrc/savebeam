import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, Paper, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { t, useUiLocale } from "../../i18n/translate";
import { invokeCommand } from "../../ipc/client";
import { optionError } from "../download/useDownloadOptions";
import { AppUpdatePanel } from "./AppUpdatePanel";
import privacyZh from "../../../docs/policies/privacy.zh-CN.txt?raw";
import privacyEn from "../../../docs/policies/privacy.en-US.txt?raw";
import termsZh from "../../../docs/policies/terms.zh-CN.txt?raw";
import termsEn from "../../../docs/policies/terms.en-US.txt?raw";
interface Information {
  version: string;
  platform: string;
  architecture: string;
}
export function AboutPanel({ active }: { active: boolean }) {
  const locale = useUiLocale();
  const [info, setInfo] = useState<Information | null>(null),
    [error, setError] = useState<string | null>(null),
    [document, setDocument] = useState<{ title: string; text: string } | null>(null),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    void invokeCommand<Information>("get_app_information")
      .then(setInfo)
      .catch((e) => setError(optionError(e)));
  }, []);
  async function license(notices: boolean) {
    try {
      const raw = notices
        ? await import("../../../docs/releases/THIRD_PARTY_NOTICES.txt?raw")
        : await import("../../../LICENSE?raw");
      setDocument({ title: notices ? t("第三方声明") : t("开源许可证"), text: raw.default });
    } catch (e) {
      setError(optionError(e));
    }
  }
  async function external(kind: string) {
    try {
      await invokeCommand("open_app_link", { kind });
    } catch (e) {
      setError(optionError(e));
    }
  }
  return (
    <Stack gap="lg">
      <Paper withBorder p="lg" radius="md">
        <Stack gap="sm">
          <Title order={2}>Savebeam</Title>
          <Text size="sm">
            {info
              ? t("版本 {0} · {1} · {2}", [info.version, info.platform, info.architecture])
              : t("本地优先的视频下载工具")}
          </Text>
          <Text size="sm" c="dimmed">
            Apache License 2.0 · CoopSrc
          </Text>
          <Group>
            <Button variant="light" onClick={() => void external("source")}>
              {t("查看源代码")}
            </Button>
          </Group>
        </Stack>
      </Paper>
      <AppUpdatePanel active={active} />
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Text fw={650}>{t("政策与许可证")}</Text>
          <Group>
            <Button
              variant="light"
              onClick={() =>
                setDocument({
                  title: t("隐私政策"),
                  text: locale === "en-US" ? privacyEn : privacyZh,
                })
              }
            >
              {t("隐私政策")}
            </Button>
            <Button
              variant="light"
              onClick={() =>
                setDocument({ title: t("使用条款"), text: locale === "en-US" ? termsEn : termsZh })
              }
            >
              {t("使用条款")}
            </Button>
            <Button variant="light" onClick={() => void license(false)}>
              {t("开源许可证")}
            </Button>
            <Button variant="light" onClick={() => void license(true)}>
              {t("第三方声明")}
            </Button>
          </Group>
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Text fw={650}>{t("问题反馈")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "不会自动上传崩溃日志或诊断信息。反馈会打开 GitHub；可在通用设置中主动导出本地诊断，分享前请检查敏感内容。",
            )}
          </Text>
          <Group>
            <Button variant="light" onClick={() => void external("feedback")}>
              {t("报告问题")}
            </Button>
            <Button
              variant="default"
              disabled={!info}
              onClick={() => {
                if (info)
                  void navigator.clipboard
                    .writeText(`Savebeam ${info.version}\n${info.platform} ${info.architecture}`)
                    .then(() => setCopied(true))
                    .catch((e) => setError(optionError(e)));
              }}
            >
              {copied ? t("已复制") : t("复制基本信息")}
            </Button>
          </Group>
        </Stack>
      </Paper>
      {error && (
        <Alert role="alert" color="red">
          {error}
        </Alert>
      )}
      <Modal
        opened={!!document && active}
        returnFocus={active}
        onClose={() => setDocument(null)}
        title={document?.title}
        size="xl"
        centered
      >
        <ScrollArea.Autosize mah="65vh">
          <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {document?.text}
          </Text>
        </ScrollArea.Autosize>
      </Modal>
    </Stack>
  );
}
