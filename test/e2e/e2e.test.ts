// End-to-end: built CLI against real headless Chrome + the Vite dev fixture.
// The fixture runs `vite dev` so assertions can rely on dev-build features
// (_debugSource file paths, hook names) — the realistic agent scenario.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CdpClient } from '../../src/cdp/client.js';
import { launchChrome, until, type LaunchedChrome } from './launch-chrome.js';

const execFileAsync = promisify(execFile);

const CLI = resolve(process.cwd(), 'dist/cli.js');
const FIXTURE_URL = 'http://127.0.0.1:4173/';

let viteProc: ChildProcess | undefined;
let chrome: LaunchedChrome | undefined;

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function cli(args: string[]): Promise<CliResult> {
  try {
    const r = await execFileAsync('node', [CLI, ...args], { timeout: 30_000 });
    return { stdout: r.stdout, stderr: r.stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: typeof err.code === 'number' ? err.code : 1 };
  }
}

async function cliJson(args: string[]): Promise<{ parsed: any; raw: CliResult }> {
  const raw = await cli([...args, '--json']);
  return { parsed: JSON.parse(raw.stdout), raw };
}

/** Depth-first walk of tree nodes. */
function walkTree(nodes: any[], cb: (node: any) => void): void {
  for (const n of nodes) {
    cb(n);
    if (n.children) walkTree(n.children, cb);
  }
}

function collect(nodes: any[]): any[] {
  const all: any[] = [];
  walkTree(nodes, (n) => all.push(n));
  return all;
}

beforeAll(async () => {
  // vite dev server for the fixture
  viteProc = spawn(
    resolve(process.cwd(), 'node_modules/.bin/vite'),
    ['dev', 'test/fixtures/react-app', '--port', '4173', '--strictPort'],
    { stdio: 'ignore' },
  );
  await until(async () => {
    try {
      const res = await fetch(FIXTURE_URL);
      return res.ok;
    } catch {
      return false;
    }
  }, 30_000);

  chrome = await launchChrome(FIXTURE_URL);

  // Wait until React is actually mounted (vite compiles on first load).
  await until(async () => {
    const { raw } = await cliJson(['tree', '--cdp', String(chrome!.port)]);
    return raw.code === 0;
  }, 30_000);
}, 180_000);

afterAll(async () => {
  await chrome?.cleanup();
  viteProc?.kill('SIGTERM');
});

