// Tile-tree layout for terminal tabs. Each tab's body is a recursive
// tree of {kind:'pane'|'split', ...}. `<TileTree>` renders it, with a
// draggable divider between every split child pair.
//
// Shape:
//   leaf:   { kind:'pane',  id:'pane-N', spawn:{cmd:['cmd.exe']} }
//   branch: { kind:'split', dir:'h'|'v', ratio:0..1, children:[node,node] }
//
//   `dir='h'` → children stacked left/right (horizontal split).
//   `dir='v'` → children stacked top/bottom (vertical split).
//
// Pure tree operations live as plain functions so they're trivially
// testable and free of React surprises.

// ─────────────────────── pure ops ───────────────────────

let _paneSeq = 0;
function newPaneId() { _paneSeq += 1; return `pane-${_paneSeq}`; }

function makePane(spawn) {
  return { kind: 'pane', id: newPaneId(), spawn: spawn || { cmd: ['cmd.exe'] } };
}

// Returns a new tree in which `targetId` is replaced by a split between
// the original pane and a new pane. `dir` is 'h' (new pane to the right)
// or 'v' (new pane below). Returns { tree, newPaneId } so callers can
// focus the fresh pane. If `targetId` isn't found, returns the tree
// unchanged and newPaneId=null.
function splitNode(tree, targetId, dir) {
  let newId = null;
  function walk(node) {
    if (node.kind === 'pane' && node.id === targetId) {
      const fresh = makePane();
      newId = fresh.id;
      return {
        kind: 'split', dir, ratio: 0.5,
        children: [node, fresh],
      };
    }
    if (node.kind === 'split') {
      return { ...node, children: node.children.map(walk) };
    }
    return node;
  }
  const tree2 = walk(tree);
  return { tree: tree2, newPaneId: newId };
}

// Drop the pane matched by `targetId`. If its sibling survives alone,
// collapse the parent split so the sibling takes its place. Returns
// { tree, nextFocusId } where nextFocusId is the sibling pane's id
// (for re-focus) or null if the pane wasn't found / was the last one.
function closeNode(tree, targetId) {
  let nextFocusId = null;
  // Root-level pane match — caller handles (empty tab).
  if (tree.kind === 'pane' && tree.id === targetId) {
    return { tree: null, nextFocusId: null };
  }
  function firstPaneId(node) {
    if (node.kind === 'pane') return node.id;
    for (const c of node.children) {
      const id = firstPaneId(c);
      if (id) return id;
    }
    return null;
  }
  function walk(node) {
    if (node.kind !== 'split') return node;
    // Is one of our immediate children the target?
    const idx = node.children.findIndex(
      (c) => c.kind === 'pane' && c.id === targetId
    );
    if (idx >= 0) {
      const sibling = node.children[1 - idx];
      nextFocusId = firstPaneId(sibling);
      return sibling;
    }
    return { ...node, children: node.children.map(walk) };
  }
  return { tree: walk(tree), nextFocusId };
}

function setRatio(tree, splitPath, ratio) {
  // splitPath is an array of child indices from the root to the split
  // whose ratio we want to update. We do this via index-path so
  // divider-drag handlers don't need React refs or DOM lookups.
  function walk(node, depth) {
    if (depth === splitPath.length) {
      return { ...node, ratio: Math.max(0.05, Math.min(0.95, ratio)) };
    }
    if (node.kind !== 'split') return node;
    const idx = splitPath[depth];
    return {
      ...node,
      children: node.children.map(
        (c, i) => (i === idx ? walk(c, depth + 1) : c)
      ),
    };
  }
  return walk(tree, 0);
}

// Flatten all panes to a list so the container can keep every
// TerminalPane mounted even when it's not visible (a pane on a
// non-active tab gets display:none, not unmount).
function collectPanes(tree) {
  const out = [];
  function walk(node) {
    if (!node) return;
    if (node.kind === 'pane') out.push(node);
    else node.children.forEach(walk);
  }
  walk(tree);
  return out;
}

