import type { DownloadGroup, DownloadTask, DownloadTaskStatus } from "../../types/domain";

export interface RecordGroup<T> {
  key: string;
  context: DownloadGroup | null;
  items: T[];
  timestamp: number;
}

/** Group only persisted identities. Never merge by a title, filename or guessed URL. */
export function groupRecords<T extends { group?: DownloadGroup | null }>(
  records: T[],
  id: (record: T) => string,
  timestamp: (record: T) => number,
): RecordGroup<T>[] {
  const groups = new Map<string, RecordGroup<T>>();
  const titleTimestamps = new Map<string, number>();
  for (const record of records) {
    const context = record.group?.key ? record.group : null;
    const key = context ? `group:${context.key}` : `single:${id(record)}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, context, items: [], timestamp: timestamp(record) };
      groups.set(key, group);
      titleTimestamps.set(key, timestamp(record));
    }
    // Prefer a known parent title over a legacy URL-only placeholder, then the newest title.
    if (
      context &&
      (!group.context ||
        (/^https?:\/\//.test(group.context.title) && !/^https?:\/\//.test(context.title)) ||
        (!/^https?:\/\//.test(context.title) && timestamp(record) >= titleTimestamps.get(key)!))
    ) {
      group.context = context;
      titleTimestamps.set(key, timestamp(record));
    }
    group.timestamp = Math.max(group.timestamp, timestamp(record));
    group.items.push(record);
  }
  for (const group of groups.values())
    if (group.context)
      group.items.sort(
        (a, b) =>
          (a.group?.itemIndex ?? Number.MAX_SAFE_INTEGER) -
            (b.group?.itemIndex ?? Number.MAX_SAFE_INTEGER) ||
          (a.group?.partIndex ?? 0) - (b.group?.partIndex ?? 0) ||
          timestamp(b) - timestamp(a) ||
          id(a).localeCompare(id(b)),
      );
  return [...groups.values()].sort(
    (a, b) => b.timestamp - a.timestamp || a.key.localeCompare(b.key),
  );
}

export function taskGroupSummary(tasks: DownloadTask[]) {
  const counts = Object.fromEntries(
    [
      "queued",
      "preparing",
      "downloading",
      "post_processing",
      "completed",
      "failed",
      "cancelling",
      "cancelled",
    ].map((s) => [s, 0]),
  ) as Record<DownloadTaskStatus, number>;
  for (const task of tasks) counts[task.status]++;
  const active =
    counts.queued +
    counts.preparing +
    counts.downloading +
    counts.post_processing +
    counts.cancelling;
  const status = active
    ? "active"
    : counts.failed
      ? "failed"
      : counts.completed === tasks.length
        ? "completed"
        : "ended";
  return {
    counts,
    active,
    status,
    percent: tasks.length ? (counts.completed / tasks.length) * 100 : 0,
  };
}

/** Keep completed siblings only for aggregate progress while work remains in the group. */
export function taskRecordGroups(tasks: DownloadTask[]) {
  return groupRecords(
    tasks,
    (t) => t.id,
    (t) => t.createdAtUnixMs,
  ).filter((group) => group.items.some((task) => task.status !== "completed"));
}
