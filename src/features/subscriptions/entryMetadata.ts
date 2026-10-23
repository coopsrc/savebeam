import type {
  SeriesSubscription,
  SubscriptionEntry,
  SubscriptionEntryMetadata,
} from "./subscriptionApi";

export function missingTitle(title: string): boolean {
  return ["", "未命名视频", "标题待补全"].includes(title.trim());
}

export function entryDuration(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const value = Math.round(seconds);
  const minutes = Math.floor(value / 60);
  return value >= 3600
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
    : `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

export function patchEntryMetadata(
  entries: SubscriptionEntry[],
  rows: SubscriptionEntryMetadata[],
): SubscriptionEntry[] {
  return entries.map((entry) => {
    const matches = rows.filter(
      (row) => row.id === entry.id && row.index === entry.index && !row.error,
    );
    const row = matches.length === 1 ? matches[0] : null;
    return row
      ? {
          ...entry,
          title: row.title?.trim() || entry.title,
          durationSeconds: row.durationSeconds ?? entry.durationSeconds,
        }
      : entry;
  });
}

/** A late local list read must not replace enriched metadata with a placeholder. */
export function mergeSubscriptionMetadata(
  previous: SeriesSubscription[],
  incoming: SeriesSubscription[],
): SeriesSubscription[] {
  return incoming.map((series) => {
    const prior = previous.find(
      (item) =>
        item.id === series.id && item.sourceId === series.sourceId && item.url === series.url,
    );
    return !prior
      ? series
      : {
          ...series,
          entries: series.entries.map((entry) => {
            const old = prior.entries.find((item) => item.id === entry.id);
            return !old
              ? entry
              : {
                  ...entry,
                  title:
                    missingTitle(entry.title) && !missingTitle(old.title) ? old.title : entry.title,
                  durationSeconds: entry.durationSeconds ?? old.durationSeconds,
                };
          }),
        };
  });
}
