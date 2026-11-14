import { t } from "../../i18n/translate.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MediaInfo,
  PlaylistDetails,
  PlaylistMatch,
  PlaylistQuality,
} from "../../types/domain";
import { invokeCommand } from "../../ipc/client";
import { metadataConcurrency } from "../../ipc/concurrency";
import { rollingQueue } from "../../utils/rollingQueue";
import { optionError } from "./useDownloadOptions";
import { expandedEntries, expandedOverrides, taskDetails } from "./playlistParts";

export function usePlaylistDetails(
  media: MediaInfo | null,
  useProxy: boolean,
  policy: PlaylistQuality,
  overrides: Record<number, PlaylistQuality>,
  audioOnly: boolean,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    source: MediaInfo | null;
    details: Record<number, PlaylistDetails>;
    loading: boolean;
    done: number;
    error: string | null;
  }>({ source: null, details: {}, loading: false, done: 0, error: null });
  const stop = useRef(false);
  const [activity, setActivity] = useState({ running: 0, waiting: 0 });
  const pending = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    stop.current = false;
    async function read() {
      await Promise.resolve();
      if (!media?.playlist || cancelled) return;
      const entries = media.playlist.entries.filter((entry) => entry.available).slice(0, 50);
      const details: Record<number, PlaylistDetails> = {};
      setState({ source: media, details, loading: true, done: 0, error: null });
      await pending.current?.catch(() => {});
      if (cancelled) return;
      const sessionId = crypto.randomUUID();
      let done = 0;
      let lastError: string | null = null;
      const publish = () => {
        if (!cancelled)
          setState({
            source: media,
            details: { ...details },
            loading: true,
            done,
            error: lastError,
          });
      };
      type Work = { index: number; id: string | null; part?: PlaylistDetails };
      const run = rollingQueue<Work>(
        entries,
        await metadataConcurrency(),
        async (entry, enqueue) => {
          if (cancelled || stop.current) return;
          try {
            const response = await invokeCommand<PlaylistDetails[]>(
              entry.part ? "inspect_playlist_parts" : "inspect_playlist_entries",
              entry.part
                ? { sessionId, parts: [entry.part.part], useProxy }
                : {
                    sessionId,
                    url: media.webpageUrl,
                    useProxy,
                    items: [{ index: entry.index, id: entry.id }],
                  },
            );
            if (cancelled) return;
            const rows = response.filter(
              (row) => row.index === entry.index && (!entry.id || row.id === entry.id),
            );
            const row =
              rows.length === 1
                ? rows[0]
                : {
                    ...(entry.part ?? {}),
                    index: entry.index,
                    id: entry.id,
                    title: null,
                    durationSeconds: null,
                    formats: [],
                    error: t("条目 ID 已变化或未返回，请重新读取。"),
                  };
            details[entry.index] = row;
            if (!entry.part) {
              done++;
              for (const part of row.parts ?? []) details[part.index] = part;
              enqueue((row.parts ?? []).map((part) => ({ index: part.index, id: part.id, part })));
            }
          } catch (reason) {
            if (cancelled) return;
            lastError = optionError(reason);
            details[entry.index] = {
              ...(entry.part ?? {}),
              index: entry.index,
              id: entry.id,
              title: null,
              durationSeconds: null,
              formats: [],
              error: optionError(reason),
            };
            if (!entry.part) done++;
          }
          publish();
        },
        () => cancelled || stop.current,
        (running, waiting) => {
          if (!cancelled) setActivity({ running, waiting });
        },
      );
      pending.current = run;
      await run;
      if (!cancelled) setState((value) => ({ ...value, loading: false }));
    }
    void read().catch((reason) => {
      if (!cancelled)
        setState((value) => ({ ...value, loading: false, error: optionError(reason) }));
    });
    return () => {
      cancelled = true;
    };
  }, [media, useProxy, revision]);
  const details = useMemo(
    () => (state.source === media ? state.details : {}),
    [state.source, state.details, media],
  );
  const input = useMemo(() => {
    const items = expandedEntries(media, details)
      .map((entry) => details[entry.index])
      .filter((entry) => entry?.id && !entry.parts?.length)
      .map(taskDetails);
    return {
      items,
      policy,
      overrides: expandedOverrides(expandedEntries(media, details), overrides).filter((over) =>
        items.some((item) => item.index === over.index),
      ),
      audioOnly,
    };
  }, [details, media, policy, overrides, audioOnly]);
  const [matched, setMatched] = useState<{
    input: typeof input | null;
    rows: PlaylistMatch[];
    error: string | null;
  }>({ input: null, rows: [], error: null });
  useEffect(() => {
    let cancelled = false;
    if (!input.items.length) return;
    void invokeCommand<PlaylistMatch[]>("match_playlist_quality", input)
      .then((rows) => {
        if (!cancelled) setMatched({ input, rows, error: null });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setMatched({ input, rows: [], error: optionError(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [input]);
  return {
    activity,
    details,
    entries: expandedEntries(media, details),
    matches: matched.input === input ? matched.rows : [],
    matching: matched.input !== input && input.items.length > 0,
    matchError: matched.input === input ? matched.error : null,
    loading: state.source === media && state.loading,
    done: state.source === media ? state.done : 0,
    error: state.source === media ? state.error : null,
    stop: () => {
      stop.current = true;
    },
    reload: () => setRevision((value) => value + 1),
  };
}
