// Main app — two-pane: compact list (left) + transcript (right)

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useRef: useRefA } = React;

const ACCENTS = {
  amber: '#d7a24a',
  coral: '#e47a6b',
  sage: '#8ab078',
  violet: '#a189d4',
  sky: '#6ca6c9',
};

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "amber",
  "density": "comfortable",
  "hoverMode": "popover",
  "liveOn": true
}/*EDITMODE-END*/;

function WindowChrome({ children, tweaks, onToggleTweaks, selectedCount, activeCount }) {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      borderRadius: 0, overflow: 'hidden',
      background: '#14120f',
      color: 'rgba(255,255,255,0.92)',
      boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 24px 80px rgba(0,0,0,0.55)',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontFeatureSettings: '"ss01", "cv11"',
      position: 'relative',
    }}>
      {/* Title bar */}
      <div style={{
        height: 40, flexShrink: 0,
        padding: '0 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', border: '0.5px solid rgba(0,0,0,0.2)' }}/>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', border: '0.5px solid rgba(0,0,0,0.2)' }}/>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', border: '0.5px solid rgba(0,0,0,0.2)' }}/>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6,
        }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6,
            background: `linear-gradient(135deg, ${ACCENTS[tweaks.accent]} 0%, ${ACCENTS[tweaks.accent]}88 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
            color: '#000',
          }}>§</div>
          <span style={{
            fontSize: 12.5, fontWeight: 600, letterSpacing: 0.2,
            color: 'rgba(255,255,255,0.9)',
          }}>Session Manager</span>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
            color: 'rgba(255,255,255,0.3)',
          }}>v0.4.2</span>
        </div>
        <span style={{ flex: 1 }}/>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
          color: 'rgba(255,255,255,0.4)',
        }}>
          <PulseDot color="#4ade80"/>
          <span>{activeCount} active</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{selectedCount} total</span>
        </div>
        <button onClick={onToggleTweaks}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6, padding: '4px 10px',
            color: 'rgba(255,255,255,0.75)', fontFamily: 'inherit',
            fontSize: 11, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 5,
            cursor: 'pointer',
          }}>
          <IconCog size={12}/> Tweaks
        </button>
      </div>

      {/* Body: two-pane */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}

function App() {
  const [tweaks, setTweaks] = useStateA(() => {
    try {
      const saved = localStorage.getItem('cm_tweaks');
      if (saved) return { ...DEFAULT_TWEAKS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_TWEAKS;
  });
  const [tweaksOpen, setTweaksOpen] = useStateA(false);
  const [sessions, setSessions] = useStateA([]);
  const [selectedId, setSelectedId] = useStateA(null);
  const [hovered, setHovered] = useStateA(null);
  const hoverTimer = useRefA(null);

  const [sort, setSort] = useStateA('last_active');
  const [query, setQuery] = useStateA('');
  const [dateRange, setDateRange] = useStateA('any');
  const [statusFilter, setStatusFilter] = useStateA('all');

  const [toasts, setToasts] = useStateA([]);
  const [recentlyCreated, setRecentlyCreated] = useStateA(new Set());
  const [loadStatus, setLoadStatus] = useStateA({ ready: false, done: 0, total: 0, phase: 'starting' });

  useEffectA(() => {
    try { localStorage.setItem('cm_tweaks', JSON.stringify(tweaks)); } catch {}
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: tweaks }, '*');
  }, [tweaks]);

  useEffectA(() => {
    const handler = (e) => {
      if (e.data?.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const busRef = useRefA(null);
  const previewLoadedRef = useRefA(new Set());
  const transcriptLoadedRef = useRefA(new Set());
  useEffectA(() => {
    const bus = createSessionBus();
    busRef.current = bus;
    bus.start();
    const unsub = bus.subscribe((ev, list) => {
      if (ev.type === 'loading_progress') { setLoadStatus({ ...ev.status, ready: false }); return; }
      if (ev.type === 'loading_done') { setLoadStatus((s) => ({ ...s, ready: true })); return; }
      setSessions(list);
      // auto-select first active session on first load
      setSelectedId((cur) => {
        if (cur) return cur;
        const firstActive = list.find((s) => s.active);
        return firstActive?.id || list[0]?.id || null;
      });
      if (ev.type === 'session_created') {
        setRecentlyCreated((prev) => {
          const n = new Set(prev); n.add(ev.session.id); return n;
        });
        setTimeout(() => {
          setRecentlyCreated((prev) => {
            const n = new Set(prev); n.delete(ev.session.id); return n;
          });
        }, 2400);
        pushToast({
          text: `New session: ${ev.session.title.slice(0, 42)}${ev.session.title.length > 42 ? '…' : ''}`,
          icon: <PulseDot color={ACCENTS[tweaks.accent]}/>,
        });
      }
    });
    return () => { unsub(); bus.stop(); };
  }, []);

  useEffectA(() => {
    const bus = busRef.current;
    if (!bus) return;
    if (tweaks.liveOn) bus.start(); else bus.stop();
  }, [tweaks.liveOn]);

  function pushToast(t) {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts, { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3200);
  }

  function handleOpen(session, mode) {
    if (window.openSession) window.openSession(session.id, mode);
    const short = `${session.title.slice(0, 40)}${session.title.length > 40 ? '…' : ''}`;
    const prefixes = { focus: 'Focused →', split: 'Split pane →', tab: 'New tab →' };
    const icons = { focus: <IconFocus size={13}/>, split: <IconSplit size={13}/>, tab: <IconNewTab size={13}/> };
    pushToast({ text: `${prefixes[mode] || 'Open →'} ${short}`, icon: icons[mode] || <IconNewTab size={13}/> });
  }

  function handleHover(session, anchor) {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setHovered({ session, anchor });
      if (busRef.current && !previewLoadedRef.current.has(session.id)) {
        previewLoadedRef.current.add(session.id);
        busRef.current.loadPreview(session.id);
      }
    }, 350);
  }
  function handleLeave() {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(null), 120);
  }

  const accent = ACCENTS[tweaks.accent] || ACCENTS.amber;
  const selected = sessions.find((s) => s.id === selectedId) || null;
  const activeCount = sessions.filter((s) => s.active).length;

  useEffectA(() => {
    if (!selectedId || !busRef.current) return;
    if (transcriptLoadedRef.current.has(selectedId)) return;
    transcriptLoadedRef.current.add(selectedId);
    busRef.current.loadTranscript(selectedId);
  }, [selectedId]);

  return (
    <WindowChrome tweaks={tweaks}
      onToggleTweaks={() => setTweaksOpen((o) => !o)}
      selectedCount={sessions.length} activeCount={activeCount}>
      <CompactList
        sessions={sessions} accent={accent}
        selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)}
        sort={sort} setSort={setSort}
        query={query} setQuery={setQuery}
        dateRange={dateRange} setDateRange={setDateRange}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        recentlyCreated={recentlyCreated}
        onOpen={handleOpen}
        onHover={handleHover} onLeave={handleLeave}/>
      <Transcript session={selected} accent={accent} onOpen={handleOpen}/>
      <PreviewPopover session={hovered?.session} anchor={hovered?.anchor}
        accent={accent} mode={tweaks.hoverMode}/>
      <TweaksPanel open={tweaksOpen} tweaks={tweaks} setTweaks={setTweaks}
        onClose={() => setTweaksOpen(false)}/>
      <ToastStack toasts={toasts}/>
      <LoadingBar status={loadStatus} accent={accent}/>
    </WindowChrome>
  );
}

function LoadingBar({ status, accent }) {
  if (status.ready) return null;
  const pct = status.total > 0 ? Math.min(100, Math.round((status.done / status.total) * 100)) : 0;
  const label = status.total > 0
    ? `Indexing sessions · ${status.done.toLocaleString()} / ${status.total.toLocaleString()}`
    : 'Starting up…';
  return (
    <div style={{
      position: 'absolute', top: 40, left: 0, right: 0, zIndex: 200,
      pointerEvents: 'none',
    }}>
      <div style={{
        height: 3, background: 'rgba(255,255,255,0.06)', position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: pct > 0 ? `${pct}%` : '30%',
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          animation: pct === 0 ? 'toastIn 1.4s ease-in-out infinite alternate' : 'none',
          transition: 'width 200ms ease-out',
        }}/>
      </div>
      <div style={{
        padding: '8px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11, color: 'rgba(255,255,255,0.7)',
      }}>
        <PulseDot color={accent}/>
        <span>{label}</span>
        {status.total > 0 && <span style={{ color: accent, fontWeight: 600 }}>{pct}%</span>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
