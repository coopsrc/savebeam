import { invokeCommand } from "../../ipc/client";
import type { MediaInfo } from "../../types/domain";

export function inspectMedia(url: string, useProxy = false): Promise<MediaInfo> {
  return invokeCommand<MediaInfo>("inspect_media", { url, useProxy });
}
