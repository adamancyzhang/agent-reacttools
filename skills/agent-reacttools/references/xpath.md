# XPath 1.0 Reference

XPath expressions in `inspect` / `query` / `style` are evaluated with the browser's native `document.evaluate` (XPath 1.0). An expression is treated as XPath when it starts with `/`, `//`, `./`, `(/`, or contains a `::` axis.

## Paths

| Expression | Matches |
|---|---|
| `/html/body/div` | Absolute path from the root |
| `//button` | All `<button>` elements anywhere |
| `.//input` | Descendants of the context node |
| `//div/*` | Any element child of a div |
| `//div[@id="app"]//a` | Links inside `#app` |

## Predicates

| Expression | Matches |
|---|---|
| `//button[@id="save"]` | Attribute equals |
| `//a[contains(@class, "nav")]` | Class attribute substring |
| `//div[@data-id="5" and @role="tab"]` | Multiple conditions |
| `//ul/li[1]` | First `<li>` of each `<ul>` (1-based) |
| `//tr[last()]` | Last row |
| `//input[@type!="hidden"]` | Inequality |
| `//button[starts-with(@class, "ant-btn")]` | Attribute prefix |

## Text matching

| Expression | Matches |
|---|---|
| `//*[text()[contains(., "Submit")]]` | Any direct text node containing "Submit" (**recommended**) |
| `//button[contains(text(), "Submit")]` | Only checks the **first** text node |
| `//span[text()="Exact"]` | Exact text-node equality |
| `//h1[normalize-space(.)="Title"]` | Collapsed-whitespace full text |

> **Gotcha:** `contains(text(), q)` only inspects the *first* text node. Elements whose text is split across multiple text nodes (template interpolation, nested spans) won't match. Use `text()[contains(., q)]`, which tests every direct text node.

## Axes

| Expression | Matches |
|---|---|
| `//label/following-sibling::input` | Sibling input after a label |
| `//td/preceding-sibling::td` | Preceding cell |
| `//div/ancestor::section` | Ancestor section elements |
| `//p/parent::div` | Parent element of a `<p>` |

## Common recipes with agent-reacttools

```bash
# All primary buttons
agent-reacttools query '//button[contains(@class, "ant-btn-primary")]'

# Every element whose direct text mentions "member"
agent-reacttools query '//*[text()[contains(., "member")]]'

# The input next to a specific label
agent-reacttools inspect '//label[contains(text(), "Email")]/following-sibling::input'

# Style of the submit button inside a form
agent-reacttools style '//form[@id="login"]//button[@type="submit"]'
```

## Limits (XPath 1.0)

- No regex, no `string-join`, no `lower-case()`; string comparisons are case-sensitive.
- `contains()` with a node-set as the first argument (e.g. `contains(text(), q)`) converts the node-set to its first node's string value.
- HTML tag names are case-insensitive in HTML documents — `//BUTTON` and `//button` match the same elements.
