// Hover preview popover — shows first 10 user messages

const { useState: useState_P, useEffect: useEffect_P, useMemo: useMemo_P } = React;

function PreviewPopover({ session, anchor, accent, mode }) {
  if (!session || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const POP_W = 440;

  // Decide side
  const preferRight = rect.right + POP_W + 12 < vw;
  const left = preferRight
    ? Math.min(rect.right + 10, vw - POP_W - 12)
    : Math.max(rect.left - POP_W - 10, 12);
  const topRaw = rect.top;
  const top = Math.max(12, Math.min(topRaw, vh - 400));

  if (mode === 'sidepanel') {
    return (
      <div style={{
        position: 'fixed', top: 96, right: 24, bottom: 24, width: 400,
        zIndex: 50,
        background: 'rgba(22,20,18,0.96)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(20px)',
        overflow: 'hidden',
        animation: 'slideIn 160ms ease-out',
      }}>
        <PreviewContents session={session} accent={accent}/>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', left, top, width: POP_W, maxHeight: 440,
      zIndex: 50,
      background: 'rgba(22,20,18,0.97)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10,
      boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
      backdropFilter: 'blur(20px)',
      overflow: 'hidden',
      animation: 'fadeIn 120ms ease-out',
      pointerEvents: 'none',
    }}>
      <PreviewContents session={session} accent={accent}/>
    </div>
  );
}

function PreviewContents({ session, accent }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {session.active
            ? <PulseDot color={accent}/>
            : <IconDot size={6} color="rgba(255,255,255,0.25)"/>}
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, color: session.active ? accent : 'rgba(255,255,255,0.45)',
            textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600,
          }}>
            {session.active ? session.activityLabel : 'Idle'}
          </span>
          <span style={{ flex: 1 }}/>
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, color: 'rgba(255,255,255,0.4)',
          }}>{session.id}</span>
        </div>
        <div style={{
          fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.95)',
          lineHeight: 1.4,
        }}>{session.title}</div>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10.5, color: 'rgba(255,255,255,0.45)',
          display: 'flex', gap: 8, flexWrap: 'wrap',
        }}>
          <span>{session.cwd}</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span>{session.branch}</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span>{session.model}</span>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '10px 16px 14px',
      }}>
        <div style={{
          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: 1, color: 'rgba(255,255,255,0.4)',
          padding: '6px 0 8px',
        }}>
          First {session.firstUserMessages.length} user messages
        </div>
        <ol style={{
          margin: 0, padding: 0, listStyle: 'none',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {session.firstUserMessages.map((m, i) => (
            <li key={i} style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
            }}>
              <span style={{
                flexShrink: 0, width: 18,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 10, color: 'rgba(255,255,255,0.3)',
                lineHeight: 1.5, paddingTop: 1,
              }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{
                fontSize: 12, color: 'rgba(255,255,255,0.78)',
                lineHeight: 1.5,
              }}>{m}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Footer meta */}
      <div style={{
        padding: '10px 16px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', gap: 16,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10.5, color: 'rgba(255,255,255,0.45)',
      }}>
        <span>created {formatDateTime(session.createdAt)}</span>
        <span style={{ flex: 1 }}/>
        <span>{session.messageCount} msg</span>
        <span>{formatTokens(session.tokens)} tok</span>
      </div>
    </div>
  );
}

Object.assign(window, { PreviewPopover });
