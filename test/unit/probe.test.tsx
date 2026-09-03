// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { Component, createContext, forwardRef, useContext, useImperativeHandle, useMemo, useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const probeSource = readFileSync(resolve(process.cwd(), 'src/probe/probe.js'), 'utf8');
// Indirect eval runs in global scope so `document` resolves against jsdom.
const probe = (0, eval)(probeSource) as (task: Record<string, unknown>) => string;

function run(task: Record<string, unknown>): any {
  const raw = probe(task);
  const parsed = JSON.parse(raw) as { ok: boolean; data?: unknown; error?: { code: string; message: string; stack?: string } };
  if (!parsed.ok) {
    throw new Error(`probe error [${parsed.error!.code}]: ${parsed.error!.message}\n${parsed.error!.stack ?? ''}`);
  }
  return parsed.data;
}

function mount(element: React.ReactElement, container = 'app'): void {
  const el = document.getElementById(container)!;
  const root = createRoot(el);
  act(() => {
    root.render(element);
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="app2"></div>';
});

// ---- test components ---------------------------------------------------------

function HelloWorld({ greeting, count }: { greeting: string; count: number }) {
  return (
    <div id="hw">
      <p className="greet">{greeting}</p>
      <button onClick={() => {}}>push</button>
    </div>
  );
}

function App() {
  const [title] = useState('Agent ReactTools');
  const [count, setCount] = useState(3);
  const doubled = useMemo(() => count * 2, [count]);
  return (
    <div id="app-root">
      <HelloWorld greeting="Hi" count={3} />
    </div>
  );
}

function OtherApp() {
  const [msg] = useState('second app');
  return <div id="other-root">{msg}</div>;
}

function FragmentComp() {
  return (
    <>
      <p id="f1">one</p>
      <p id="f2">two</p>
    </>
  );
}

class ClassComp extends Component<object, { message: string }> {
  state = { message: 'hello class' };
  render() {
    return <div id="class-comp">{this.state.message}</div>;
  }
}

const ThemeContext = createContext('light');
ThemeContext.displayName = 'Theme';

function Themed() {
  const theme = useContext(ThemeContext);
  return <span id="ctx-consumer">{theme}</span>;
}

function ContextComp() {
  return (
    <ThemeContext.Provider value="dark">
      <Themed />
    </ThemeContext.Provider>
  );
}

const ImpComp = forwardRef<{ focus: () => void }>(function ImpComp(_props, ref) {
  const [val] = useState(1);
  useImperativeHandle(ref, () => ({ focus: () => {} }));
  return <input id="imp" value={val} readOnly />;
});

// ---- tree --------------------------------------------------------------------

describe('probe tree', () => {
  it('builds the component tree with props, hooks and memo', () => {
    mount(<App />);
    const data = run({ command: 'tree', depth: 8 });

    expect(data.apps).toBe(1);
    expect(data.version).toBe('18+'); // ESM build: no window.React global
    expect(data.truncated).toBe(false);

    const root = data.roots[0];
    expect(root.kind).toBe('component');
    expect(root.name).toBe('App');
    // esbuild's JSX transform (unit tests) does not inject __source, so
    // _debugSource is null here; the Vite dev fixture exercises it in e2e.
    expect(root.file).toBeNull();
    expect(root.hooks.useState).toBe('Agent ReactTools');
    expect(root.hooks['useState (1)']).toBe(3);
    expect(root.memo).toEqual({ useMemo: 6 });

    // Root's direct children: the root element (depth 0), which holds HelloWorld (depth 1).
    const rootEl = root.children[0];
    expect(rootEl).toMatchObject({ kind: 'element', name: 'div' });
    expect(rootEl.dom).toMatchObject({ tag: 'div', id: 'app-root' });

    const hw = rootEl.children[0];
    expect(hw.kind).toBe('component');
    expect(hw.name).toBe('HelloWorld');
    // props are resolved values (tree mode = flat, no defs)
    expect(hw.props).toEqual({ greeting: 'Hi', count: 3 });

    // HelloWorld's own root element is included in the tree
    const hwEl = hw.children[0];
    expect(hwEl).toMatchObject({ kind: 'element', name: 'div' });
    expect(hwEl.dom.id).toBe('hw');
    const button = hwEl.children.find((n: any) => n.name === 'button');
    expect(button.dom.text).toBe('push');
  });

  it('handles multiple apps (multi-root / micro-frontends)', () => {
    mount(<App />, 'app');
    mount(<OtherApp />, 'app2');
    const data = run({ command: 'tree', depth: 8 });
    expect(data.apps).toBe(2);
    expect(data.roots.map((r: any) => r.name)).toEqual(['App', 'OtherApp']);
  });

  it('walks multi-root components (React flattens top-level fragments)', () => {
    mount(<FragmentComp />);
    const data = run({ command: 'tree', depth: 8 });
    const root = data.roots[0];
    // Component DOM bracket = first host descendant of the fragment
    expect(root.dom).toMatchObject({ tag: 'p', id: 'f1' });
    // React 18 does not create a Fragment fiber for a component's top-level
    // fragment — the children hang off the component fiber directly.
    expect(root.children.map((c: any) => c.dom.id)).toEqual(['f1', 'f2']);
  });

  it('walks keyed fragments as fragment nodes (unkeyed ones are transparent)', () => {
    function NestedFrag() {
      return (
        <div id="nf">
          <React.Fragment key="k">
            <span id="s1">a</span>
            <span id="s2">b</span>
          </React.Fragment>
        </div>
      );
    }
    mount(<NestedFrag />);
    const data = run({ command: 'tree', depth: 8 });
    const root = data.roots[0];
    const div = root.children[0];
    expect(div.name).toBe('div');
    const frag = div.children[0];
    expect(frag.kind).toBe('fragment');
    expect(frag.children.map((c: any) => c.dom.id)).toEqual(['s1', 's2']);
  });

  it('reads class component state', () => {
    mount(<ClassComp />);
    const data = run({ command: 'tree', depth: 8 });
    const root = data.roots[0];
    expect(root.name).toBe('ClassComp');
    expect(root.state).toEqual({ message: 'hello class' });
    expect(root.hooks).toBeUndefined();
  });

  it('reads context providers and consumers', () => {
    mount(<ContextComp />);
    const data = run({ command: 'tree', depth: 8 });
    const root = data.roots[0];
    expect(root.name).toBe('ContextComp');
    const provider = root.children[0];
    expect(provider.name).toBe('Theme.Provider');
    expect(provider.context).toBe('dark');
    const themed = provider.children[0];
    expect(themed.name).toBe('Themed');
    expect(themed.hooks).toEqual({ useContext: 'dark' });
  });

  it('names forwardRef components and marks imperative handles', () => {
    mount(<ImpComp />);
    const data = run({ command: 'tree', depth: 8 });
    const root = data.roots[0];
    // from the render function name (esbuild may suffix it in tests)
    expect(root.name).toMatch(/^ImpComp/);
    expect(root.hooks.useState).toBe(1);
    expect(root.hooks.useImperativeHandle).toBe('[Effect]');
  });

  it('respects the depth cap and flags truncation', () => {
    mount(<App />);
    // depth 1 = root + its children + their children; anything deeper is cut
    const shallow = run({ command: 'tree', depth: 1 });
    const div = shallow.roots[0].children[0];
    expect(div.name).toBe('div');
    expect(div.children[0].name).toBe('HelloWorld');
    expect(div.children[0].children).toBeUndefined();
    expect(shallow.truncated).toBe(true);

    // depth 2 = one level deeper (HelloWorld's own children)
    const deep = run({ command: 'tree', depth: 2 });
    expect(deep.roots[0].children[0].children[0].children.length).toBeGreaterThan(0);
  });

  it('honors the fields whitelist', () => {
    mount(<App />);
    const data = run({ command: 'tree', depth: 8, fields: ['props'] });
    const hw = data.roots[0].children[0].children[0];
    expect(hw.props).toEqual({ greeting: 'Hi', count: 3 });
    expect(hw.hooks).toBeUndefined();
    expect(hw.memo).toBeUndefined();
  });
});

// ---- inspect -----------------------------------------------------------------

describe('probe inspect', () => {
  it('matches by component name and returns full detail', () => {
    mount(<App />);
    const data = run({ command: 'inspect', query: 'HelloWorld', detail: true });
    expect(data.query).toBe('HelloWorld');
    expect(data.instances).toHaveLength(1);
    const inst = data.instances[0];
    expect(inst.name).toBe('HelloWorld');
    expect(inst.props.values).toEqual({ greeting: 'Hi', count: 3 });
    expect(inst.parentChain.map((p: any) => p.name)).toEqual(['App']);
    expect(inst.dom).toMatchObject({ tag: 'div', id: 'hw' });
  });

  it('matches by _debugSource file substring', () => {
    mount(<App />);
    // esbuild's JSX transform (unit tests) does not inject __source, so
    // _debugSource is null — stamp it manually like the Vite dev build does.
    const el = document.getElementById('app')!;
    const key = Object.getOwnPropertyNames(el).find((k) => k.startsWith('__reactContainer$'))!;
    const rootFiber = (el as any)[key].stateNode.current;
    // App fiber → div#app-root → HelloWorld fiber
    rootFiber.child.child.child._debugSource = { fileName: '/src/components/HelloWorld.tsx', lineNumber: 1, columnNumber: 1 };
    const data = run({ command: 'inspect', query: 'components/HelloWorld', detail: true });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('HelloWorld');
    expect(data.instances[0].file).toBe('/src/components/HelloWorld.tsx');
  });

  it('matches by CSS selector', () => {
    mount(<App />);
    const data = run({ command: 'inspect', query: '#hw', detail: true });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('HelloWorld');
  });

  it('matches components by visible text', () => {
    function TextBtn() {
      return <button id="back-btn">Back to member list</button>;
    }
    function TextApp() {
      return (
        <div>
          <TextBtn />
        </div>
      );
    }
    mount(<TextApp />);
    const data = run({ command: 'inspect', query: 'Back to member list' });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('TextBtn');
  });

  it('dedupes text matches that resolve to the same component', () => {
    function NestedText() {
      return (
        <button>
          <span>Submit order</span>
        </button>
      );
    }
    function NestedApp() {
      return (
        <div>
          <NestedText />
        </div>
      );
    }
    mount(<NestedApp />);
    // both <button> and <span> carry the text — one component, one match
    const data = run({ command: 'inspect', query: 'Submit order' });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('NestedText');
  });

  it('returns every match for a repeated component name', () => {
    function Twice() {
      return <span />;
    }
    function TwiceApp() {
      return (
        <div>
          <Twice />
          <Twice />
        </div>
      );
    }
    mount(<TwiceApp />);
    const data = run({ command: 'inspect', query: 'Twice' });
    expect(data.instances).toHaveLength(2);
  });

  it('matches by XPath', () => {
    mount(<App />);
    const data = run({ command: 'inspect', query: '//p[@class="greet"]', detail: true });
    expect(data.instances).toHaveLength(1);
    expect(data.instances[0].name).toBe('HelloWorld');
  });

  it('fails with not-found for unknown queries', () => {
    mount(<App />);
    const raw = probe({ command: 'inspect', query: 'Nope' });
    const parsed = JSON.parse(raw);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('not-found');
  });
});

// ---- query (XPath / CSS collection) ------------------------------------------

describe('probe query', () => {
  function QueryApp() {
    return (
      <div id="qa">
        <button id="q-btn-1" className="q-btn">
          Submit order
        </button>
        <button id="q-btn-2" className="q-btn">
          Cancel
        </button>
        <span className="plain">Plain text</span>
      </div>
    );
  }

  beforeEach(() => {
    mount(<QueryApp />);
  });

  it('collects XPath matches with their owning components', () => {
    const data = run({ command: 'query', query: '//button[contains(@class, "q-btn")]' });
    expect(data.total).toBe(2);
    expect(data.truncated).toBe(false);
    expect(data.matches).toHaveLength(2);
    expect(data.matches[0]).toMatchObject({
      dom: { tag: 'button', id: 'q-btn-1' },
      component: { name: 'QueryApp' },
    });
  });

  it('collects CSS selector matches and respects the limit', () => {
    const data = run({ command: 'query', query: 'button', limit: 1 });
    expect(data.total).toBe(2);
    expect(data.truncated).toBe(true);
    expect(data.matches).toHaveLength(1);
  });

  it('reports null components for elements outside any React tree', () => {
    const plain = document.createElement('span');
    plain.className = 'plain-outside';
    plain.textContent = 'Outside';
    document.body.appendChild(plain);
    const data = run({ command: 'query', query: '//span[@class="plain-outside"]' });
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0].component).toBeNull();
  });

  it('reports bad-query for invalid expressions', () => {
    const parsed = JSON.parse(probe({ command: 'query', query: '//[invalid' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('bad-query');
  });
});

// ---- style --------------------------------------------------------------------

describe('probe style', () => {
  it('dumps computed style, inline style and explicit identity fields', () => {
    function Styled() {
      return (
        <button id="styled-btn" className="btn btn-primary active" style={{ color: 'red', padding: '4px' }}>
          Click me
        </button>
      );
    }
    mount(<Styled />);
    const data = run({ command: 'style', query: '#styled-btn' });
    expect(data.tag).toBe('button');
    expect(data.id).toBe('styled-btn');
    expect(data.class).toBe('btn btn-primary active'); // full, untruncated
    expect(data.text).toBe('Click me');
    expect(data.style.color).toBe('rgb(255, 0, 0)');
    expect(data.style.padding).toBe('4px');
    expect(data.inline).toContain('color');
  });

  it('does not truncate long class attributes', () => {
    const long = Array.from({ length: 20 }, () => 'verylongclassname').join(' ');
    function StyledLong() {
      return <button className={long}>x</button>;
    }
    mount(<StyledLong />);
    const data = run({ command: 'style', query: 'button' });
    expect(data.class).toBe(long); // full length
    expect(data.class!.length).toBe(long.length);
  });

  it('supports XPath target expressions', () => {
    function Styled2() {
      return (
        <button id="styled-btn2" style={{ color: 'blue' }}>
          Click me
        </button>
      );
    }
    mount(<Styled2 />);
    const data = run({ command: 'style', query: '//button[@id="styled-btn2"]' });
    expect(data.style.color).toBe('rgb(0, 0, 255)');
  });

  it('fails with not-found for unknown targets', () => {
    const parsed = JSON.parse(probe({ command: 'style', query: '#missing' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('not-found');
  });
});

// ---- errors and serialization -------------------------------------------------

describe('probe errors and serialization', () => {
  it('reports no-react on a React-free page', () => {
    const parsed = JSON.parse(probe({ command: 'tree' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('no-react');
  });

  it('serializes circular references safely', () => {
    function Circular() {
      const [a] = useState(() => {
        const obj: any = { label: 'loop' };
        obj.self = obj;
        return obj;
      });
      return <div>{String(a.label)}</div>;
    }
    mount(<Circular />);
    const data = run({ command: 'tree', depth: 1 });
    expect(data.roots[0].hooks.useState).toEqual({ label: 'loop', self: '[Circular]' });
  });

  it('serializes shared (non-cyclic) references without false positives', () => {
    function Shared() {
      const common = useMemo(() => ({ x: 1 }), []);
      const [pair] = useState(() => ({ a: common, b: common }));
      return <div>{pair.a.x}</div>;
    }
    mount(<Shared />);
    const data = run({ command: 'tree', depth: 1 });
    expect(data.roots[0].hooks.useState).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });

  it('serializes React elements in props as markers', () => {
    function Child() {
      return <span>child</span>;
    }
    function Parent({ children }: { children: React.ReactNode }) {
      return <div>{children}</div>;
    }
    mount(
      <Parent>
        <Child />
      </Parent>,
    );
    const data = run({ command: 'inspect', query: 'Parent', detail: true });
    // inspect keeps children; the React element becomes a compact marker
    expect(data.instances[0].props.values.children).toBe('[<Child>]');
  });
});
