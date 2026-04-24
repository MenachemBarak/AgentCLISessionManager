// Ctrl+K command palette — natural-language jump-to-session (powered
// by the /api/search smart-rank endpoint shipped in v1.2.0/v1.2.1).
//
// Lifecycle:
//   Ctrl+K globally → open (bypasses inputs and xterm to match VSCode).
//   Esc / backdrop click → close.
//   Type a query → debounced 180ms fetch to /api/search → top 20 items.
//   ↑/↓ → navigate.
//   Enter → select (calls onPick then closes).

const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM } =
  (typeof React !== 'undefined' ? React : {});

function PalettePreview({ session }) {
  const msgs = Array.isArray(session.firstUserMessages) ? session.firstUserMessages : [];
  const title = session.userLabel || session.claudeTitle || session.title || '(untitled)';
  const when = session.lastActive
    ? new Date(session.lastActive).toLocaleString()
    : '';
  return (
    <>
      <div style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: 13, fontWeight: 600,
        color: 'rgba(255,255,255,0.94)',
        wordBreak: 'break-word',
      }}>{title}</div>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10.5,
        color: 'rgba(255,255,255,0.4)',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {session.cwd && <span style={{ wordBreak: 'break-all' }}>cwd: {session.cwd}</span>}
        {session.branch && session.branch !== '-' && <span>branch: {session.branch}</span>}
        {when && <span>last active: {when}</span>}
        {typeof session._score === 'number' && <span>score: {session._score.toFixed(2)}</span>}
      </div>
      {msgs.length > 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          marginTop: 4,
          fontFamily: 'Inter, sans-serif',
          fontSize: 12,
          color: 'rgba(255,255,255,0.78)',
          lineHeight: 1.5,
        }}>
          {msgs.slice(0, 3).map((m, i) => (
            <div key={i} style={{
              borderLeft: '2px solid rgba(215, 162, 74, 0.35)',
              paddingLeft: 10,
              wordBreak: 'break-word',
              maxHeight: 120, overflow: 'hidden',
            }}>{m.length > 260 ? m.slice(0, 260) + '…' : m}</div>
          ))}
        </div>
      )}
    </>
  );
}

const RECENT_KEY = 'cm_recent_queries';
const RECENT_MAX = 5;

function loadRecentQueries() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((q) => typeof q === 'string' && q.trim()) : [];
  } catch {
    return [];
  }
}

function pushRecentQuery(q) {
  const clean = (q || '').trim();
  if (!clean) return;
  const current = loadRecentQueries().filter((x) => x !== clean);
  current.unshift(clean);
  const next = current.slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
}

