---
name: agent-reacttools
description: React component introspection CLI for AI agents. Use when the user needs to inspect or debug React components in a running browser — viewing the component tree, checking props, hook state (useState/useMemo/context), locating components by name/_debugSource path/CSS selector/XPath/visible text, or debugging element styles. Triggers include requests to "show the component tree", "what props does this component receive", "find the button that says ...", "inspect this React component", "where is this component rendered", or "debug this element's styles". Works over CDP against any Chrome/Edge with a remote-debugging port; no react-devtools extension required. Pair with the agent-browser skill for browser operations (opening URLs, clicking, filling) during React debugging.
allowed-tools: Bash(agent-reacttools:*)
---

# agent-reacttools

Inspect React components (fiber tree, props, hook state, useMemo values, context) in a live browser over CDP — **no react-devtools extension needed**.

Requires Chrome/Edge running with a debugging port (default: `127.0.0.1:9222`):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
```

agent-reacttools only **inspects** — it never opens URLs or manipulates pages. For browser control, pair it with the `agent-browser` skill (see [Browser operations](#browser-operations-agent-browser)).

## Core workflows

### 1. See the component tree

```bash
agent-reacttools tree                     # full tree: components + elements
agent-reacttools tree --depth 3 --compact # names + DOM only
agent-reacttools tree --json              # machine-readable
```

Component nodes carry `[DOM]` brackets, prop values, a hooks summary, and the source path (dev builds). A component's own root element line is elided (its DOM is already in the bracket); unkeyed React fragments are transparent.

### 2. Inspect a component

```bash
agent-reacttools inspect Counter          # by component name
agent-reacttools inspect src/components/  # by source path substring
agent-reacttools inspect "#submit-btn"    # by CSS selector
agent-reacttools inspect '//*[text()[contains(., "Submit")]]'  # by XPath
agent-reacttools inspect "Back to list"   # by visible text
```

Output: resolved props (+ defaultProps defaults), hook state (useState/useReducer/useRef/useContext values, useMemo/useCallback results), memo group, class component state, context provider values, and the parent chain. Resolution order: component name → source path substring → CSS selector → XPath → visible text.

### 3. Locate components in the tree

```bash
agent-reacttools find <name|path-substring>
```

Prints each match with its parent chain (`App → Header → NavLink`).

### 4. Collect DOM matches

```bash
agent-reacttools query '//button[contains(@class, "ant-btn")]'   # XPath
agent-reacttools query '.nav a' --limit 20                        # CSS, 50 by default
```

Each match reports the element descriptor plus its owning component (name/source, or null for plain DOM). Works on non-React pages too.

### 5. Debug element styles

```bash
agent-reacttools style '.ant-btn-primary'   # computed style, curated ~40 keys
agent-reacttools style '//button[@id="save"]' --all   # every property
```

Output includes explicit `tag` / `id` / **full untruncated `class`** / `text` fields plus inline style — the class attribute is the primary hook for style debugging. Works on non-React pages too.

## Browser operations (agent-browser)

For opening URLs, clicking, filling forms, or taking screenshots, use the [agent-browser](https://github.com/vercel-labs/agent-browser) CLI — it manages a Chrome instance over the same CDP protocol that agent-reacttools connects to.

```bash
npm i -g agent-browser
agent-browser install      # first time only: download Chrome for Testing
```

### Point agent-reacttools at agent-browser's browser

```bash
agent-browser open http://localhost:5173     # launch browser + navigate
agent-reacttools tree --cdp "$(agent-browser get cdp-url)"
```

`agent-browser get cdp-url` prints the browser-level ws URL; pass it to `--cdp` on every agent-reacttools command. If agent-browser's Chrome runs on a known debugging port, use `--cdp <port>` instead.

### Debug loop: drive the UI, then inspect the result

```bash
agent-browser open http://localhost:5173
agent-reacttools tree --cdp "$(agent-browser get cdp-url)"

agent-browser click "#count-btn"     # drive the UI
agent-reacttools inspect Counter --cdp "$(agent-browser get cdp-url)" --fields props,hooks,memo
# → count changed 3 → 4, memo doubled now 8: state change verified

agent-browser screenshot bug.png     # capture for the record
```

### Frequently used agent-browser commands

| Command | Purpose |
|---|---|
| `open <url>` | Launch browser and navigate |
| `snapshot -i` | Accessibility tree with element refs (`@e1`, `@e2`) |
| `click <sel>` / `fill <sel> <text>` | Interact via CSS selectors or refs |
| `screenshot [path]` | Capture the page |
| `eval <js>` | Run JS in the page |
| `get cdp-url` | CDP ws URL of its browser (bridge to agent-reacttools) |
| `close --all` | Shut the browser down |

Every agent-browser command accepts `--json`. For the full reference, load the agent-browser skill (`agent-browser skills get core`).

## Commands

| Command | Purpose |
|---|---|
| `tree [--depth N] [--fields ...] [--compact]` | Component + element tree (`--depth` default 8, no upper limit; 5000-node cap) |
| `inspect <query> [--fields ...]` | Deep-dive one component: name, source substring, CSS, XPath, or visible text |
| `find <name\|path>` | Locate components in the tree, print parent chains |
| `query <xpath\|css> [--limit N]` | Collect DOM elements with their owning components |
| `style <xpath\|css> [--all]` | Computed style + explicit tag/id/class/text of an element |

Common flags: `--cdp <port|url>` · `--tab <t1|title|url-substring>` · `--json` · `--fields props,hooks,memo,context,state,file,dom`

## Connecting

1. Explicit `--cdp <port|host:port|http(s)://url|ws(s)://url>`
2. Fallback probe of `127.0.0.1:9222`

Multiple tabs without `--tab` → error listing the options. Prefer URL-substring `--tab` over positional `t1`/`t2` (target order is not guaranteed).

## JSON mode

`--json` prints a single-line envelope on stdout (errors included):

```json
{"ok":true,"command":"tree","page":{"title":"…","url":"…"},"react":{"version":"18+","apps":1,"truncated":false},"data":{"roots":[…]}}
```

Errors: `{"ok":false,"error":{"code":"no-react|not-found|bad-query|no-browser|ambiguous-tab|bad-tab|…","message":"…"}}`. Exit codes: `0` success / `1` runtime error / `2` usage error.

## Limits

- **React 16/17/18/19**. Dev builds give the richest output: `_debugSource` file paths and hook names from `_debugHookTypes`. In production builds these degrade (`file: null`, hook keys `h0..hN`, minified component names) — the same limits react-devtools has.
- `_debugSource` records the **JSX site that renders** the component (like react-devtools' source panel), not its definition file.
- The runtime does not expose the React version — the probe reports the UMD `React.version` when present, else the major inferred from DOM markers (`18+`/`17`/`16`).
- **iframes**: main frame only. Unkeyed fragments are transparent (React flattens them); keyed fragments appear as nodes. Suspense shows the committed branch.
- Huge pages: tree caps at 5000 nodes (`truncated: true`); prefer `inspect`/`query` XPath or text targeting for deep content.
- Reading hook values runs their getters (side-effect-free by convention — standard for component inspection tools).
- Page still loading → `no-react`; retry in a moment.

## References

- [references/xpath.md](references/xpath.md) — XPath 1.0 syntax reference for `inspect`/`query`/`style`
