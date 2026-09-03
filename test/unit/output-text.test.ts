import { describe, expect, it } from 'vitest';
import { domLabel, fmtValue, renderTreeText } from '../../src/output/text.js';
import type { TreeNode, TreeProbeData } from '../../src/commands/tree.js';

describe('fmtValue', () => {
  it('quotes strings and compacts objects', () => {
    expect(fmtValue('hi')).toBe('"hi"');
    expect(fmtValue(3)).toBe('3');
    expect(fmtValue(null)).toBe('null');
    expect(fmtValue({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });
});

describe('domLabel', () => {
  it('renders tag, id, class and leaf text', () => {
    expect(domLabel({ tag: 'div', id: 'app' })).toBe('[DIV#app]');
    expect(domLabel({ tag: 'header', class: 'site header' })).toBe('[HEADER.site.header]');
    expect(domLabel({ tag: 'p', text: 'hello' })).toBe('[P] "hello"');
    expect(domLabel(null)).toBe('');
  });
});

describe('renderTreeText', () => {
  const react: TreeProbeData = {
    version: '18+',
    apps: 1,
    truncated: false,
    roots: [
      {
        kind: 'component',
        name: 'App',
        file: 'src/App.tsx',
        dom: { tag: 'div', id: 'app' },
        children: [
          // App's root element — elided, its children rendered one level up
          {
            kind: 'element',
            name: 'div',
            dom: { tag: 'div', id: 'app' },
            children: [
              {
                kind: 'component',
                name: 'Counter',
                file: 'src/components/Counter.tsx',
                props: { count: 3 },
                hooks: { useState: 7 },
                dom: { tag: 'button', id: 'counter' },
                children: [
                  {
                    kind: 'element',
                    name: 'button',
                    dom: { tag: 'button', id: 'counter', text: '6' },
                    children: [{ kind: 'text', name: 'text', children: [] }],
                  },
                ],
              },
            ],
          },
          { kind: 'comment', name: 'comment' },
        ],
      },
    ],
  };

  it('renders the tree with root-element elision and skips comments', () => {
    const out = renderTreeText(react, {}, ['props', 'hooks', 'file', 'dom']);
    expect(out.split('\n')).toEqual([
      '└─ App [DIV#app] (src/App.tsx)',
      '└─ Counter {count: 3} {hooks: useState=7} [BUTTON#counter] (src/components/Counter.tsx)',
    ]);
  });

  it('renders fragments transparently (children at the parent level)', () => {
    const frag: TreeNode = {
      kind: 'component',
      name: 'MultiRoot',
      file: 'src/MultiRoot.tsx',
      children: [
        {
          kind: 'fragment',
          name: 'Fragment',
          children: [
            { kind: 'element', name: 'p', dom: { tag: 'p', id: 'mr-1', text: 'one' } },
            { kind: 'element', name: 'p', dom: { tag: 'p', id: 'mr-2', text: 'two' } },
          ],
        },
      ],
    };
    const out = renderTreeText({ version: '18+', apps: 1, truncated: false, roots: [frag] }, {}, ['file', 'dom']);
    expect(out.split('\n')).toEqual([
      '└─ MultiRoot (src/MultiRoot.tsx)',
      '   ├─ p [P#mr-1] "one"',
      '   └─ p [P#mr-2] "two"',
    ]);
  });

  it('supports --compact (name and DOM only)', () => {
    const out = renderTreeText(react, { compact: true }, ['props', 'hooks', 'file', 'dom']);
    expect(out.split('\n')[0]).toBe('└─ App [DIV#app]');
  });
});
