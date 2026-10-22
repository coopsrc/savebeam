import { useEffect, useState } from "react";
import { invokeCommand, IpcError } from "../../ipc/client";
import type { DownloadOptionDefaults } from "../../types/domain";
import {
  INITIAL_DOWNLOAD_OPTIONS,
  copyDownloadOptions,
  readDownloadOptions,
} from "./downloadOptionDefaults";

export async function loadDownloadOptions(): Promise<DownloadOptionDefaults> {
  return readDownloadOptions(await invokeCommand("get_download_option_defaults"));
}

export function optionError(error: unknown) {
  return error instanceof IpcError
    ? error.contextMessage
    : error instanceof Error
      ? error.message
      : "下载选项操作失败，请重试。";
}

/** Load once per new page; user edits are not overwritten by background preference updates. */
export function useDownloadOptions() {
  const [options, setOptions] = useState(() => copyDownloadOptions(INITIAL_DOWNLOAD_OPTIONS));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void loadDownloadOptions()
      .then((value) => {
        if (active) setOptions(value);
      })
      .catch((reason: unknown) => {
        if (active) setError(optionError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  function retry() {
    setLoading(true);
    setError(null);
    setRevision((value) => value + 1);
  }
  // Explicit user recovery only; never called as a fallback after a failed read.
  function restoreInitial() {
    setOptions(copyDownloadOptions(INITIAL_DOWNLOAD_OPTIONS));
    setError(null);
  }
  return { options, setOptions, loading, error, retry, restoreInitial };
}
