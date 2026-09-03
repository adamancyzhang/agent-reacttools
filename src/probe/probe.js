/**
 * agent-reactools page probe (React 16/17/18/19).
 *
 * Injected into the inspected page via Runtime.evaluate. Self-contained IIFE
 * that evaluates to a function: probe(task) -> JSON string.
 *
 *   task = { command: 'tree' | 'inspect' | 'query' | 'style', depth?, fields?,
 *            detail?: boolean, query?: string, limit?, all? }
 *
 * Always returns a JSON string:
 *   success: {"ok":true,"data":{...}}
 *   failure: {"ok":false,"error":{"code","message","stack"?}}
 *
 * Error codes: no-react | not-found | bad-query | internal
 *
 * How React is found: the runtime marks every rendered DOM node with an
 * expando property whose name contains a random suffix —
 * `__reactContainer$<suffix>` (React 18+ containers, HostRoot fiber),
 * `__reactFiber$<suffix>` (React 17/18/19, the fiber of that DOM node),
 * `__reactInternalInstance$<suffix>` (React 16), and legacy React 16/17
 * containers carry `_reactRootContainer._internalRoot`. The probe walks the
 * fiber tree through `child`/`sibling` pointers — no react-devtools extension
 * is required.
 */
(function () {
  'use strict';

  var MAX_NODES = 5000;
  var MAX_VALUE_DEPTH = 4;
  var MAX_OBJ_KEYS = 30;
  var MAX_ARRAY_ITEMS = 50;
  var TEXT_LIMIT = 80;
  var CLASS_LIMIT = 120;
  var MAX_HOOKS = 100;

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function mkErr(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  // ---- React fiber tags (ReactWorkTags) ---------------------------------------

  var TAG = {
    FunctionComponent: 0,
    ClassComponent: 1,
    IndeterminateComponent: 2,
    HostRoot: 3,
    HostPortal: 4,
    HostComponent: 5,
    HostText: 6,
    Fragment: 7,
    Mode: 8,
    ContextConsumer: 9,
    ContextProvider: 10,
    ForwardRef: 11,
    Profiler: 12,
    SuspenseComponent: 13,
    MemoComponent: 14,
    SimpleMemoComponent: 15,
    LazyComponent: 16,
    IncompleteClassComponent: 17,
    DehydratedFragment: 18,
    SuspenseListComponent: 19,
    ScopeComponent: 21,
    OffscreenComponent: 22,
    LegacyHiddenComponent: 23,
    CacheComponent: 24,
    TracingMarkerComponent: 25,
    HostHoistable: 26,
    HostSingleton: 27,
  };

  /** Tags that render as component nodes (vs host elements/text/fragments). */
  function isComponentTag(tag) {
    switch (tag) {
      case TAG.HostRoot:
      case TAG.HostComponent:
      case TAG.HostText:
      case TAG.Fragment:
      case TAG.Mode:
      case TAG.DehydratedFragment:
      case TAG.HostHoistable:
      case TAG.HostSingleton:
        return false;
      default:
        return true;
    }
  }

  /** Tags whose fiber carries a hooks linked list. */
  function isHooksTag(tag) {
    return (
      tag === TAG.FunctionComponent ||
      tag === TAG.IndeterminateComponent ||
      tag === TAG.ForwardRef ||
      tag === TAG.MemoComponent ||
      tag === TAG.SimpleMemoComponent ||
      tag === TAG.LazyComponent
    );
  }

  // ---- serialization -----------------------------------------------------------

  function isElement(v) {
    return typeof Node !== 'undefined' && v instanceof Node;
  }

  function isFiber(v) {
    return (
      v !== null &&
      typeof v === 'object' &&
      typeof v.tag === 'number' &&
      'return' in v &&
      'stateNode' in v &&
      v.memoizedProps !== undefined
    );
  }

  var SYMBOL_NAMES = {
    'react.fragment': 'Fragment',
    'react.strict_mode': 'StrictMode',
    'react.suspense': 'Suspense',
    'react.suspense_list': 'SuspenseList',
    'react.portal': 'Portal',
    'react.profiler': 'Profiler',
    'react.provider': 'Provider',
    'react.context': 'Context',
    'react.forward_ref': 'ForwardRef',
    'react.memo': 'Memo',
    'react.lazy': 'Lazy',
    'react.offscreen': 'Offscreen',
    'react.activity': 'Activity',
  };

  /** Human name of a React element type (tag string, component, or symbol). */
  function elementName(v) {
    var t = v.type;
    if (typeof t === 'string') return t;
    if (typeof t === 'function') return t.displayName || t.name || 'Component';
    if (typeof t === 'symbol') {
      var d = String(t.description || '');
      return SYMBOL_NAMES[d] || d.replace(/^react\./, '');
    }
    if (t && typeof t === 'object') {
      if (t.displayName) return t.displayName;
      if (t.render) return t.render.displayName || t.render.name || 'Component';
      if (t.type) return t.type.displayName || t.type.name || 'Component';
      return t.name || 'Component';
    }
    return 'Element';
  }

  /**
   * Cycle-safe value serializer producing plain JSON-safe data.
   * `seen` is path-scoped (entries removed on exit), so shared sub-objects
   * serialize twice while true cycles become "[Circular]".
   */
  function serializeValue(v, seen, depth) {
    if (v === undefined) return null;
    if (v === null) return null;
    var t = typeof v;
    if (t === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'bigint') return String(v) + 'n';
    if (t === 'symbol') return 'Symbol(' + (v.description || '') + ')';
    if (t !== 'object') return String(v);

    try {
      // React elements and element-like objects (memo/forwardRef wrappers).
      if (typeof v.$$typeof === 'symbol') return '[<' + elementName(v) + '>]';
    } catch (e) {
      return '[Error: ' + e.message + ']';
    }
    if (isElement(v)) {
      if (v.nodeType === 3) return '#text';
      return '<' + String(v.tagName || 'node').toLowerCase() + '>';
    }
    if (isFiber(v)) return '[Fiber: ' + nodeName(v) + ']';
    if (seen.has(v)) return '[Circular]';
    if (depth <= 0) return '[MaxDepth]';

    seen.add(v);
    try {
      var out;
      if (v instanceof Date) {
        out = v.toISOString();
      } else if (v instanceof Map) {
        out = {};
        var i = 0;
        v.forEach(function (val, key) {
          if (i++ >= MAX_OBJ_KEYS) return;
          out[String(key)] = serializeValue(val, seen, depth - 1);
        });
      } else if (v instanceof Set) {
        out = Array.from(v)
          .slice(0, MAX_ARRAY_ITEMS)
          .map(function (x) {
            return serializeValue(x, seen, depth - 1);
          });
      } else if (Array.isArray(v)) {
        out = v.slice(0, MAX_ARRAY_ITEMS).map(function (x) {
          return serializeValue(x, seen, depth - 1);
        });
        if (v.length > MAX_ARRAY_ITEMS) out.push('... +' + (v.length - MAX_ARRAY_ITEMS) + ' more');
      } else {
        out = {};
        var keys = Object.keys(v);
        keys.slice(0, MAX_OBJ_KEYS).forEach(function (k) {
          var val;
          try {
            val = v[k];
          } catch (e) {
            out[k] = '[Error: ' + e.message + ']';
            return;
          }
          out[k] = serializeValue(val, seen, depth - 1);
        });
        if (keys.length > MAX_OBJ_KEYS) out['...'] = '+' + (keys.length - MAX_OBJ_KEYS) + ' more keys';
      }
      return out;
    } finally {
      seen.delete(v);
    }
  }

  // ---- DOM info -----------------------------------------------------------------

  function domInfo(el) {
    if (!el) return null;
    if (el.nodeType === 3) {
      // Empty text nodes are fragment anchors — treat as "no root element".
      var tv = String(el.nodeValue || '').trim();
      return tv ? { tag: '#text', text: truncate(tv, TEXT_LIMIT) } : null;
    }
    if (el.nodeType === 8) return { tag: '#comment' };
    var node = { tag: String(el.tagName || '').toLowerCase() || String(el.nodeName || '') };
    if (el.id) node.id = String(el.id);
    var cls = String(el.className || ''); // String() guards SVGAnimatedString
    if (cls) node.class = truncate(cls, CLASS_LIMIT);
    if (el.childElementCount === 0) {
      var text = String(el.textContent || '').trim();
      if (text) node.text = truncate(text, TEXT_LIMIT);
    }
    return node;
  }

  // ---- React detection, roots, version ------------------------------------------

  /**
   * Single pass over the DOM collecting the React markers and the elements
   * that carry them. Roots are the HostRoot fibers of every mounted app.
   */
  function discoverRoots() {
    var all = document.querySelectorAll('*');
    var markers = { container: false, fiber: false, internalInstance: false, legacy: false };
    var containerEls = [];
    var legacyEls = [];
    var fiberedEls = [];

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var names = Object.getOwnPropertyNames(el);
      var isContainer = false;
      var isFibered = false;
      for (var j = 0; j < names.length; j++) {
        var k = names[j];
        if (k.indexOf('__reactContainer$') === 0) {
          markers.container = true;
          isContainer = true;
        } else if (k.indexOf('__reactFiber$') === 0) {
          markers.fiber = true;
          isFibered = true;
        } else if (k.indexOf('__reactInternalInstance$') === 0) {
          markers.internalInstance = true;
          isFibered = true;
        }
      }
      if (el._reactRootContainer) markers.legacy = true;
      if (isContainer) containerEls.push(el);
      else if (el._reactRootContainer) legacyEls.push(el);
      else if (isFibered) fiberedEls.push(el);
    }

    /**
     * Normalize a HostRoot fiber to the current committed tree. Container
     * markers (`__reactContainer$`) point at the fiber object created at
     * mount time; after commits the live tree may live in its alternate.
     * The FiberRootNode (`stateNode.current`) always points at the current
     * HostRoot — use that as the authority.
     */
    function canonicalRoot(f) {
      try {
        var fr = f.stateNode;
        if (fr && fr.current && fr.current.tag === TAG.HostRoot) return fr.current;
      } catch (e) {
        /* fiber internals not readable */
      }
      return f;
    }

    var roots = new Set();

    // React 18+ createRoot: the container element points at the HostRoot fiber.
    for (i = 0; i < containerEls.length; i++) {
      var el2 = containerEls[i];
      var names2 = Object.getOwnPropertyNames(el2);
      for (j = 0; j < names2.length; j++) {
        var k2 = names2[j];
        if (k2.indexOf('__reactContainer$') === 0) {
          var f = el2[k2];
          if (f && f.tag === TAG.HostRoot) roots.add(canonicalRoot(f));
        }
      }
    }

    // Legacy React 16/17 render: `_reactRootContainer._internalRoot.current`.
    for (i = 0; i < legacyEls.length; i++) {
      try {
        var internal = legacyEls[i]._reactRootContainer._internalRoot;
        var rf = internal && internal.current;
        if (rf && rf.tag === TAG.HostRoot) roots.add(canonicalRoot(rf));
      } catch (e) {
        /* malformed legacy root — skip */
      }
    }

    // Fallback: walk `return` pointers up from any fibered DOM node.
    if (!roots.size) {
      for (i = 0; i < fiberedEls.length; i++) {
        var el3 = fiberedEls[i];
        var names3 = Object.getOwnPropertyNames(el3);
        for (j = 0; j < names3.length; j++) {
          var k3 = names3[j];
          if (k3.indexOf('__reactFiber$') === 0 || k3.indexOf('__reactInternalInstance$') === 0) {
            var g = el3[k3];
            var guard = 0;
            while (g && g.return && guard++ < 1000) g = g.return;
            if (g && g.tag === TAG.HostRoot) roots.add(canonicalRoot(g));
          }
        }
      }
    }

    return { roots: Array.from(roots), markers: markers };
  }

  /**
   * Best-effort React version. The React runtime does not expose its version
   * on the page (no UMD global in ESM apps, no field on the fiber), so fall
   * back to the DOM markers each major introduced:
   *   __reactContainer$ (18+) > __reactFiber$ (17) > __reactInternalInstance$ (16).
   * Exact versions are reported only for UMD builds (window.React.version).
   */
  function versionOf(markers) {
    try {
      if (typeof window !== 'undefined' && window.React && typeof window.React.version === 'string') {
        return window.React.version;
      }
    } catch (e) {
      /* window.React inaccessible */
    }
    if (markers.container) return '18+';
    if (markers.fiber) return '17';
    if (markers.internalInstance || markers.legacy) return '16';
    return null;
  }

  // ---- component introspection ---------------------------------------------------

  function componentName(fiber) {
    var type = fiber.elementType || fiber.type;
    if (!type) return 'Anonymous';
    if (typeof type === 'string') return type;
    if (typeof type === 'function') {
      if (typeof type.displayName === 'string' && type.displayName) return type.displayName;
      if (typeof type.name === 'string' && type.name) return type.name;
      return 'Anonymous';
    }
    if (typeof type === 'object' && type !== null) {
      // memo / forwardRef objects
      if (typeof type.displayName === 'string' && type.displayName) return type.displayName;
      if (type.render) {
        var rn = type.render.displayName || type.render.name;
        if (rn) return rn;
      }
      if (type.type && typeof type.type === 'function') {
        var tn = type.type.displayName || type.type.name;
        if (tn) return tn;
      }
    }
    return 'Anonymous';
  }

  function contextLabel(fiber) {
    try {
      var ctx = fiber.type && fiber.type._context;
      var n = ctx && (ctx.displayName || ctx.name);
      return n || 'Context';
    } catch (e) {
      return 'Context';
    }
  }

  /** Display name of any fiber node. */
  function nodeName(fiber) {
    switch (fiber.tag) {
      case TAG.Mode:
        return 'StrictMode';
      case TAG.SuspenseComponent:
        return 'Suspense';
      case TAG.SuspenseListComponent:
        return 'SuspenseList';
      case TAG.OffscreenComponent:
        return 'Offscreen';
      case TAG.HostPortal:
        return 'Portal';
      case TAG.Profiler:
        return 'Profiler';
      case TAG.ContextProvider:
        return contextLabel(fiber) + '.Provider';
      case TAG.ContextConsumer:
        return contextLabel(fiber) + '.Consumer';
      case TAG.LazyComponent: {
        var t = fiber.elementType || fiber.type;
        var n = t && (t.displayName || t.name);
        return n || 'Lazy';
      }
      default:
        return componentName(fiber);
    }
  }

  /** Dev builds record the defining source location on `_debugSource`. */
  function sourceFile(fiber) {
    try {
      var s = fiber._debugSource;
      if (s && typeof s.fileName === 'string' && s.fileName) return s.fileName;
    } catch (e) {
      /* not a dev build */
    }
    return null;
  }

  /**
   * Serialized props of a fiber. `children` (React elements/fibers) is
   * stripped unless keepChildren — it duplicates the subtree and is noise in
   * tree output.
   */
  function cleanProps(p, state, keepChildren) {
    if (!p || typeof p !== 'object') return undefined;
    var out = {};
    var keys = Object.keys(p);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === 'children' && !keepChildren) continue;
      out[k] = serializeValue(p[k], state.seen, MAX_VALUE_DEPTH);
    }
    return Object.keys(out).length ? out : undefined;
  }

  function defaultPropsOf(fiber) {
    try {
      var t = fiber.type;
      var target = null;
      if (typeof t === 'function') target = t;
      else if (t && typeof t === 'object' && t.type && typeof t.type === 'function') target = t.type; // memo
      if (target && typeof target.defaultProps === 'object' && target.defaultProps) {
        return target.defaultProps;
      }
    } catch (e) {
      /* no defaultProps */
    }
    return null;
  }

  /**
   * Extract one hook's value.
   * - named hooks (dev builds, `_debugHookTypes`): unwrap useReducer to its
   *   state and useRef to its current value; effect hooks become markers.
   * - unnamed hooks (production builds): infer the few unambiguous shapes
   *   ([state, dispatch] → useReducer; {create, deps} → effect).
   */
  function hookValue(hook, name, state) {
    var v = hook.memoizedState;
    try {
      if (name === 'useReducer' && Array.isArray(v)) {
        return serializeValue(v[0], state.seen, MAX_VALUE_DEPTH);
      }
      if ((name === 'useMemo' || name === 'useCallback') && Array.isArray(v)) {
        // memoizedState = [memoizedValue, deps]
        return serializeValue(v[0], state.seen, MAX_VALUE_DEPTH);
      }
      if (name === 'useRef' && v && typeof v === 'object' && 'current' in v) {
        return serializeValue(v.current, state.seen, MAX_VALUE_DEPTH);
      }
      if (
        name === 'useEffect' ||
        name === 'useLayoutEffect' ||
        name === 'useInsertionEffect' ||
        name === 'useImperativeHandle' ||
        name === 'useDebugValue'
      ) {
        return '[Effect]';
      }
      if (!name) {
        if (Array.isArray(v) && v.length === 2 && typeof v[1] === 'function') {
          return serializeValue(v[0], state.seen, MAX_VALUE_DEPTH); // likely useReducer
        }
        if (v && typeof v === 'object' && typeof v.create === 'function' && Array.isArray(v.deps)) {
          return '[Effect]';
        }
      }
      return serializeValue(v, state.seen, MAX_VALUE_DEPTH);
    } catch (e) {
      return '[Error: ' + e.message + ']';
    }
  }

  /**
   * Walk a function component's hooks linked list (memoizedState).
   * Keys are hook type names from `_debugHookTypes` (dev builds; duplicates
   * suffixed "(1)", "(2)"…), or `h0..hN` in production builds where hook
   * names do not exist. useMemo/useCallback values are collected into a
   * separate group.
   *
   * useContext does not create a hook node — its value lives on the fiber's
   * `dependencies` list instead. Dev builds list it in `_debugHookTypes`, so
   * its value is spliced in at the right position from that list. Production
   * builds lose useContext entirely (the dependencies list has no stable
   * order relative to the hook list) — same limit as react-devtools.
   */
  function hooksInfo(fiber, state) {
    var hook = fiber.memoizedState;
    var types = fiber._debugHookTypes || null;
    if (!hook && !(types && fiber.dependencies)) return { hooks: undefined, memo: undefined };
    var dep = fiber.dependencies && fiber.dependencies.firstContext;
    var hooksOut = {};
    var memoOut = {};
    var counts = {};
    var i = 0;
    var guard = 0;
    while (guard++ < MAX_HOOKS) {
      var name = types && i < types.length && types[i] ? types[i] : null;
      if (name === 'useContext') {
        hooksOut[nextKey(name, counts, i)] = dep
          ? serializeValue(dep.memoizedValue, state.seen, MAX_VALUE_DEPTH)
          : null;
        if (dep) dep = dep.next;
        i++;
        continue;
      }
      if (!hook) break;
      var key = nextKey(name, counts, i);
      var value = hookValue(hook, name, state);
      hooksOut[key] = value;
      if (name === 'useMemo' || name === 'useCallback') memoOut[key] = value;
      i++;
      hook = hook.next;
    }
    return {
      hooks: Object.keys(hooksOut).length ? hooksOut : undefined,
      memo: Object.keys(memoOut).length ? memoOut : undefined,
    };
  }

  /** Hook key: type name with "(n)" dedup suffix, or "h<n>" when unnamed. */
  function nextKey(name, counts, i) {
    var key;
    if (name) {
      key = name;
      if (counts[name]) key = name + ' (' + counts[name] + ')';
      counts[name] = (counts[name] || 0) + 1;
    } else {
      key = 'h' + i;
    }
    return key;
  }

  /**
   * Fill the state fields of a component node from its fiber. Tree mode
   * serializes flat props; inspect mode (state.detail) adds defaultProps
   * definitions and keeps `children`.
   */
  function componentFields(fiber, state, cnode) {
    var fields = state.fields; // null = all fields
    function want(f) {
      return fields === null || fields.indexOf(f) !== -1;
    }

    if (want('props')) {
      if (state.detail) {
        var props = {};
        var defs = defaultPropsOf(fiber);
        if (defs) props.defs = { defaultProps: serializeValue(defs, state.seen, 3) };
        props.values = cleanProps(fiber.memoizedProps, state, true);
        cnode.props = props;
      } else {
        var flat = cleanProps(fiber.memoizedProps, state, false);
        if (flat) cnode.props = flat;
      }
    }
    if (isHooksTag(fiber.tag) && (want('hooks') || want('memo'))) {
      var h = hooksInfo(fiber, state);
      if (want('hooks') && h.hooks) cnode.hooks = h.hooks;
      if (want('memo') && h.memo) cnode.memo = h.memo;
    }
    if ((fiber.tag === TAG.ClassComponent || fiber.tag === TAG.IncompleteClassComponent) && want('state')) {
      try {
        var sn = fiber.stateNode;
        if (sn && sn.state && typeof sn.state === 'object') {
          cnode.state = serializeValue(sn.state, state.seen, MAX_VALUE_DEPTH);
        }
      } catch (e) {
        /* instance not readable */
      }
    }
    if (fiber.tag === TAG.ContextProvider && want('context')) {
      cnode.context = serializeValue(fiber.memoizedProps && fiber.memoizedProps.value, state.seen, MAX_VALUE_DEPTH);
    }
  }

  // ---- tree walking ---------------------------------------------------------------

  /**
   * The DOM node a component renders into: the first host fiber in its
   * rendered subtree (depth-first), descending through fragments and wrapper
   * fibers — the same element React DevTools highlights. Survives empty
   * render branches (a `child` chain that ends in null) by visiting
   * siblings. Text-only components get a text-node bracket; components
   * rendering nothing at all get null.
   */
  function componentDom(fiber) {
    var stack = [fiber.child];
    var guard = 0;
    while (stack.length && guard++ < 500) {
      var f = stack.pop();
      if (!f) continue;
      if (f.tag === TAG.HostComponent || f.tag === TAG.HostHoistable || f.tag === TAG.HostSingleton) {
        return domInfo(f.stateNode);
      }
      if (f.tag === TAG.HostText) return domInfo(f.stateNode);
      stack.push(f.sibling);
      stack.push(f.child);
    }
    return null;
  }

  function fiberChildren(fiber, depth, state) {
    var out = [];
    var c = fiber.child;
    while (c) {
      if (state.nodes >= MAX_NODES || depth + 1 > state.maxDepth) {
        state.truncated = true;
        break;
      }
      var n = walkFiber(c, depth + 1, state);
      if (n) out.push(n);
      c = c.sibling;
    }
    return out;
  }

  function walkFiber(fiber, depth, state) {
    if (!fiber) return null;
    if (state.nodes >= MAX_NODES || depth > state.maxDepth) {
      state.truncated = true;
      return null;
    }
    state.nodes++;

    switch (fiber.tag) {
      case TAG.HostText: {
        return { kind: 'text', text: truncate(String(fiber.memoizedProps), TEXT_LIMIT) };
      }
      case TAG.HostComponent:
      case TAG.HostHoistable:
      case TAG.HostSingleton: {
        var el = fiber.stateNode;
        var node = {
          kind: 'element',
          name: el ? String(el.tagName || el.nodeName || '').toLowerCase() : String(fiber.type),
          dom: domInfo(el),
        };
        var p = cleanProps(fiber.memoizedProps, state, false);
        if (p) node.props = p;
        var kids = fiberChildren(fiber, depth, state);
        if (kids.length) node.children = kids;
        return node;
      }
      case TAG.Fragment: {
        var frag = { kind: 'fragment', name: 'Fragment' };
        var fk = fiberChildren(fiber, depth, state);
        if (fk.length) frag.children = fk;
        return frag;
      }
      case TAG.HostRoot: {
        // HostRoot fibers are handled at the root level; this is a safety net.
        var rk = fiberChildren(fiber, depth, state);
        var rn = { kind: 'fragment', name: 'HostRoot' };
        if (rk.length) rn.children = rk;
        return rn;
      }
      default: {
        var name = nodeName(fiber);
        if (state.seenFibers.has(fiber)) {
          state.truncated = true;
          return { kind: 'component', name: name, duplicate: true };
        }
        state.seenFibers.add(fiber);
        var cnode = { kind: 'component', name: name, file: sourceFile(fiber) };
        componentFields(fiber, state, cnode);
        cnode.dom = componentDom(fiber);
        var ck = fiberChildren(fiber, depth, state);
        if (ck.length) cnode.children = ck;
        return cnode;
      }
    }
  }

  /**
   * Top-level nodes of one app: the children of its HostRoot fiber.
   * Walked at depth -1 so the root component lands at depth 0 together with
   * its own children — the same depth semantics as the Vue probe.
   */
  function buildRoots(rootFiber, state) {
    var out = [];
    var c = rootFiber.child;
    while (c) {
      if (state.nodes >= MAX_NODES) {
        state.truncated = true;
        break;
      }
      var n = walkFiber(c, -1, state);
      if (n) out.push(n);
      c = c.sibling;
    }
    return out;
  }

  // ---- DOM queries (XPath / CSS) ----------------------------------------------------

  /** Wrap a string as an XPath literal (XPath 1.0 has no escape mechanism). */
  function xpathStr(s) {
    if (s.indexOf("'") === -1) return "'" + s + "'";
    if (s.indexOf('"') === -1) return '"' + s + '"';
    return "concat('" + s.split('"').join("','\"','") + "')";
  }

  /** XPath expressions start with / or ./, or use an axis (contains '::'). */
  function looksLikeXpath(q) {
    return /^\s*(?:\/\/?|\(\s*\/|\.\/)/.test(q) || /::/.test(q);
  }

  /** Evaluate an XPath expression, returning element matches. */
  function evalXpath(xpath, limit) {
    var result;
    try {
      result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    } catch (e) {
      throw mkErr('bad-query', 'Invalid XPath: ' + e.message);
    }
    var elements = [];
    var total = 0;
    var n = Math.min(result.snapshotLength, limit);
    for (var i = 0; i < n; i++) {
      var item = result.snapshotItem(i);
      if (item && item.nodeType === 1) elements.push(item);
      total++;
    }
    return { elements: elements, total: total, truncated: result.snapshotLength > n };
  }

  /** Evaluate a CSS selector, returning element matches. */
  function cssElements(q, limit) {
    var all;
    try {
      all = document.querySelectorAll(q);
    } catch (e) {
      throw mkErr('bad-query', 'Invalid CSS selector: ' + e.message);
    }
    var elements = Array.prototype.slice.call(all, 0, limit);
    return { elements: elements, total: all.length, truncated: all.length > elements.length };
  }

  /** The fiber React attached to a DOM node, if any. */
  function fiberOf(el) {
    if (!el) return null;
    var names = Object.getOwnPropertyNames(el);
    for (var i = 0; i < names.length; i++) {
      var k = names[i];
      if (k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0) {
        return el[k];
      }
    }
    return null;
  }

  /**
   * The nearest component fiber owning a DOM element: walk up from the
   * element's own fiber through its `return` chain until a component tag.
   */
  function owningFiber(el) {
    var cur = el;
    while (cur) {
      var f = fiberOf(cur);
      if (f) {
        var g = f;
        var guard = 0;
        while (g && g.tag !== TAG.HostRoot && guard++ < 100) {
          if (isComponentTag(g.tag)) return g;
          g = g.return;
        }
        return null;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /** Resolve elements to owning component fibers (deduped, capped). */
  function instancesOf(elements, cap) {
    var instances = [];
    var seen = new Set();
    for (var i = 0; i < elements.length && instances.length < cap; i++) {
      var f = owningFiber(elements[i]);
      if (f && !seen.has(f)) {
        seen.add(f);
        instances.push(f);
      }
    }
    return instances;
  }

  function owningComponent(el) {
    var f = owningFiber(el);
    if (!f) return null;
    return { name: componentName(f), file: sourceFile(f) };
  }

  /**
   * Find components owning elements whose visible text matches the query.
   * First tries direct text nodes (XPath text()[contains(., q)]); React
   * splits interpolated text into sibling text nodes, so an element's full
   * text rarely lives in one node — fall back to the element's complete
   * text content (string(.) joins all descendant text).
   */
  function findByText(query) {
    var q = String(query).trim();
    if (!q) return [];
    var direct = evalXpath('//*[text()[contains(., ' + xpathStr(q) + ')]]', 50);
    if (direct.elements.length) return direct.elements;
    var all = evalXpath('//*[contains(normalize-space(string(.)), ' + xpathStr(q) + ')]', 200);
    // Keep only the deepest matches: drop elements that contain a matching
    // child element — otherwise the target's ancestors surface their own
    // (ancestor) components instead.
    var set = new Set(all.elements);
    return all.elements
      .filter(function (el) {
        for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
          if (set.has(c)) return false;
        }
        return true;
      })
      .slice(0, 50);
  }

  /** Collect matches of a DOM query (XPath or CSS) with their components. */
  function queryMatches(query, limit) {
    var q = String(query || '').trim();
    if (!q) throw mkErr('bad-query', 'query requires a non-empty expression.');
    var res;
    if (looksLikeXpath(q)) {
      res = evalXpath(q, limit);
    } else {
      try {
        res = cssElements(q, limit);
      } catch (cssErr) {
        try {
          res = evalXpath(q, limit);
        } catch (e) {
          throw mkErr('bad-query', cssErr.message + ' (not valid XPath either: ' + e.message + ')');
        }
      }
    }
    return {
      query: q,
      total: res.total,
      truncated: res.truncated,
      matches: res.elements.map(function (el) {
        var comp = owningComponent(el);
        return {
          dom: domInfo(el),
          component: comp
            ? { name: comp.name, file: comp.file || null }
            : null,
        };
      }),
    };
  }

  // ---- style -------------------------------------------------------------------------

  /** Common layout/typography/color properties (computed style defaults). */
  var STYLE_KEYS = [
    'display', 'visibility', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'box-sizing',
    'margin', 'padding', 'border', 'border-radius', 'overflow', 'overflow-x', 'overflow-y',
    'color', 'background-color', 'background-image', 'font-size', 'font-weight', 'line-height',
    'text-align', 'white-space', 'flex', 'flex-direction', 'align-items', 'justify-content',
    'gap', 'grid-template-columns', 'cursor', 'opacity', 'transform', 'transition', 'box-shadow',
  ];

  function styleOf(el, all) {
    var cs = getComputedStyle(el);
    var keys = all ? Array.prototype.slice.call(cs) : STYLE_KEYS;
    var style = {};
    keys.forEach(function (k) {
      var v = cs.getPropertyValue(k);
      if (v) style[k] = v;
    });
    var text = String(el.textContent || '').trim();
    return {
      // Explicit, untruncated identity fields — the class attribute is the
      // primary hook for style debugging.
      tag: String(el.tagName || '').toLowerCase(),
      id: el.id || null,
      class: el.getAttribute('class') || null,
      text: text || null,
      dom: domInfo(el),
      inline: el.getAttribute('style') || null,
      style: style,
    };
  }

  // ---- inspect -------------------------------------------------------------------------

  /** Breadth-first walk over every fiber of every root, cb = component fibers. */
  function walkAllComponents(rootFibers, cb, state) {
    var queue = [];
    var seen = new Set();
    rootFibers.forEach(function (r) {
      queue.push(r);
    });
    while (queue.length && state.nodes < MAX_NODES) {
      var f = queue.shift();
      if (!f || typeof f !== 'object') continue;
      state.nodes++;
      if (f.tag === TAG.HostRoot) {
        var rc = f.child;
        while (rc) {
          queue.push(rc);
          rc = rc.sibling;
        }
        continue;
      }
      if (isComponentTag(f.tag) && !seen.has(f)) {
        seen.add(f);
        cb(f);
      }
      var c = f.child;
      while (c) {
        queue.push(c);
        c = c.sibling;
      }
    }
  }

  function parentChain(fiber) {
    var chain = [];
    var p = fiber.return;
    var guard = 0;
    while (p && p.tag !== TAG.HostRoot && guard++ < 100) {
      if (isComponentTag(p.tag)) {
        chain.unshift({ name: nodeName(p), file: sourceFile(p) });
      }
      p = p.return;
    }
    return chain;
  }

  function instanceInfo(fiber, state) {
    var info = { name: nodeName(fiber), file: sourceFile(fiber) };
    componentFields(fiber, state, info);
    info.parentChain = parentChain(fiber);
    info.dom = componentDom(fiber);
    return info;
  }

  function inspectMatches(rootFibers, query, state) {
    var matches = [];
    walkAllComponents(rootFibers, function (fiber) {
      var name = nodeName(fiber);
      var file = sourceFile(fiber) || '';
      if (name === query || file.toLowerCase().indexOf(String(query).toLowerCase()) !== -1) {
        matches.push(fiber);
      }
    }, state);

    if (!matches.length) {
      // DOM level: CSS selector → XPath → visible-text (via XPath internally).
      var elements = [];
      if (looksLikeXpath(query)) {
        try {
          elements = evalXpath(query, 5).elements;
        } catch (e) {
          throw mkErr('bad-query', e.message);
        }
      } else {
        var cssEl = null;
        try {
          cssEl = document.querySelector(query);
        } catch (e) {
          /* not a CSS selector */
        }
        if (cssEl) {
          elements = [cssEl];
        } else {
          try {
            elements = evalXpath(query, 5).elements;
          } catch (e) {
            /* not XPath either */
          }
        }
      }
      matches = matches.concat(instancesOf(elements, 5));
    }
    if (!matches.length) {
      matches = matches.concat(instancesOf(findByText(query), 5));
    }

    if (!matches.length) {
      throw mkErr('not-found', 'No component matches query "' + query + '".');
    }

    return {
      query: query,
      instances: matches.map(function (fiber) {
        return instanceInfo(fiber, state);
      }),
    };
  }

  // ---- entry -----------------------------------------------------------------------------

  return function probe(task) {
    try {
      var state = {
        nodes: 0,
        maxDepth: Math.max(
          task && task.depth !== undefined && task.depth !== null ? Number(task.depth) : 8,
          1,
        ),
        fields: task && Array.isArray(task.fields) ? task.fields : null,
        detail: !!(task && task.detail),
        seen: new Set(),
        seenFibers: new Set(),
        truncated: false,
      };
      // tree/inspect need a React app; query/style are pure DOM tools and work
      // on any page.
      var isReactTask = task && (task.command === 'tree' || task.command === 'inspect');
      var discovered = null;
      if (isReactTask) {
        discovered = discoverRoots();
        if (!discovered.roots.length) {
          throw mkErr('no-react', 'No React app detected on this page (it may still be loading — retry in a moment).');
        }
      }

      var data;
      if (task && task.command === 'tree') {
        var roots = [];
        for (var i = 0; i < discovered.roots.length; i++) {
          Array.prototype.push.apply(roots, buildRoots(discovered.roots[i], state));
        }
        data = {
          version: versionOf(discovered.markers),
          apps: discovered.roots.length,
          truncated: state.truncated,
          roots: roots,
        };
      } else if (task && task.command === 'inspect') {
        data = inspectMatches(discovered.roots, task.query, state);
      } else if (task && task.command === 'query') {
        data = queryMatches(task.query, task.limit ? Number(task.limit) : 50);
      } else if (task && task.command === 'style') {
        var el = null;
        if (looksLikeXpath(task.query)) {
          el = evalXpath(task.query, 1).elements[0] || null;
        } else {
          try {
            el = document.querySelector(task.query);
          } catch (e) {
            el = evalXpath(task.query, 1).elements[0] || null;
          }
        }
        if (!el) throw mkErr('not-found', 'No element matches "' + task.query + '".');
        data = styleOf(el, task.all === true);
      } else {
        throw mkErr('internal', 'Unknown task command: ' + (task && task.command));
      }
      return JSON.stringify({ ok: true, data: data });
    } catch (e) {
      var error = { code: (e && e.code) || 'internal', message: String((e && e.message) || e) };
      if (e && e.stack) error.stack = e.stack;
      return JSON.stringify({ ok: false, error: error });
    }
  };
})()
// No trailing semicolon: the CLI wraps this source in parentheses to call it,
// so a ';' here would be a SyntaxError inside the wrapped expression.