// ─────────────────────── React component ───────────────────────

// Renders a tile tree. `renderLeaf(node)` is called to render each pane
// — we keep rendering independent of what's inside so the split logic
// stays reusable.
function TileTree({ tree, focusedId, onFocus, onUpdateTree, pathPrefix }) {
  // pathPrefix: index path to this node (used by the drag handler to
  // target the right split when calling setRatio).
  pathPrefix = pathPrefix || [];

  if (!tree) return null;

  // Defensive migration — an older state file may persist `kind:"leaf"`
  // (a probe wrote that once) or an unknown kind. Treat anything that's
  // clearly not a split as a pane so the whole UI doesn't black-screen.
  if (tree.kind !== 'pane' && tree.kind !== 'split') {
    // eslint-disable-next-line no-console
    console.warn('TileTree: unknown node kind', tree.kind, '— treating as pane');
    tree = { kind: 'pane', id: tree.id || 'pane-recovered', spawn: tree.spawn || { cmd: ['cmd.exe'] } };
  }
  // A split without a 2-element children array can't render — fall back
  // to a fresh pane rather than crash on tree.children[0].
  if (tree.kind === 'split' && (!Array.isArray(tree.children) || tree.children.length < 2)) {
    // eslint-disable-next-line no-console
    console.warn('TileTree: split without 2 children, falling back to pane');
    tree = { kind: 'pane', id: 'pane-recovered', spawn: { cmd: ['cmd.exe'] } };
  }

  if (tree.kind === 'pane') {
    return (
      <div
        onMouseDown={() => onFocus(tree.id)}
        style={{
          flex: 1, minWidth: 0, minHeight: 0,
          border: focusedId === tree.id
            ? '1px solid rgba(215,162,74,0.55)'
            : '1px solid rgba(255,255,255,0.04)',
          borderRadius: 4, overflow: 'hidden', position: 'relative',
        }}
        data-testid={`tile-pane-${tree.id}`}
      >
        <TerminalPane spawn={tree.spawn}/>
      </div>
    );
  }

  // split
  const horiz = tree.dir === 'h';
  const flexDirection = horiz ? 'row' : 'column';
  const leftPct = Math.round(tree.ratio * 100);
  const rightPct = 100 - leftPct;

  function onDragStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    function onMove(me) {
      const delta = horiz ? (me.clientX - startX) : (me.clientY - startY);
      const total = horiz ? rect.width : rect.height;
      const nextRatio = tree.ratio + delta / total;
      onUpdateTree((root) => setRatio(root, pathPrefix, nextRatio));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection, minWidth: 0, minHeight: 0 }}>
      <div style={{ flex: `${leftPct} 0 0`, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <TileTree tree={tree.children[0]} focusedId={focusedId}
          onFocus={onFocus} onUpdateTree={onUpdateTree}
          pathPrefix={[...pathPrefix, 0]}/>
      </div>
      <div
        onMouseDown={onDragStart}
        data-testid={`tile-divider-${pathPrefix.join('-') || 'root'}-${tree.dir}`}
        style={{
          flex: '0 0 4px',
          cursor: horiz ? 'col-resize' : 'row-resize',
          background: 'transparent',
          alignSelf: 'stretch',
        }}
      />
      <div style={{ flex: `${rightPct} 0 0`, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <TileTree tree={tree.children[1]} focusedId={focusedId}
          onFocus={onFocus} onUpdateTree={onUpdateTree}
          pathPrefix={[...pathPrefix, 1]}/>
      </div>
    </div>
  );
}

// Exports — consumed from app.jsx. All helpers on `window.splits` to
// avoid polluting the global namespace further.
window.splits = {
  makePane,
  splitNode,
  closeNode,
  setRatio,
  collectPanes,
};
window.TileTree = TileTree;
