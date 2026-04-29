// Read-only transcript pane — shown on the right side

const { useState: useStateTx, useEffect: useEffectTx, useRef: useRefTx, useMemo: useMemoTx } = React;

function CopySessionId({ sid }) {
  const [copied, setCopied] = useStateTx(false);
  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(sid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // pywebview 5 has clipboard access; fallback for edge cases:
      const ta = document.createElement('textarea');
      ta.value = sid;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
      document.body.removeChild(ta);
    }
  };
  return (
    <button
      onClick={onClick}
      data-testid="transcript-copy-id"
      title="Copy full session ID to clipboard"
      style={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10.5, color: copied ? '#4ade80' : 'rgba(255,255,255,0.4)',
        background: 'transparent', border: 'none', padding: '0 4px',
        cursor: 'pointer', textAlign: 'left',
      }}>
      {copied ? '✓ copied' : sid}
    </button>
  );
}

function Transcript({ session, accent, onOpen }) {
  const scrollRef = useRefTx(null);
  const [findOpen, setFindOpen] = useStateTx(false);
  const [findQuery, setFindQuery] = useStateTx('');
  const [findIndex, setFindIndex] = useStateTx(0);
  useEffectTx(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.id]);

  // Ctrl+C on selected transcript text → copy to clipboard. EdgeWebView2
  // normally handles this natively, but this explicit path ensures it works
  // even when pywebview's clipboard API is restricted.
  useEffectTx(() => {
    const onCopy = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl || e.key !== 'c') return;
      // Only handle when focus is NOT in a terminal (xterm has its own handler).
      if (document.activeElement?.closest?.('.xterm')) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString();
      if (!text) return;
      navigator.clipboard.writeText(text).catch(() => {
        try { document.execCommand('copy'); } catch {}
      });
      // No preventDefault — let the browser also handle it.
    };
    window.addEventListener('keydown', onCopy, true);
    return () => window.removeEventListener('keydown', onCopy, true);
  }, []);

  // Ctrl+F opens the find bar. Active when the transcript pane has focus
  // (any element inside it) OR when the bar is already open. Esc closes.
  useEffectTx(() => {
    const onKey = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'f') {
        // Skip if focus is in a terminal / input outside the transcript.
        const ae = document.activeElement;
        const inXterm = !!ae?.closest?.('.xterm');
        if (inXterm) return;
        // Only hijack when there's actually a session loaded with content.
        if (!session) return;
        e.preventDefault();
        setFindOpen(true);
        setFindIndex(0);
        setTimeout(() => {
          const input = document.querySelector('[data-testid="transcript-find-input"]');
          input?.focus?.();
          input?.select?.();
        }, 20);
      } else if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        setFindOpen(false);
        setFindQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, findOpen]);

  // Compute match indices into the transcript array. A 'match' is a
  // message whose content contains the query (case-insensitive). We
  // highlight the substring inside Message via a prop.
  const matchedIndices = useMemoTx(() => {
    if (!findOpen || !findQuery.trim() || !session?.transcript) return [];
    const q = findQuery.toLowerCase();
    const out = [];
    session.transcript.forEach((m, i) => {
      if ((m.content || '').toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [findOpen, findQuery, session?.transcript]);

  // Scroll the current match into view.
  useEffectTx(() => {
    if (!findOpen || matchedIndices.length === 0) return;
    const idx = matchedIndices[findIndex % matchedIndices.length];
    const el = document.querySelector(`[data-msg-index="${idx}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [findOpen, findIndex, matchedIndices]);

  const currentMatchMsgIndex =
    matchedIndices.length === 0 ? -1 : matchedIndices[findIndex % matchedIndices.length];

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
          <CopySessionId sid={session.id}/>
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

      {findOpen && (
        <div data-testid="transcript-find-bar" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.03)',
        }}>
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10.5, color: 'rgba(255,255,255,0.4)',
            textTransform: 'uppercase', letterSpacing: 0.6,
          }}>find</span>
          <input
            data-testid="transcript-find-input"
            value={findQuery}
            onChange={(e) => { setFindQuery(e.target.value); setFindIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (matchedIndices.length > 0) {
                  const next = e.shiftKey
                    ? (findIndex - 1 + matchedIndices.length) % matchedIndices.length
                    : (findIndex + 1) % matchedIndices.length;
                  setFindIndex(next);
                }
              }
            }}
            placeholder="Find in transcript…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'rgba(255,255,255,0.94)',
              fontFamily: 'inherit', fontSize: 13,
            }}/>
          <span data-testid="transcript-find-count" style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10.5, color: 'rgba(255,255,255,0.4)',
            minWidth: 60, textAlign: 'right',
          }}>
            {findQuery.trim()
              ? (matchedIndices.length
                  ? `${(findIndex % matchedIndices.length) + 1}/${matchedIndices.length}`
                  : '0 matches')
              : ''}
          </span>
          <button
            onClick={() => { setFindOpen(false); setFindQuery(''); }}
            title="Close (Esc)"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', padding: '2px 6px', fontSize: 14,
            }}>×</button>
        </div>
      )}
      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '18px 24px 24px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 780 }}>
          {session.transcript.map((m, i) => (
            <Message key={i} msg={m} accent={accent} msgIndex={i}
              highlight={findOpen ? findQuery : ''}
              isCurrentMatch={i === currentMatchMsgIndex}/>
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

function highlightText(text, query) {
  if (!query) return text;
  const q = query.toLowerCase();
  const src = text || '';
  const parts = [];
  let i = 0;
  const srcLower = src.toLowerCase();
  while (i < src.length) {
    const hit = srcLower.indexOf(q, i);
    if (hit < 0) { parts.push(src.slice(i)); break; }
    if (hit > i) parts.push(src.slice(i, hit));
    parts.push(
      <mark key={parts.length} style={{
        background: 'rgba(215, 162, 74, 0.45)',
        color: 'inherit', padding: 0, borderRadius: 2,
      }}>{src.slice(hit, hit + q.length)}</mark>
    );
    i = hit + q.length;
  }
  return parts;
}

function Message({ msg, accent, msgIndex, highlight, isCurrentMatch }) {
  const isUser = msg.role === 'user';
  const [hover, setHover] = useStateTx(false);
  const [copied, setCopied] = useStateTx(false);
  const onCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(msg.content || '');
    } catch {
      // execCommand fallback for pywebview edge cases
      const ta = document.createElement('textarea');
      ta.value = msg.content || '';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div
      data-msg-index={msgIndex}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        outline: isCurrentMatch ? `2px solid ${accent}66` : 'none',
        outlineOffset: 4, borderRadius: 4,
        transition: 'outline 150ms',
        position: 'relative',
      }}>
      {(hover || copied) && (
        <button
          onClick={onCopy}
          data-testid={`msg-copy-${msgIndex}`}
          title="Copy message content"
          style={{
            position: 'absolute', top: 2, right: 2,
            padding: '2px 7px',
            background: 'rgba(22,19,16,0.92)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, letterSpacing: 0.4,
            color: copied ? '#4ade80' : 'rgba(255,255,255,0.65)',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}>{copied ? '✓ copied' : 'copy'}</button>
      )}
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
        }}>{highlight ? highlightText(msg.content, highlight) : msg.content}</div>
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