function CommandPalette({ open, onClose, onPick }) {
  const [query, setQuery] = useS('');
  const [items, setItems] = useS([]);
  const [cursor, setCursor] = useS(0);
  const [loading, setLoading] = useS(false);
  const [recents, setRecents] = useS([]);
  const inputRef = useR(null);

  // Reset state on open; autofocus the input; read recent queries so
  // an empty query shows the last 5 picks as one-click shortcuts.
  useE(() => {
    if (!open) return;
    setQuery('');
    setItems([]);
    setCursor(0);
    setRecents(loadRecentQueries());
    // Defer focus to after the modal mounts — WebKit can miss an
    // immediate focus() inside a freshly-painted portal otherwise.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Debounced fetch on query change.
  useE(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setItems([]);
      setCursor(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
        if (cancelled) return;
        if (!r.ok) {
          setItems([]);
          return;
        }
        const body = await r.json();
        setItems(body.items || []);
        setCursor(0);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(h); };
  }, [query, open]);

  // Keyboard handling — bound only while the modal is open.
  useE(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(items.length - 1, c + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const picked = items[cursor];
        if (picked) {
          pushRecentQuery(query);
          onPick?.(picked);
          onClose?.();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);  // capture — precedence over xterm
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, items, cursor, onClose, onPick]);

  if (!open) return null;

  return (
    <div
      data-testid="command-palette-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(3px)',
        zIndex: 2000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}>
      <div
        data-testid="command-palette"
        style={{
          width: 'min(900px, 92vw)',
          background: 'rgba(22,19,16,0.98)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
        <input
          ref={inputRef}
          data-testid="command-palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to session — try 'fix websocket paste bug'"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            padding: '14px 18px',
            color: 'rgba(255,255,255,0.94)',
            fontFamily: 'Inter, -apple-system, sans-serif',
            fontSize: 15,
          }}/>
        <div style={{
          display: 'flex',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          maxHeight: '50vh',
        }}>
          {/* Result list — left column */}
          <div style={{
            flex: '1 1 45%', minWidth: 0,
            overflowY: 'auto',
            borderRight: items.length > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}>
            {/* Empty query + recent picks → render the recents list. One
                click on a recent repopulates the input, which kicks the
                debounced search effect. */}
            {!query.trim() && recents.length > 0 && (
              <div data-testid="palette-recents" style={{ padding: '6px 0' }}>
                <div style={{
                  padding: '4px 18px 4px',
                  fontSize: 9.5, letterSpacing: 0.6,
                  color: 'rgba(255,255,255,0.35)',
                  textTransform: 'uppercase', fontWeight: 600,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>Recent searches</div>
                {recents.map((q, i) => (
                  <button key={q + i}
                    data-testid={`palette-recent-${i}`}
                    onClick={() => { setQuery(q); inputRef.current?.focus(); }}
                    style={{
                      width: '100%', padding: '8px 18px',
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: 'transparent',
                      border: 'none', cursor: 'pointer',
                      color: 'rgba(255,255,255,0.75)',
                      fontFamily: 'inherit', fontSize: 12,
                      textAlign: 'left',
                    }}>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 9.5, color: 'rgba(255,255,255,0.3)',
                      minWidth: 18,
                    }}>↻</span>
                    <span style={{
                      flex: 1, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{q}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim() && items.length === 0 && !loading && (
              <div style={{
                padding: '22px 18px',
                color: 'rgba(255,255,255,0.4)', fontSize: 13,
                textAlign: 'center',
              }}>No matches</div>
            )}
            {items.map((s, i) => (
              <button
                key={s.id}
                data-testid={`palette-item-${s.id.slice(0, 8)}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => { pushRecentQuery(query); onPick?.(s); onClose?.(); }}
                style={{
                  width: '100%', padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: i === cursor ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: 'rgba(255,255,255,0.9)',
                  fontFamily: 'inherit', fontSize: 13,
                  textAlign: 'left',
                }}>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 10, color: 'rgba(255,255,255,0.35)',
                  minWidth: 64,
                }}>{s.id.slice(0, 8)}</span>
                <span style={{
                  flex: 1, minWidth: 0, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{s.userLabel || s.claudeTitle || s.title || '(untitled)'}</span>
                {s.active && (
                  <span style={{
                    fontSize: 10, color: '#4ade80',
                    textTransform: 'uppercase', letterSpacing: 0.6,
                  }}>active</span>
                )}
              </button>
            ))}
          </div>
          {/* Preview pane — right column. Shows first user messages + cwd
              + last-active for the cursor's highlighted row. Only renders
              when there's a highlighted item. */}
          {items.length > 0 && items[cursor] && (
            <div
              data-testid="palette-preview"
              style={{
                flex: '1 1 55%', minWidth: 0,
                overflowY: 'auto',
                padding: '14px 18px',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
              <PalettePreview session={items[cursor]}/>
            </div>
          )}
        </div>
        <div style={{
          padding: '6px 18px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.35)',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10.5,
          display: 'flex', gap: 14,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span style={{ marginLeft: 'auto' }}>{loading ? 'searching…' : items.length ? `${items.length} result${items.length === 1 ? '' : 's'}` : ''}</span>
        </div>
      </div>
    </div>
  );
}

window.CommandPalette = CommandPalette;
