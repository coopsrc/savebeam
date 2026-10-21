import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppError, AppErrorCode } from "../types/domain";

const ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_url",
  "unsupported_url",
  "component_missing",
  "component_too_old",
  "invalid_path",
  "video_unavailable",
  "login_required",
  "private_content",
  "rate_limited",
  "network_failure",
  "disk_full",
  "permission_denied",
  "merge_failed",
  "cancelled",
  "unknown",
]);

export class IpcError extends Error implements AppError {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly diagnostic?: string;

  constructor(error: AppError) {
    super(error.message);
    this.name = "IpcError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.diagnostic = error.diagnostic;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeError(value: unknown): IpcError {
  if (isRecord(value)) {
    const { code, message, retryable, diagnostic } = value;
    if (typeof code === "string" && ERROR_CODES.has(code) && typeof message === "string") {
      return new IpcError({
        code: code as AppErrorCode,
        message,
        retryable: retryable === true,
        ...(typeof diagnostic === "string" ? { diagnostic } : {}),
      });
    }
  }

  return new IpcError({
    code: "unknown",
    message: "应用通信失败，请重试。",
    retryable: true,
  });
}

/** Invoke a named Tauri command; feature code should wrap this with typed APIs. */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    throw new IpcError({
      code: "unknown",
      message: "当前预览环境不支持桌面端操作。",
      retryable: false,
    });
  }

  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw normalizeError(error);
  }
}
