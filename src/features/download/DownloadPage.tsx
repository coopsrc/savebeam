import { useState, type FormEvent } from "react";
import { Alert, Button, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconCheck, IconLink, IconSearch } from "@tabler/icons-react";
import { getMediaUrlError, validateMediaUrl } from "./validateMediaUrl";

export function DownloadPage() {
  const [url, setUrl] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const validation = hasSubmitted ? validateMediaUrl(url) : null;
  const error = validation && !validation.valid ? getMediaUrlError(validation.reason) : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
  }

  function handleChange(value: string) {
    setUrl(value);
  }

  return (
    <main className="download-page">
      <Paper className="download-card" shadow="sm" radius="lg" withBorder>
        <Stack gap="xl">
          <Stack gap={6}>
            <div className="download-heading-icon" aria-hidden="true">
              <IconLink size={21} stroke={1.8} />
            </div>
            <Title order={2}>添加视频链接</Title>
            <Text c="dimmed" size="sm">
              输入公开的视频页面网址。此步骤只检查链接格式，不会联网解析或读取剪贴板。
            </Text>
          </Stack>

          <form onSubmit={handleSubmit} noValidate>
            <Stack gap="md">
              <TextInput
                autoComplete="url"
                autoCapitalize="off"
                spellCheck={false}
                label="视频链接"
                placeholder="https://example.com/video"
                value={url}
                onChange={(event) => handleChange(event.currentTarget.value)}
                error={error}
                inputMode="url"
                aria-describedby="url-input-hint"
              />
              <Text id="url-input-hint" size="xs" c="dimmed">
                支持 http:// 和 https://；具体网站及媒体支持情况将在解析阶段确认。
              </Text>
              <div className="download-actions">
                <Button type="submit" leftSection={<IconSearch size={16} stroke={1.8} />}>
                  检查链接
                </Button>
              </div>

              {validation?.valid && (
                <Alert
                  color="green"
                  icon={<IconCheck size={18} stroke={2} />}
                  title="链接格式有效"
                  aria-live="polite"
                >
                  <Text size="sm" className="validated-url">
                    {validation.normalizedUrl}
                  </Text>
                  <Text size="sm" mt={4}>
                    媒体解析与下载引擎尚未接入；本次没有发起网络请求。
                  </Text>
                </Alert>
              )}
            </Stack>
          </form>
        </Stack>
      </Paper>
    </main>
  );
}
