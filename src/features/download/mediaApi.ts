import { invokeCommand } from "../../ipc/client";
import type { MediaInfo } from "../../types/domain";

export function inspectMedia(url: string): Promise<MediaInfo> {
  return invokeCommand<MediaInfo>("inspect_media", { url });
}
