/** Operational error with a stable machine-readable code. */
export class ArtError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'ArtError';
    this.code = code;
    this.hint = hint;
  }
}

/** CLI usage error — exit code 2 instead of 1. */
export class UsageError extends ArtError {
  constructor(message: string) {
    super('usage', message);
    this.name = 'UsageError';
  }
}

export interface ErrorEnvelope {
  ok: false;
  error: { code: string; message: string; hint?: string };
}

export function errorEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof ArtError) {
    const error: ErrorEnvelope['error'] = { code: err.code, message: err.message };
    if (err.hint) error.hint = err.hint;
    return { ok: false, error };
  }
  return {
    ok: false,
    error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
  };
}

export function errorText(err: unknown): string {
  if (err instanceof ArtError) {
    const hint = err.hint ? `\nhint: ${err.hint}` : '';
    return `error [${err.code}]: ${err.message}${hint}`;
  }
  return `error [internal]: ${err instanceof Error ? err.message : String(err)}`;
}