describe('tree', () => {
  it('returns the full component tree as JSON', async () => {
    const { parsed, raw } = await cliJson([
      'tree',
      '--cdp',
      String(chrome!.port),
      '--fields',
      'props,hooks,memo,context,state,file,dom',
    ]);
    expect(raw.code).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('tree');
    expect(parsed.page.url).toContain('4173');
    expect(parsed.react.version).toBe('18+');
    expect(parsed.react.apps).toBe(2);

    const nodes = collect(parsed.data.roots);
    const byName = (name: string) => nodes.filter((n) => n.name === name);

    // #app wraps the tree in StrictMode (dev fixture)
    expect(byName('StrictMode')).toHaveLength(1);

    const app = byName('App')[0];
    expect(app.kind).toBe('component');
    // _debugSource records the JSX site that renders the component — the
    // React analog of Vue's __file points at usage, not definition.
    expect(app.file).toContain('main.tsx');
    expect(app.hooks.useState).toBe('agent-reacttools fixture');
    expect(app.hooks['useState (1)']).toBe(3);
    expect(app.memo).toEqual({ useMemo: 6 });

    const counter = byName('Counter')[0];
    expect(counter.props).toEqual({ step: 1, count: 3, label: 'Count' });
    expect(counter.file).toContain('App.tsx');
    expect(counter.hooks.useState).toBe(7);
    expect(counter.memo).toEqual({ useMemo: 6 });

    expect(byName('HelloWorld')).toHaveLength(1);
    expect(byName('MultiRoot')).toHaveLength(1);
    // the map produces three Item instances
    expect(byName('Item')).toHaveLength(3);

    const classBox = byName('ClassBox')[0];
    expect(classBox.state).toEqual({ message: 'class state message' });

    const provider = byName('Theme.Provider')[0];
    expect(provider.context).toBe('dark');

    const otherApp = byName('OtherApp')[0];
    expect(otherApp.hooks.useState).toBe('second app');
    expect(parsed.react.truncated).toBe(false);
  });

  it('supports browser-level ws URLs with --tab selection', async () => {
    const { parsed, raw } = await cliJson(['tree', '--cdp', chrome!.browserWs, '--tab', 't1', '--depth', '3']);
    expect(raw.code).toBe(0);
    expect(parsed.page.title).toBe('agent-reacttools fixture');
  });

  it('renders a human-readable text tree', async () => {
    const res = await cli(['tree', '--cdp', String(chrome!.port), '--depth', '4']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('└─ StrictMode');
    expect(res.stdout).toContain('Counter');
    expect(res.stdout).toContain('[DIV#counter-box]');
  });
});

describe('inspect', () => {
  it('dumps props, hook state and memo by component name', async () => {
    const { parsed } = await cliJson(['inspect', 'Counter', '--cdp', String(chrome!.port)]);
    const inst = parsed.data.instances[0];
    expect(inst.name).toBe('Counter');
    expect(inst.file).toContain('App.tsx'); // JSX usage site
    expect(inst.props.values).toEqual({ step: 1, count: 3, label: 'Count' });
    expect(inst.hooks.useState).toBe(7);
    expect(inst.memo).toEqual({ useMemo: 6 });
    expect(inst.parentChain.map((p: any) => p.name)).toEqual(['App']);
  });

  it('matches by source-file path substring', async () => {
    // Item is rendered inside ItemList.tsx — all three instances match
    const { parsed } = await cliJson(['inspect', 'ItemList.tsx', '--cdp', String(chrome!.port)]);
    expect(parsed.data.instances).toHaveLength(3);
    expect(parsed.data.instances.every((i: any) => i.name === 'Item')).toBe(true);
  });

  it('matches by CSS selector', async () => {
    const { parsed } = await cliJson(['inspect', '#counter-inc', '--cdp', String(chrome!.port)]);
    expect(parsed.data.instances[0].name).toBe('Counter');
  });

  it('matches by XPath and resolves the owning component', async () => {
    const { parsed } = await cliJson(['inspect', '//button[@id="counter-inc"]', '--cdp', String(chrome!.port)]);
    expect(parsed.data.instances[0].name).toBe('Counter');
  });

  it('matches by visible text', async () => {
    const { parsed } = await cliJson(['inspect', 'Count 3 (7)', '--cdp', String(chrome!.port)]);
    expect(parsed.data.instances[0].name).toBe('Counter');
  });

  it('fails with not-found for unknown queries', async () => {
    const { raw } = await cliJson(['inspect', 'NopeNope', '--cdp', String(chrome!.port)]);
    expect(raw.code).toBe(1);
    const envelope = JSON.parse(raw.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('not-found');
  });
});

describe('find', () => {
  it('locates components by name and reports parent chains', async () => {
    const { parsed } = await cliJson(['find', 'HelloWorld', '--cdp', String(chrome!.port)]);
    expect(parsed.data.matches).toHaveLength(1);
    expect(parsed.data.matches[0].path.map((p: any) => p.name)).toEqual(['StrictMode', 'App', 'HelloWorld']);
  });

  it('matches source-file substrings', async () => {
    // every component used inside App.tsx
    const { parsed } = await cliJson(['find', 'App.tsx', '--cdp', String(chrome!.port)]);
    expect(parsed.data.matches.length).toBeGreaterThanOrEqual(5);
    expect(parsed.data.matches.some((m: any) => m.name === 'Counter')).toBe(true);
  });
});

describe('query (XPath / CSS collection)', () => {
  it('collects XPath matches with owning components', async () => {
    const { parsed } = await cliJson(['query', '//button', '--cdp', String(chrome!.port)]);
    expect(parsed.ok).toBe(true);
    const countBtn = parsed.data.matches.find((m: any) => m.dom?.id === 'count-btn');
    expect(countBtn.component.name).toBe('App');
    const incBtn = parsed.data.matches.find((m: any) => m.dom?.id === 'counter-inc');
    expect(incBtn.component.name).toBe('Counter');
    expect(parsed.data.total).toBeGreaterThanOrEqual(3);
  });

  it('collects CSS selector matches', async () => {
    const { parsed } = await cliJson(['query', '.greet', '--cdp', String(chrome!.port)]);
    expect(parsed.data.matches[0].component.name).toBe('HelloWorld');
  });
});

describe('style', () => {
  it('dumps computed style with explicit class for a CSS selector', async () => {
    const { parsed } = await cliJson(['style', '.greet', '--cdp', String(chrome!.port)]);
    expect(parsed.data.tag).toBe('p');
    expect(parsed.data.class).toBe('greet'); // full class attribute, explicit field
    expect(parsed.data.style).toHaveProperty('display');
    expect(parsed.data.style).toHaveProperty('color');
  });

  it('supports XPath targets', async () => {
    const { parsed } = await cliJson(['style', '//span[@id="counter-doubled"]', '--cdp', String(chrome!.port)]);
    expect(parsed.data.id).toBe('counter-doubled');
    expect(parsed.data.class).toBeNull();
  });
});

describe('non-React pages and tab selection', () => {
  it('reports no-react on a plain page (second tab)', async () => {
    // Open a second tab with the plain page via the browser-level connection.
    const client = await CdpClient.connect(chrome!.browserWs, { timeoutMs: 10_000 });
    try {
      await client.send('Target.createTarget', { url: `${FIXTURE_URL}plain.html` });
    } finally {
      client.close();
    }
    // Target.getTargets order is not guaranteed — select by URL substring.
    const { raw } = await cliJson(['tree', '--cdp', chrome!.browserWs, '--tab', 'plain.html']);
    expect(raw.code).toBe(1);
    const envelope = JSON.parse(raw.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe('no-react');
  }, 60_000);

  it('rejects a bad --tab selector with a helpful error', async () => {
    const { raw } = await cliJson(['tree', '--cdp', chrome!.browserWs, '--tab', 't99']);
    expect(raw.code).toBe(1);
    const envelope = JSON.parse(raw.stdout);
    expect(envelope.error.code).toBe('bad-tab');
  });

  it('runs DOM queries on non-React pages too', async () => {
    const { parsed } = await cliJson(['query', '//div[@id="not-react"]', '--cdp', chrome!.browserWs, '--tab', 'plain.html']);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.matches[0].component).toBeNull();
  });
});
