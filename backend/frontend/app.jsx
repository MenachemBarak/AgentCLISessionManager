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
  // Fetch the real version from /api/status on first paint. The hardcoded
  // "v0.4.2" that used to live below was silently stale across every 0.5+
  // release — users saw 0.4.2 in the title bar while running 0.8.0.
  const [versionLabel, setVersionLabel] = React.useState('');
  React.useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((s) => { if (s && s.version) setVersionLabel(`v${s.version}`); })
      .catch(() => {});
  }, []);
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
          }}>{versionLabel}</span>
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
          data-testid="tweaks-button"
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

      <UpdateBanner accent={ACCENTS[tweaks.accent]}/>

      {/* Body: two-pane */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}

function UpdateBanner({ accent }) {
  // Surfaces the self-update state the backend tracks at /api/update-status.
  // Phases — idle (hidden) | available | downloading | staged | applying | error.
  // Polls on mount + every 5 min (cheap: just reads in-memory state, no HTTP
  // out to github). Phase transitions drive button copy + progress bar.
  const [st, setSt] = React.useState(null);
  const [busy, setBusy] = React.useState(null); // 'download' | 'apply' | null
  const [localErr, setLocalErr] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const r = await fetch('/api/update-status');
      if (r.ok) setSt(await r.json());
    } catch {}
  }, []);

  // Force a synchronous re-fetch from GitHub. Without this the banner
  // only saw the cached snapshot from app startup; users who left the
  // viewer running through several releases never saw the banner.
  const forceCheck = React.useCallback(async () => {
    try {
      const r = await fetch('/api/update/check', { method: 'POST' });
      if (r.ok) setSt(await r.json());
    } catch {}
  }, []);

  React.useEffect(() => {
    refresh();
    // 5 min: cheap snapshot poll (in-memory state, no HTTP to github).
    const snap = setInterval(refresh, 5 * 60 * 1000);
    // 1 h: actual GitHub re-check from the frontend, augments the
    // backend's 30 min periodic check so the banner never lags more
    // than ~30 min behind a release drop.
    const live = setInterval(forceCheck, 60 * 60 * 1000);
    return () => { clearInterval(snap); clearInterval(live); };
  }, [refresh, forceCheck]);

  // While a download is in flight, poll faster so the progress bar moves.
  React.useEffect(() => {
    if (busy !== 'download') return;
    const id = setInterval(refresh, 500);
    return () => clearInterval(id);
  }, [busy, refresh]);

  if (!st || !st.checked) return null;
  if (!st.updateAvailable && !st.staged && !localErr) return null;

  const onDownload = async () => {
    setBusy('download'); setLocalErr(null);
    try {
      const r = await fetch('/api/update/download', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) setLocalErr(j.message || 'download failed');
    } catch (e) {
      setLocalErr(String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const onApply = async () => {
    if (!confirm('Restart the app now to apply the update?')) return;
    setBusy('apply'); setLocalErr(null);
    try {
      const r = await fetch('/api/update/apply', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) { setLocalErr(j.message || 'apply failed'); setBusy(null); return; }
      // The server will exit ~800ms after responding. Show a full-screen
      // curtain so the user sees *something* while the swap script runs.
      setTimeout(() => window.location.reload(), 6000);
    } catch (e) {
      setLocalErr(String(e));
      setBusy(null);
    }
  };

  const msg = localErr || st.error;
  const progress = st.downloadProgress || 0;

  return (
    <div data-testid="update-banner" style={{
      flexShrink: 0,
      padding: '7px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'rgba(255,200,80,0.08)',
      borderBottom: '1px solid rgba(255,200,80,0.18)',
      fontSize: 12, color: 'rgba(255,255,255,0.85)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, boxShadow: `0 0 6px ${accent}` }}/>
      <span>
        {st.staged
          ? <><b>Update ready</b> — v{st.latestVersion} downloaded. Restart to apply.</>
          : busy === 'download'
            ? <><b>Downloading</b> v{st.latestVersion}… {progress}%</>
            : busy === 'apply'
              ? <><b>Restarting</b> to v{st.latestVersion}…</>
              : <><b>Update available</b>: v{st.latestVersion} (current v{st.currentVersion})</>}
      </span>
      {busy === 'download' && (
        <span style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
          <span style={{ display: 'block', width: `${progress}%`, height: '100%', background: accent, transition: 'width 0.3s' }}/>
        </span>
      )}
      {!busy && !st.staged && (
        <button onClick={onDownload} style={{
          marginLeft: 'auto',
          background: accent, border: 'none', borderRadius: 4,
          padding: '4px 10px', fontSize: 11, fontWeight: 600,
          color: '#000', cursor: 'pointer',
        }}>Download</button>
      )}
      {!busy && st.staged && (
        <button onClick={onApply} style={{
          marginLeft: 'auto',
          background: accent, border: 'none', borderRadius: 4,
          padding: '4px 10px', fontSize: 11, fontWeight: 600,
          color: '#000', cursor: 'pointer',
        }}>Restart &amp; apply</button>
      )}
      {msg && (
        <span style={{ color: '#e47a6b', fontSize: 11, marginLeft: 8 }}>{msg}</span>
      )}
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
      // auto-select first active session on first load; re-select if the
      // currently-selected session was deleted out from under us.
      setSelectedId((cur) => {
        const stillExists = cur && list.some((s) => s.id === cur);
        if (stillExists) return cur;
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
    const unsubLabel = window.onUserLabelChanged && window.onUserLabelChanged((id, userLabel) => {
      setSessions((list) => list.map((s) => s.id === id ? { ...s, userLabel } : s));
    });
    return () => { unsub(); if (unsubLabel) unsubLabel(); bus.stop(); };
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
    if (mode === 'in-viewer') {
      // Route through RightPane via a window-registered callback
      // (set by RightPane.useEffect). Not calling window.openSession —
      // that's only for the external Windows Terminal path.
      if (window.openInViewer) {
        window.openInViewer(session);
      } else {
        console.warn('[app] openInViewer not registered');
      }
    } else if (window.openSession) {
      window.openSession(session.id, mode);
    }
    const short = `${session.title.slice(0, 40)}${session.title.length > 40 ? '…' : ''}`;
    const prefixes = {
      focus: 'Focused →',
      split: 'Split pane →',
      tab: 'New tab →',
      'in-viewer': 'Opened in viewer →',
    };
    const icons = {
      focus: <IconFocus size={13}/>,
      split: <IconSplit size={13}/>,
      tab: <IconNewTab size={13}/>,
      'in-viewer': <IconNewTab size={13}/>,
    };
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
      <RightPane selected={selected} accent={accent} onOpen={handleOpen}
        onActiveSessionChange={(sid) => { if (sid) setSelectedId(sid); }}/>
      <PreviewPopover session={hovered?.session} anchor={hovered?.anchor}
        accent={accent} mode={tweaks.hoverMode}/>
      <TweaksPanel open={tweaksOpen} tweaks={tweaks} setTweaks={setTweaks}
        onClose={() => setTweaksOpen(false)}/>
      <ToastStack toasts={toasts}/>
      <LoadingBar status={loadStatus} accent={accent}/>
    </WindowChrome>
  );
}

// Right pane = [Transcript] plus a dynamic list of terminal *tabs*. Each
// terminal tab owns a recursive tile-tree (`window.splits`) whose leaves
// are PTYs. Unlike PR #4, tabs are rendered with `display:none` when
// hidden — never unmounted — so switching tabs doesn't restart their
// shells. Every TerminalPane keeps a stable React key (`pane.id`) so
// React doesn't remount it across split/close operations either.
//
// Keyboard shortcuts (handler ignores keystrokes inside inputs / xterm):
//   Ctrl+Shift+T        new terminal tab
//   Ctrl+W              close active terminal tab
//   Alt+Shift+H         split focused pane horizontally (new pane right)
//   Alt+Shift+V         split focused pane vertically   (new pane below)
//   Alt+Shift+X         close focused pane
let _terminalSeq = 0;

// Walk a restored layout's terminal list and collect every sessionId found
// in any leaf pane's `spawn`. Used by the restart-ping flow to know which
// sessions were resumed before the last shutdown. Handles nested splits
// recursively. Skips ad-hoc shell panes (spawn.cmd but no sessionId).
function collectSessionIds(terminals) {
  const out = new Set();
  function walk(node) {
    if (!node) return;
    if (node.kind === 'pane' || (!node.kind && node.spawn)) {
      const sid = node.spawn?.sessionId;
      if (sid) out.add(sid);
      return;
    }
    if (node.kind === 'split' && Array.isArray(node.children)) {
      for (const c of node.children) walk(c);
    }
  }
  for (const tab of terminals) walk(tab.tree);
  return out;
}

// Walk any tile-tree and return the first pane's sessionId, or null if
// none of its leaves are resumable (all ad-hoc shells, or a malformed
// tree). Used to mirror "which session is this tab about?" into the
// left-pane selected row.
function firstSessionIdInTree(tree) {
  if (!tree) return null;
  if (tree.kind === 'pane' || (!tree.kind && tree.spawn)) {
    return tree.spawn?.sessionId || null;
  }
  if (tree.kind === 'split' && Array.isArray(tree.children)) {
    for (const c of tree.children) {
      const sid = firstSessionIdInTree(c);
      if (sid) return sid;
    }
  }
  return null;
}

function RightPane({ selected, accent, onOpen, onActiveSessionChange }) {
  // terminals[].tree  is the tile tree for that tab (built via
  // window.splits.makePane / splitNode / closeNode).
  const [terminals, setTerminals] = React.useState([]);
  const [activeId, setActiveId] = React.useState('transcript');
  // focusedPaneId is global across all tabs — only the active tab's
  // ring is visible in practice. Splits act on the focused pane of the
  // active tab.
  const [focusedPaneId, setFocusedPaneId] = React.useState(null);
  const hydratedRef = React.useRef(false);

  // Hydrate from the server-persisted snapshot on first mount. PTY
  // processes themselves can't survive a restart — but the tile tree,
  // tab labels, spawn config, active tab, and focused pane all can.
  // When the user interacts with a rehydrated tab, its leaves will spawn
  // fresh PTYs running the same command they had before.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/layout-state');
        if (!r.ok) return;
        const state = await r.json();
        if (cancelled) return;
        if (Array.isArray(state.terminals) && state.terminals.length > 0) {
          // Bump the seq past the restored IDs so new tabs don't collide.
          const maxSeq = state.terminals.reduce((m, t) => {
            const n = Number((t.id || '').replace(/^term-/, ''));
            return isFinite(n) && n > m ? n : m;
          }, 0);
          _terminalSeq = Math.max(_terminalSeq, maxSeq);
          // Seed the restart-ping pending set — any restored tab whose
          // tree holds a pane with a sessionId should get the
          // "SOFTWARE RESTARTED" nudge once its PTY is ready. Scope is
          // strictly "restored from persisted layout on this boot" so
          // later "In viewer" clicks don't re-ping.
          const sids = collectSessionIds(state.terminals);
          if (!window._restartPingPending) window._restartPingPending = new Set();
          if (!window._restartPingFired) window._restartPingFired = new Set();
          for (const sid of sids) window._restartPingPending.add(sid);
          setTerminals(state.terminals);
          if (state.activeId) setActiveId(state.activeId);
          if (state.focusedPaneId) setFocusedPaneId(state.focusedPaneId);
        }
      } catch {}
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  // Mirror the active terminal tab's sessionId into the left-pane
  // selection. When the user clicks a terminal tab that holds a
  // `claude --resume <sid>` pane, the matching row in the session list
  // should highlight (and its transcript load in the Transcript tab).
  // Fires only when activeId points at a tab whose first leaf has a
  // sessionId — ad-hoc shell tabs don't move the selection.
  React.useEffect(() => {
    if (!onActiveSessionChange) return;
    if (activeId === 'transcript') return;
    const tab = terminals.find((t) => t.id === activeId);
    if (!tab) return;
    const sid = firstSessionIdInTree(tab.tree);
    if (sid) onActiveSessionChange(sid);
  }, [activeId, terminals, onActiveSessionChange]);

  // Debounced persist: every mutation to the layout state writes a tiny
  // JSON blob to ~/.claude/viewer-terminal-state.json. 400 ms debounce is
  // enough to absorb drag-to-resize storms without spamming disk I/O.
  React.useEffect(() => {
    if (!hydratedRef.current) return;
    const handle = setTimeout(() => {
      fetch('/api/layout-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminals, activeId, focusedPaneId }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [terminals, activeId, focusedPaneId]);

  const openTerminal = React.useCallback((opts) => {
    // opts: { spawn, label } — when omitted we default to an ad-hoc cmd.exe.
    _terminalSeq += 1;
    const id = `term-${_terminalSeq}`;
    const spawn = opts?.spawn || { cmd: ['cmd.exe'] };
    const label = opts?.label || `Terminal ${_terminalSeq}`;
    const pane = window.splits.makePane(spawn);
    setTerminals((list) => [...list, { id, label, tree: pane }]);
    setActiveId(id);
    setFocusedPaneId(pane.id);
  }, []);

  // Register a global entry so session-row's "In viewer" button can spawn
  // a terminal running that session's resume command. Only registered
  // while RightPane is mounted; unregistered on unmount.
  React.useEffect(() => {
    window.openInViewer = (session) => {
      if (!session || !session.id) return;
      const shortId = session.id.slice(0, 8);
      // Label prefers userLabel > claudeTitle > "Resume <sid8>".
      const label = session.userLabel
        || (session.claudeTitle ? session.claudeTitle.slice(0, 24) : null)
        || `Resume ${shortId}`;
      openTerminal({
        spawn: {
          provider: session.provider || 'claude-code',
          sessionId: session.id,
          // Match external "New tab" behaviour: start the resumed shell in
          // the session's original working directory. Without this the
          // spawn inherits the viewer's cwd (C:\...\ClaudeSessionsViewer)
          // which breaks relative-path references inside the session.
          cwd: session.cwd,
        },
        label,
      });
    };
    return () => { if (window.openInViewer) delete window.openInViewer; };
  }, [openTerminal]);

  const closeTerminal = React.useCallback((id, e) => {
    if (e) { e.stopPropagation(); }
    setTerminals((list) => {
      const next = list.filter((t) => t.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const idx = list.findIndex((t) => t.id === id);
        if (idx > 0) return list[idx - 1].id;
        if (next.length > 0) return next[0].id;
        return 'transcript';
      });
      return next;
    });
  }, []);

  const updateActiveTree = React.useCallback((updater) => {
    setTerminals((list) => list.map(
      (t) => (t.id === activeId ? { ...t, tree: updater(t.tree) } : t)
    ));
  }, [activeId]);

  const splitFocused = React.useCallback((dir) => {
    if (!focusedPaneId) return;
    setTerminals((list) => list.map((t) => {
      if (t.id !== activeId) return t;
      const { tree, newPaneId } = window.splits.splitNode(t.tree, focusedPaneId, dir);
      // Focus jumps to the new pane so the user can immediately split
      // again or start typing.
      if (newPaneId) setTimeout(() => setFocusedPaneId(newPaneId), 0);
      return { ...t, tree };
    }));
  }, [activeId, focusedPaneId]);

  const closeFocusedPane = React.useCallback(() => {
    if (!focusedPaneId) return;
    setTerminals((list) => list.flatMap((t) => {
      if (t.id !== activeId) return [t];
      const { tree, nextFocusId } = window.splits.closeNode(t.tree, focusedPaneId);
      if (tree === null) {
        // pane was the last one in this tab → close the tab entirely
        setActiveId((cur) => (cur === t.id ? 'transcript' : cur));
        return [];
      }
      if (nextFocusId) setTimeout(() => setFocusedPaneId(nextFocusId), 0);
      return [{ ...t, tree }];
    }));
  }, [activeId, focusedPaneId]);

  React.useEffect(() => {
    function onKey(e) {
      const tgt = e.target;
      const tag = tgt && tgt.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Keystrokes inside xterm go to the shell — never to our shortcuts.
      if (tgt && tgt.closest && tgt.closest('.xterm')) return;
      if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault(); openTerminal();
      } else if (e.ctrlKey && (e.key === 'w' || e.key === 'W') && activeId !== 'transcript') {
        e.preventDefault(); closeTerminal(activeId);
      } else if (e.altKey && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault(); splitFocused('h');
      } else if (e.altKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault(); splitFocused('v');
      } else if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
        e.preventDefault(); closeFocusedPane();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, openTerminal, closeTerminal, splitFocused, closeFocusedPane]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{
        display: 'flex', gap: 2, padding: '6px 10px 0', alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <button onClick={() => setActiveId('transcript')}
          style={tabBtnStyle(activeId === 'transcript', accent)}
          data-testid="right-tab-transcript">
          Transcript
        </button>
        {terminals.map((t) => (
          <button key={t.id} onClick={() => setActiveId(t.id)}
            style={tabBtnStyle(activeId === t.id, accent)}
            data-testid={`right-tab-${t.id}`}>
            {t.label}
            <span onClick={(e) => closeTerminal(t.id, e)}
              data-testid={`right-tab-close-${t.id}`}
              style={{
                marginLeft: 6, padding: '0 4px', borderRadius: 3, opacity: 0.55,
                fontSize: 11, cursor: 'pointer',
              }}
              title="Close (Ctrl+W)">×</span>
          </button>
        ))}
        <button onClick={openTerminal}
          title="New terminal (Ctrl+Shift+T)"
          data-testid="right-tab-new-terminal"
          style={{
            padding: '6px 10px', fontSize: 14, fontFamily: 'Inter, sans-serif',
            background: 'transparent', color: 'rgba(255,255,255,0.45)',
            border: 'none', cursor: 'pointer',
          }}>+</button>
        {activeId !== 'transcript' && (
          <div style={{
            marginLeft: 'auto', display: 'flex', gap: 4,
            paddingBottom: 3, fontSize: 11, color: 'rgba(255,255,255,0.5)',
          }}>
            <button onClick={() => splitFocused('h')}
              data-testid="split-h-btn" title="Split right (Alt+Shift+H)"
              style={toolbarBtnStyle}>⊟ split right</button>
            <button onClick={() => splitFocused('v')}
              data-testid="split-v-btn" title="Split down (Alt+Shift+V)"
              style={toolbarBtnStyle}>⊞ split down</button>
            <button onClick={closeFocusedPane}
              data-testid="close-pane-btn" title="Close pane (Alt+Shift+X)"
              style={toolbarBtnStyle}>× close pane</button>
          </div>
        )}
      </div>

      {/* Body. Transcript + each terminal tab lives in its own div that
          is display:none when inactive — this preserves the xterm
          viewports and their WebSockets across tab switches. */}
      <div data-testid="transcript-pane" style={{
        flex: 1, display: activeId === 'transcript' ? 'flex' : 'none',
        flexDirection: 'column', minHeight: 0,
      }}>
        <Transcript session={selected} accent={accent} onOpen={onOpen}/>
      </div>
      {terminals.map((t) => (
        <div key={t.id} style={{
          flex: 1, display: activeId === t.id ? 'flex' : 'none',
          flexDirection: 'column', minHeight: 0, padding: 4,
        }}>
          <TileTree tree={t.tree} focusedId={focusedPaneId}
            onFocus={setFocusedPaneId}
            onUpdateTree={(updater) => updateActiveTree(updater)}/>
        </div>
      ))}
    </div>
  );
}

const toolbarBtnStyle = {
  padding: '4px 8px', fontSize: 11, fontFamily: 'Inter, sans-serif',
  background: 'transparent', color: 'rgba(255,255,255,0.5)',
  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4,
  cursor: 'pointer',
};

function tabBtnStyle(active, accent) {
  return {
    padding: '6px 12px', fontSize: 12, fontFamily: 'Inter, sans-serif',
    background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
    color: active ? accent || '#d7a24a' : 'rgba(255,255,255,0.55)',
    border: 'none', borderBottom: active ? `2px solid ${accent || '#d7a24a'}` : '2px solid transparent',
    cursor: 'pointer', marginBottom: -1, display: 'inline-flex', alignItems: 'center',
  };
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
