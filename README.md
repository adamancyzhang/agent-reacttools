# agent-reacttools

Inspect React components in a live browser over CDP — no react-devtools extension needed. Built for AI agents: stable machine-readable output, plus a human-readable text format.

[![npm version](https://img.shields.io/npm/v/%40adamancyzhang%2Fagent-reacttools)](https://www.npmjs.com/package/@adamancyzhang/agent-reacttools)
[![license](https://img.shields.io/npm/l/%40adamancyzhang%2Fagent-reacttools)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-green)](package.json)

## What it does

The React runtime marks every rendered DOM node with internal expando properties — `__reactContainer$…` on containers, `__reactFiber$…` on elements (React 17/18/19), `__reactInternalInstance$…` (React 16). agent-reacttools connects to the browser via the Chrome DevTools Protocol (CDP), injects a probe script that walks the fiber tree (`child`/`sibling` pointers → `memoizedProps` / hooks `memoizedState` / `_debugSource`), serializes cycle-safely in-page, and returns the result as JSON or a text tree.

```bash
agent-reacttools tree                      # component tree of the page
agent-reacttools inspect Counter --json    # props, hook state, memo of one component
agent-reacttools query '//button[contains(@class, "nav")]'   # collect DOM matches + owning components
agent-reacttools style '#submit-btn'       # computed style of an element
```

## Installation

### Global (recommended)

```bash
npm install -g @adamancyzhang/agent-reacttools
```

Requires Node >= 18. No other dependencies — the only runtime dependency is `ws`.

### From source

```bash
git clone https://github.com/adamancyzhang/agent-reacttools.git
cd agent-reacttools
npm install
npm run build
npm link
```

### Requirements

A Chrome/Edge with a debugging port (default `127.0.0.1:9222`):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
```

That's it. Open your React page (dev server recommended for the richest output) and run any command.

## Quick Start

```bash
agent-reacttools tree                        # component tree
agent-reacttools inspect Counter             # deep-dive by component name
agent-reacttools inspect src/components/     # by source path substring
agent-reacttools inspect "#submit-btn"       # by CSS selector
agent-reacttools inspect '//*[text()[contains(., "Submit")]]'   # by XPath
agent-reacttools inspect "Back to list"      # by visible text
agent-reacttools find NavLink                # locate + parent chains
agent-reacttools query '.nav a' --limit 20   # collect DOM matches
agent-reacttools style '.ant-btn-primary'    # computed style + full class
```

## Commands

### tree

```
agent-reacttools tree [--depth N] [--fields ...] [--compact] [--json]
```

Prints the component + element tree. Component nodes carry a `[DOM]` bracket, prop values, a hooks summary, and the source path (dev builds).

| Flag | Description |
|---|---|
| `--depth <n>` | Max tree depth. Default 8, no upper limit (5000-node cap still applies) |
| `--fields <list>` | Comma-separated: `props,hooks,memo,context,state,file,dom` (default: `props,hooks,file,dom`) |
| `--compact` | Name and DOM only |

```
# 2 React apps found on this page
└─ StrictMode [DIV#app]
   └─ App {hooks: useState="agent-reacttools fixture", useState (1)=3, useMemo=6} [DIV#app-root.app-shell] (src/main.tsx)
      ├─ h1 [H1] "agent-reacttools fixture"
      ├─ Counter {step: 1, count: 3, label: "Count"} {hooks: useState=7, useMemo=6} [DIV#counter-box] (src/App.tsx)
      ├─ ItemList [UL#item-list] (src/App.tsx)
      │  └─ li [LI.item] "alpha"
      ├─ MultiRoot [P#mr-1] "root one"
      │  └─ p [P#mr-2] "root two"
      └─ ThemeBox [BUTTON#theme-btn] "dark" (src/App.tsx)
```

A component's own root-element line is elided (its DOM is already in the bracket); unkeyed React fragments are transparent, so multi-root components' elements render at the component's level.

### inspect

```
agent-reacttools inspect <query> [--fields ...] [--json]
```

Deep-dives one component. Resolution order: **component name** → **source path substring** (case-insensitive) → **CSS selector** → **XPath expression** → **visible text**.

Output: resolved props (+ `defaultProps` defaults when declared), hook state (useState/useReducer/useRef/useContext values; useMemo/useCallback results), memo, class component state, context provider values, and the parent chain.

```
Counter (src/App.tsx)
  DOM: <div#counter-box>
  Parent chain: App

  props:
    step: 1
    count: 3
    label: "Count"

  hooks:
    useState: 7
    useMemo: 6

  memo:
    useMemo: 6
```

### find

```
agent-reacttools find <name|path-substring>
```

Locates components in the tree and prints each match with its parent chain:

```
NavLink (src/App.tsx)
  at: App → Header → NavLink
```

### query

```
agent-reacttools query <xpath|css> [--limit N] [--json]
```

Collects DOM elements (XPath expression or CSS selector). Each match reports the element descriptor plus its owning component (name/source, or null for plain DOM). Capped at 50 matches by default. Works on non-React pages too.

```
# 2 of 2 matches for "//button[contains(@class, "q-btn")]"
[BUTTON#q-btn-1.q-btn] "Submit order" — QueryApp
[BUTTON#q-btn-2.q-btn] "Cancel" — QueryApp
```

### style

```
agent-reacttools style <xpath|css> [--all] [--json]
```

Dumps an element's computed style (a curated ~40 layout/typography/color properties by default, `--all` for every property), inline style, and explicit `tag` / `id` / **full untruncated `class`** / `text` fields — the class attribute is the primary hook for style debugging. Works on non-React pages too.

```
tag: button
class: "ant-btn ant-btn-primary"
text: "Submit order"
computed style:
  display: inline-flex
  position: relative
  width: 74px
```

### Selectors

`inspect` resolves its query in a fixed chain (name → source path → CSS → XPath → visible text); `query` and `style` accept XPath or CSS directly. XPath expressions are evaluated by the browser's native engine (XPath 1.0).

> Visible-text search first tries direct text nodes; React splits interpolated text into sibling text nodes, so it then falls back to the element's complete text content, keeping only the deepest matches. `contains(text(), 'q')` in your own XPath only checks the **first** text node — to match any direct text node, use `//*[text()[contains(., 'q')]]`. See [skills/agent-reacttools/references/xpath.md](skills/agent-reacttools/references/xpath.md) for the full XPath reference.

## Agent Mode

`--json` prints a single-line envelope on stdout — errors included:

```json
{"ok":true,"command":"tree","page":{"title":"…","url":"…"},
 "react":{"version":"18+","apps":1,"truncated":false},
 "data":{"roots":[{"name":"App","kind":"component","file":"src/App.tsx","dom":{"tag":"div","id":"app"},
   "props":{"msg":"hi"},"hooks":{"useState":3},"children":[…]}]}}
```

Error envelope: `{"ok":false,"error":{"code":"…","message":"…","hint":"…"}}` with a stable `code`:

| Code | Meaning |
|---|---|
| `no-react` | No React app on the selected page (may still be loading — retry) |
| `not-found` | No component/element matches the query |
| `bad-query` | Invalid XPath / CSS expression |
| `no-browser` | No reachable CDP endpoint |
| `ambiguous-tab` | Multiple tabs, none selected — error lists them |
| `bad-tab` | `--tab` selector matched nothing |

Exit codes: `0` success / `1` runtime error / `2` usage error. With `--json`, the error JSON goes to stdout and the human-readable explanation to stderr.

## Connecting

1. **`--cdp <port|host:port|http(s)://url|ws(s)://url>`** — explicit debugging endpoint
2. **Fallback probe of `127.0.0.1:9222`**

Multiple tabs: pick with `--tab` (`t1`/`t2`… 1-based, exact title, or URL substring). Prefer URL substrings — `Target.getTargets` order is not guaranteed. With multiple tabs and no `--tab`, the CLI errors and lists the options.

## Browser operations

agent-reacttools inspects but never drives the page. For browser control — opening URLs, clicking, filling forms, screenshots — pair it with [agent-browser](https://github.com/vercel-labs/agent-browser), which manages a Chrome instance over the same CDP protocol:

```bash
npm i -g agent-browser
agent-browser install                  # first time only
agent-browser open http://localhost:5173

agent-reacttools tree --cdp "$(agent-browser get cdp-url)"   # inspect its browser
agent-browser click "#submit"                               # drive the UI
agent-reacttools inspect SubmitButton --cdp "$(agent-browser get cdp-url)" --fields props,hooks,memo
```

`agent-browser get cdp-url` bridges the two tools: it prints the ws URL of agent-browser's Chrome, which agent-reacttools accepts directly via `--cdp`.

## Limits & Caveats

- **React 16/17/18/19** (the probe reads the fiber tree through the DOM markers each major ships).
- **Production builds** lose `_debugSource` paths, hook names (keys degrade to `h0..hN`), and often component names (minified to `Anonymous`) — the same limits react-devtools has. Dev builds give the richest output.
- `_debugSource` records the **JSX site that renders** a component (the react-devtools source-panel location), not its definition file — this differs from Vue's `__file`, which points at the definition.
- **Version reporting**: the runtime exposes no version field; the probe reports `window.React.version` for UMD builds and otherwise the major inferred from DOM markers (`18+` / `17` / `16`).
- **iframes**: main frame only. **Suspense** shows the committed branch; **unkeyed fragments** are transparent (React flattens them in the fiber tree), keyed fragments appear as nodes.
- **Huge pages**: tree caps at 5000 nodes (`truncated: true`). For deep content, use `inspect`/`query` with XPath or text targeting instead of the tree.
- Reading hook values triggers their getters (side-effect-free by convention — standard for component inspection tools).

## Skill for AI Coding Assistants

Install the agent-reacttools skill with the [skills](https://skills.sh) CLI, directly from GitHub:

```bash
npx skills add adamancyzhang/agent-reacttools
```

The skill is fetched from this repository (`skills/agent-reacttools/SKILL.md`), so it stays up to date automatically. Works with Claude Code, Codex, Cursor, Gemini CLI, and other skills-aware assistants. Do not copy `SKILL.md` from `node_modules` — it will become stale.

Manual install for Claude Code:

```bash
mkdir -p .claude/skills
cp -r skills/agent-reacttools .claude/skills/
```

## Development

```bash
npm install
npm run build          # typecheck + esbuild bundle to dist/cli.js
npm run test           # unit tests (ws.Server for the CDP layer; jsdom + React DOM for the probe)
npm run test:e2e       # E2E: real headless Chrome + Vite dev fixture (requires local Chrome)
npm run fixture:serve  # serve the fixture dev server manually (port 4173)
```

Layout: `src/cdp/` (minimal CDP client, endpoint discovery, tab attach) · `src/probe/probe.js` (the injected page probe, embedded into the bundle as a string at build time) · `src/commands/` (tree/inspect/find/query/style) · `src/output/text.ts` (text rendering) · `test/fixtures/react-app/` (Vite + React 18 fixture) · `skills/` (agent skill docs).

## Roadmap

- iframe / shadow DOM traversal
- Hook change stream (live re-inspection loop)
- MCP server mode

## License

[MIT](LICENSE) © 2026 Adamancy Zhang
