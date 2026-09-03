import type { CdpClient } from '../cdp/client.js';
import { ArtError } from '../errors.js';
import { evaluateExpression } from '../evaluate.js';
// Bundled as text by esbuild (loader: {'.js': 'text'}); the extensionless
// specifier lets tsc resolve ./probe.d.ts for typechecking.
import probeSource from './probe';

interface ProbeEnvelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; stack?: string };
}

/**
 * The probe source evaluates to a function; call it with the JSON task:
 *   (function(){...})()({command:'tree', depth:8})
 */
export function buildExpression(task: object): string {
  return `(${probeSource})(${JSON.stringify(task)})`;
}

/** Run a probe task in the page and unwrap its envelope. */
export async function runProbe(
  client: CdpClient,
  sessionId: string | null,
  task: object,
): Promise<unknown> {
  const value = await evaluateExpression(client, buildExpression(task), sessionId);
  if (typeof value !== 'string') {
    throw new ArtError('probe-failed', `Probe returned ${typeof value} instead of a JSON string.`);
  }
  const envelope = JSON.parse(value) as ProbeEnvelope;
  if (!envelope.ok) {
    throw new ArtError(
      envelope.error?.code ?? 'internal',
      envelope.error?.message ?? 'Probe failed with no error message.',
    );
  }
  return envelope.data;
}
