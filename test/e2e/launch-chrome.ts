import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface LaunchedChrome {
  proc: ChildProcess;
  /** Assigned remote-debugging port. */
  port: number;
  /** Browser-level ws URL. */
  browserWs: string;
  userDataDir: string;
  cleanup: () => Promise<void>;
}

export async function until(fn: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Launch headless Chrome with --remote-debugging-port=0 and read the assigned
 * port + browser ws path from <user-data-dir>/DevToolsActivePort.
 */
export async function launchChrome(url: string): Promise<LaunchedChrome> {
  const chromePath =
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const userDataDir = mkdtempSync(join(tmpdir(), 'art-e2e-'));
  const proc = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      url,
    ],
    { stdio: 'ignore' },
  );
  await until(() => existsSync(join(userDataDir, 'DevToolsActivePort')), 15000);
  const [portStr, wsPath] = readFileSync(join(userDataDir, 'DevToolsActivePort'), 'utf8')
    .trim()
    .split(/\r?\n/);
  const port = Number(portStr);

  return {
    proc,
    port,
    browserWs: `ws://127.0.0.1:${port}${wsPath}`,
    userDataDir,
    cleanup: async () => {
      proc.kill('SIGTERM');
      await Promise.race([
        new Promise<void>((r) => proc.once('exit', () => r())),
        new Promise<void>((r) => setTimeout(r, 5000)),
      ]);
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
