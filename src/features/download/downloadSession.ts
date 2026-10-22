export interface DownloadSession {
  identity: object;
  key: string;
  initialUrl: string;
  prefillEntryKey: string | null;
  retained: boolean;
  consumed: boolean;
}

/** In-memory session identity, not persisted media data or a browser storage record. */
export function resolveDownloadSession(
  previous: DownloadSession | null,
  route: { pathname: string; search: string; key: string },
): DownloadSession | null {
  if (route.pathname !== "/download")
    return previous && previous.retained && !previous.consumed ? previous : null;
  const prefill = new URLSearchParams(route.search).get("url");
  if (previous && (prefill === null || previous.prefillEntryKey === route.key)) return previous;
  return {
    identity: {},
    key: route.key,
    initialUrl: prefill ?? "",
    prefillEntryKey: prefill === null ? null : route.key,
    retained: prefill !== null,
    consumed: false,
  };
}
