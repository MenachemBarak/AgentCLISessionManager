// ActiveStrip — top panel showing currently-active sessions with live pulse

const { useState, useEffect, useMemo, useRef } = React;

function PulseDot({ color = '#d7a24a' }) {
  return (
    <span style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: color, boxShadow: `0 0 8px ${color}`,
      }}/>
      <span className="pulse-ring" style={{
        position: 'absolute', inset: -2, borderRadius: '50%',
        border: `1.5px solid ${color}`,
      }}/>
    </span>
  );
}

function ActiveCard({ session, accent, onOpen, onHover, onLeave }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={(e) => { setHover(true); onHover?.(session, e.currentTarget); }}
      onMouseLeave={() => { setHover(false); onLeave?.(); }}
      style={{
        minWidth: 280, flexShrink: 0,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
        cursor: 'default', position: 'relative',
        transition: 'background 120ms, border-color 120ms',
        ...(hover ? {
          background: 'rgba(255,255,255,0.055)',
          borderColor: 'rgba(255,255,255,0.14)',
        } : {}),
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <PulseDot color={accent}/>
        <span style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10.5, color: accent, textTransform: 'uppercase', letterSpacing: 0.6,
          fontWeight: 600,
        }}>{session.activityLabel}</span>
        <span style={{ flex: 1 }}/>
        <span style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10.5, color: 'rgba(255,255,255,0.38)',
        }}>{formatRelative(session.lastActive)}</span>
      </div>
      <div style={{
        fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.94)',
        lineHeight: 1.35,
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>{session.title}</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11, color: 'rgba(255,255,255,0.5)',
      }}>
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 140,
        }}>{session.cwd}</span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span>{session.branch}</span>
        <span style={{ flex: 1 }}/>
        <span>{session.messageCount} msg</span>
      </div>
      <div style={{
        display: 'flex', gap: 6, marginTop: 2,
        opacity: hover ? 1 : 0,
        transition: 'opacity 120ms',
        pointerEvents: hover ? 'auto' : 'none',
      }}>
        <OpenButton label="Focus" onClick={() => onOpen(session, 'focus')} Icon={IconFocus}/>
      </div>
    </div>
  );
}

function OpenButton({ label, onClick, Icon, primary = false }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 10px',
        background: hover ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 6,
        color: 'rgba(255,255,255,0.85)',
        fontFamily: 'inherit', fontSize: 11.5, fontWeight: 500,
        cursor: 'pointer', transition: 'all 100ms',
      }}>
      <Icon size={12.5} stroke={1.8}/>
      {label}
    </button>
  );
}

function ActiveStrip({ sessions, accent, onOpen, onHover, onLeave, onTick }) {
  // Force re-render every second for relative times
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const active = useMemo(() => sessions.filter((s) => s.active)
    .sort((a, b) => b.lastActive - a.lastActive), [sessions]);

  return (
    <section style={{
      padding: '18px 24px 18px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      background: 'linear-gradient(180deg, rgba(215,162,74,0.04) 0%, rgba(0,0,0,0) 100%)',
    }}>
      <header style={{
        display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12,
      }}>
        <h2 style={{
          margin: 0, fontSize: 11, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 1.2,
          color: 'rgba(255,255,255,0.55)',
        }}>Active sessions</h2>
        <span style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 11, color: 'rgba(255,255,255,0.35)',
        }}>{active.length} running</span>
        <span style={{ flex: 1 }}/>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10.5, color: 'rgba(255,255,255,0.4)',
        }}>
          <PulseDot color="#4ade80"/>
          listening on ~/.claude/sessions
        </span>
      </header>

      {active.length === 0 ? (
        <div style={{
          padding: '16px', borderRadius: 10,
          border: '1px dashed rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.4)', fontSize: 12.5,
        }}>No active sessions.</div>
      ) : (
        <div style={{
          display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4,
          scrollbarWidth: 'thin',
        }}>
          {active.map((s) => (
            <ActiveCard key={s.id} session={s} accent={accent}
                        onOpen={onOpen} onHover={onHover} onLeave={onLeave}/>
          ))}
        </div>
      )}
    </section>
  );
}

Object.assign(window, { ActiveStrip, OpenButton, PulseDot });
