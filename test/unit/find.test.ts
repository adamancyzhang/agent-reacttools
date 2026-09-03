import { describe, expect, it } from 'vitest';
import { findMatches } from '../../src/commands/find.js';
import type { TreeNode } from '../../src/commands/tree.js';

const tree: TreeNode[] = [
  {
    kind: 'component',
    name: 'App',
    file: 'src/App.tsx',
    children: [
      {
        kind: 'element',
        name: 'div',
        children: [
          {
            kind: 'component',
            name: 'Header',
            file: 'src/components/Header.tsx',
            children: [
              {
                kind: 'element',
                name: 'header',
                children: [
                  { kind: 'component', name: 'NavLink', file: 'src/components/NavLink.tsx' },
                  { kind: 'component', name: 'NavLink', file: 'src/components/NavLink.tsx' },
                ],
              },
            ],
          },
          {
            kind: 'component',
            name: 'Anonymous', // prod build without names
            file: null,
            children: [{ kind: 'element', name: 'main' }],
          },
        ],
      },
    ],
  },
];

describe('findMatches', () => {
  it('matches by exact name, with parent chains', () => {
    const matches = findMatches(tree, 'NavLink');
    expect(matches).toHaveLength(2);
    expect(matches[0]!.path.map((p) => p.name)).toEqual(['App', 'Header', 'NavLink']);
    expect(matches[0]!.file).toBe('src/components/NavLink.tsx');
  });

  it('matches source-file substrings case-insensitively', () => {
    const matches = findMatches(tree, 'components/header');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe('Header');
  });

  it('does not match the file of unrelated components', () => {
    expect(findMatches(tree, 'NavLink.tsx').map((m) => m.name)).toEqual(['NavLink', 'NavLink']);
  });

  it('returns empty array for unknown queries', () => {
    expect(findMatches(tree, 'DoesNotExist')).toEqual([]);
  });
});
