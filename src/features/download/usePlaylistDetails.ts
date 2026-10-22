import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MediaInfo,
  PlaylistDetails,
  PlaylistMatch,
  PlaylistQuality,
} from "../../types/domain";
import { invokeCommand } from "../../ipc/client";
import { optionError } from "./useDownloadOptions";

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
      // If the previous link is still finishing its bounded request, do not race its lock.
      await pending.current?.catch(() => {});
      for (let offset = 0; offset < entries.length; offset += 5) {
        if (cancelled || stop.current) break;
        const chunk = entries.slice(offset, offset + 5);
        let error: string | null = null;
        try {
          const request = invokeCommand<PlaylistDetails[]>("inspect_playlist_entries", {
            url: media.webpageUrl,
            useProxy,
            items: chunk.map(({ index, id }) => ({ index, id })),
          });
          pending.current = request;
          const response = await request;
          if (cancelled) return;
          for (const entry of chunk) {
            const rows = response.filter((row) => row.index === entry.index);
            const row = rows.length === 1 ? rows[0] : null;
            details[entry.index] =
              row && (!entry.id || row.id === entry.id)
                ? row
                : {
                    index: entry.index,
                    id: entry.id,
                    title: null,
                    durationSeconds: null,
                    formats: [],
                    error: "条目 ID 已变化或未返回，请重新读取。",
                  };
          }
        } catch (reason) {
          if (cancelled) return;
          error = optionError(reason);
          for (const entry of chunk)
            details[entry.index] = {
              index: entry.index,
              id: entry.id,
              title: null,
              durationSeconds: null,
              formats: [],
              error,
            };
        }
        setState({
          source: media,
          details: { ...details },
          loading: !error && !stop.current && offset + 5 < entries.length,
          done: Math.min(offset + 5, entries.length),
          error,
        });
        if (error) break;
      }
      if (!cancelled) setState((value) => ({ ...value, loading: false }));
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, [media, useProxy, revision]);
  const details = useMemo(
    () => (state.source === media ? state.details : {}),
    [state.source, state.details, media],
  );
  const input = useMemo(() => {
    const items = Object.values(details).filter((entry) => entry.id);
    return {
      items,
      policy,
      overrides: Object.entries(overrides)
        .filter(([index]) => items.some((item) => item.index === Number(index)))
        .map(([index, policy]) => ({ index: Number(index), policy })),
      audioOnly,
    };
  }, [details, policy, overrides, audioOnly]);
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
    details,
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
