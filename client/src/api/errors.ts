export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | null;

  constructor(status: number, code: string, message: string, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export function formatApiError(err: unknown): string {
  if (isAbortError(err)) return "";
  if (err instanceof ApiError) {
    if (err.code === "locked_out" && err.retryAfter != null) {
      const seconds = Math.max(0, Math.ceil(err.retryAfter));
      return `${err.message} Try again in ${seconds} seconds.`;
    }
    return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}
