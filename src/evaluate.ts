import type { CdpClient } from './cdp/client.js';
import { ArtError } from './errors.js';

/**
 * Evaluate an expression in the page and return its value.
 * returnByValue serializes the result to a JSON value; the injected probe
 * always returns a plain JSON string, so nothing circular reaches CDP.
 */
export async function evaluateExpression(
  client: CdpClient,
  expression: string,
  sessionId: string | null,
): Promise<unknown> {
  const result = (await client.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    { sessionId },
  )) as {
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };

  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    const message = detail.exception?.description ?? detail.text ?? 'unknown evaluation error';
    throw new ArtError('eval-failed', `Evaluation error in page: ${message}`);
  }
  return result.result?.value;
}
