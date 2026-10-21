import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Group, Paper, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconCheck, IconLink, IconSearch } from "@tabler/icons-react";
import { useAppStore } from "../../stores/appStore";
import { getMediaUrlError, validateMediaUrl } from "./validateMediaUrl";

const mockFormats = [
  { value: "best", label: "最佳画质（模拟）" },
  { value: "1080p", label: "1080p（模拟）" },
  { value: "audio", label: "仅音频（模拟）" },
];

export function DownloadPage() {
  const [url, setUrl] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showMockMedia, setShowMockMedia] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("best");
  const addMockTask = useAppStore((state) => state.addMockTask);
  const navigate = useNavigate();
  const validation = hasSubmitted ? validateMediaUrl(url) : null;
  const error = validation && !validation.valid ? getMediaUrlError(validation.reason) : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
  }

  function handleChange(value: string) {
    setUrl(value);
    setShowMockMedia(false);
  }

  function createMockTask() {
    if (!validation?.valid) return;
    const formatLabel = mockFormats.find((format) => format.value === selectedFormat)?.label;
    addMockTask({
      id: `mock-${Date.now()}`,
      title: "示例视频（模拟任务）",
      url: validation.normalizedUrl,
      formatLabel: formatLabel ?? "最佳画质（模拟）",
      status: "queued",
      createdAt: Date.now(),
    });
    navigate("/tasks");
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
                    当前仅完成格式检查，没有联网解析。可以使用模拟数据预览后续交互。
                  </Text>
                  <Group mt="sm">
                    <Button size="xs" variant="light" onClick={() => setShowMockMedia(true)}>
                      使用模拟媒体信息
                    </Button>
                  </Group>
                </Alert>
              )}

              {showMockMedia && validation?.valid && (
                <Paper className="mock-media-card" withBorder radius="md" p="md">
                  <Stack gap="md">
                    <div>
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        模拟媒体信息
                      </Text>
                      <Title order={3} mt={4}>
                        示例视频
                      </Title>
                      <Text size="sm" c="dimmed">
                        此处为原型数据，不代表该网址的真实媒体信息。
                      </Text>
                    </div>
                    <Select
                      label="下载格式"
                      data={mockFormats}
                      value={selectedFormat}
                      onChange={(value) => value && setSelectedFormat(value)}
                      allowDeselect={false}
                    />
                    <Group justify="flex-end">
                      <Button onClick={createMockTask}>创建模拟任务</Button>
                    </Group>
                  </Stack>
                </Paper>
              )}
            </Stack>
          </form>
        </Stack>
      </Paper>
    </main>
  );
}
