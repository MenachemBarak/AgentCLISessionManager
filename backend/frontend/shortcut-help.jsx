// Keyboard-shortcut help overlay — press '?' (Shift+/) to discover.
// Gmail / GitHub / VSCode / Linear all have this. Without it, every
// shortcut we ship is invisible.

const { useState: useSH, useEffect: useEH } =
  (typeof React !== 'undefined' ? React : {});

// Grouped so users can scan by context. Edit this array when adding a
// new shortcut — it's the single source of truth for the overlay.
const SHORTCUTS = [
  { group: 'Navigation', items: [
    { keys: ['Ctrl', 'K'], desc: 'Jump to session (command palette)' },
    { keys: ['↑', '↓'], desc: 'Move selection in the session list' },
    { keys: ['Enter'], desc: 'Open the highlighted session' },
    { keys: ['/'], desc: 'Focus the search input' },
    { keys: ['Esc'], desc: 'Clear search · close palette / help / find bar' },
    { keys: ['?'], desc: 'Show this help' },
  ]},
  { group: 'Transcript', items: [
    { keys: ['Ctrl', 'F'], desc: 'Find in the current session transcript' },
    { keys: ['Enter'], desc: '(in find bar) next match' },
    { keys: ['Shift', 'Enter'], desc: '(in find bar) previous match' },
    { keys: ['click title'], desc: 'Click session id to copy it · hover a message for a copy button' },
  ]},
  { group: 'Terminals', items: [
    { keys: ['Ctrl', 'Shift', 'T'], desc: 'New terminal tab' },
    { keys: ['Ctrl', 'W'], desc: 'Close active terminal tab' },
    { keys: ['Alt', 'Shift', 'H'], desc: 'Split focused pane horizontally' },
    { keys: ['Alt', 'Shift', 'V'], desc: 'Split focused pane vertically' },
    { keys: ['Alt', 'Shift', 'X'], desc: 'Close focused pane' },
  ]},
  { group: 'Sessions', items: [
    { keys: ['click ☆'], desc: 'Pin session to top · click ★ to unpin' },
    { keys: ['click title'], desc: 'Rename session inline · Enter saves, Esc cancels' },
    { keys: ['↓ .md button'], desc: 'Export session transcript to markdown' },
  ]},
];

function ShortcutHelp({ open, onClose }) {
  useEH(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="shortcut-help-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(3px)',
        zIndex: 2100,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '8vh',
      }}>
      <div
        data-testid="shortcut-help"
        style={{
          width: 'min(720px, 92vw)',
          maxHeight: '84vh', overflowY: 'auto',
          background: 'rgba(22,19,16,0.98)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
          padding: '20px 26px 22px',
        }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 12,
          marginBottom: 16,
        }}>
          <h2 style={{
            margin: 0, fontSize: 15, fontWeight: 600,
            color: 'rgba(255,255,255,0.94)',
          }}>Keyboard shortcuts</h2>
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10.5, color: 'rgba(255,255,255,0.35)',
          }}>press <Key>?</Key> any time to show this</span>
          <span style={{ flex: 1 }}/>
          <button
            onClick={() => onClose?.()}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', padding: '2px 6px', fontSize: 16,
            }}>×</button>
        </div>
        {SHORTCUTS.map((group) => (
          <div key={group.group} style={{ marginBottom: 16 }}>
            <div style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 10, letterSpacing: 0.8,
              color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase', fontWeight: 600,
              marginBottom: 8,
            }}>{group.group}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.items.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  fontSize: 12.5,
                  color: 'rgba(255,255,255,0.84)',
                }}>
                  <div style={{
                    minWidth: 180, display: 'flex', gap: 4, flexWrap: 'wrap',
                  }}>
                    {item.keys.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span style={{ color: 'rgba(255,255,255,0.3)' }}>+</span>}
                        <Key>{k}</Key>
                      </React.Fragment>
                    ))}
                  </div>
                  <div style={{ flex: 1 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Key({ children }) {
  return (
    <kbd style={{
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 10.5, fontWeight: 600,
      padding: '2px 6px',
      background: 'rgba(255,255,255,0.07)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderBottomWidth: 2,
      borderRadius: 4,
      color: 'rgba(255,255,255,0.9)',
    }}>{children}</kbd>
  );
}

window.ShortcutHelp = ShortcutHelp;
