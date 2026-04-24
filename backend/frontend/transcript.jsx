// Read-only transcript pane — shown on the right side

const { useState: useStateTx, useEffect: useEffectTx, useRef: useRefTx } = React;

function Transcript({ session, accent, onOpen }) {
  const scrollRef = useRefTx(null);
  useEffectTx(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.id]);

  if (!session) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.35)', fontSize: 13, padding: 40, textAlign: 'center',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <IconChat size={32} stroke={1.2}/>
          <div>Select a session from the list</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
            The transcript appears here, read-only
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'rgba(0,0,0,0.18)',
      minWidth: 0, minHeight: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column', gap: 6,
        background: 'rgba(0,0,0,0.22)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {session.active
            ? <PulseDot color={accent}/>
            : <IconDot size={7} color="rgba(255,255,255,0.25)"/>}
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10.5, color: session.active ? accent : 'rgba(255,255,255,0.45)',
            textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600,
          }}>
            {session.active ? session.activityLabel : 'idle'}
          </span>
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10.5, color: 'rgba(255,255,255,0.3)',
          }}>·</span>
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10.5, color: 'rgba(255,255,255,0.4)',
          }}>{session.id}</span>
          <span style={{ flex: 1 }}/>
          <a
            href={`/api/sessions/${session.id}/transcript.md`}
            download={`session-${session.id.slice(0, 8)}.md`}
            data-testid="transcript-export-md"
            title="Download transcript as Markdown"
            style={{
              padding: '3px 8px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 4,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 10, color: 'rgba(255,255,255,0.65)',
              textTransform: 'uppercase', letterSpacing: 0.6,
              textDecoration: 'none', cursor: 'pointer',
            }}>↓ .md</a>
          <div style={{
            padding: '3px 8px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase', letterSpacing: 0.6,
          }}>read-only</div>
        </div>
        <div style={{
          fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.96)',
          lineHeight: 1.35,
        }}>{session.title}</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 11, color: 'rgba(255,255,255,0.45)',
          flexWrap: 'wrap',
        }}>
          <span>{session.cwd}</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span>{session.branch}</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span>{session.model}</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span>{session.messageCount} msg</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span>{formatTokens(session.tokens)} tok</span>
          <span style={{ flex: 1 }}/>
          {session.active ? (
            <OpenButton label="Focus terminal" onClick={() => onOpen(session, 'focus')} Icon={IconFocus}/>
          ) : (
            <>
              <OpenButton label="Open in new tab" onClick={() => onOpen(session, 'tab')} Icon={IconNewTab}/>
              <OpenButton label="Split pane" onClick={() => onOpen(session, 'split')} Icon={IconSplit}/>
            </>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '18px 24px 24px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 780 }}>
          {session.transcript.map((m, i) => (
            <Message key={i} msg={m} accent={accent}/>
          ))}
          {session.active && (
            <div style={{
              display: 'flex', gap: 10, alignItems: 'center',
              color: 'rgba(255,255,255,0.4)', fontSize: 11.5,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              paddingLeft: 48,
            }}>
              <TypingDots color={accent}/>
              <span style={{ color: accent }}>{session.activityLabel}…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Message({ msg, accent }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isUser ? 'rgba(255,255,255,0.07)' : `${accent}22`,
        border: `1px solid ${isUser ? 'rgba(255,255,255,0.1)' : accent + '55'}`,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11, fontWeight: 700,
        color: isUser ? 'rgba(255,255,255,0.7)' : accent,
      }}>
        {isUser ? 'U' : '§'}
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: isUser ? 'rgba(255,255,255,0.7)' : accent,
            textTransform: 'uppercase', letterSpacing: 0.6,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}>{isUser ? 'You' : 'Assistant'}</span>
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, color: 'rgba(255,255,255,0.3)',
          }}>{formatRelative(msg.ts)}</span>
        </div>
        <div style={{
          fontSize: 13, lineHeight: 1.55,
          color: isUser ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.82)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{msg.content}</div>
      </div>
    </div>
  );
}

function TypingDots({ color }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 4, height: 4, borderRadius: '50%', background: color,
          animation: `typingPulse 1.2s ease-in-out ${i * 0.15}s infinite`,
        }}/>
      ))}
    </span>
  );
}

Object.assign(window, { Transcript });
