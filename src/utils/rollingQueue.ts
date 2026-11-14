/** Work completes independently. Dynamically discovered children use the same slots. */
export function rollingQueue<T>(
  initial: T[],
  limit: number,
  work: (item: T, enqueue: (items: T[]) => void) => Promise<void>,
  stopped: () => boolean = () => false,
  progress?: (running: number, waiting: number) => void,
): Promise<void> {
  const waiting = [...initial];
  let running = 0;
  let failure: unknown;
  return new Promise((resolve, reject) => {
    function pump() {
      if (stopped()) waiting.length = 0;
      while (running < Math.max(1, limit) && waiting.length) {
        const item = waiting.shift()!;
        running++;
        void Promise.resolve()
          .then(() =>
            work(item, (items) => {
              waiting.push(...items);
              pump();
            }),
          )
          .catch((error) => {
            failure ??= error;
          })
          .finally(() => {
            running--;
            pump();
          });
      }
      progress?.(running, waiting.length);
      if (!running && !waiting.length) {
        if (failure) reject(failure);
        else resolve();
      }
    }
    pump();
  });
}
