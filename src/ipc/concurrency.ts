import { invokeCommand } from "./client";
export interface ConcurrencyPreferences {
  metadataTotal: number;
  metadataPerList: number;
  downloadTasks: number;
  videosPerTask: number;
}
export async function metadataConcurrency() {
  const value = await invokeCommand<ConcurrencyPreferences | null>("get_concurrency_preferences");
  return value?.metadataPerList ?? 2;
}
