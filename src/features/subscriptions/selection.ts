import type { SubscriptionEntry } from "./subscriptionApi";

export function isPending(entry: SubscriptionEntry): boolean {
  return (
    !entry.downloaded &&
    entry.available &&
    !["queued", "preparing", "downloading", "post_processing", "cancelling"].includes(
      entry.taskStatus ?? "",
    )
  );
}
