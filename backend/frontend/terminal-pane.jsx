// Embedded terminal pane — xterm.js + /api/pty/ws.
//
// Contract: one `<TerminalPane>` owns exactly one PTY process on the server.
// Mount → opens WS → sends "spawn" → server replies "ready" → the user
// types, we forward `{type:"input",data:...}`; the server streams PTY
// output back as `{type:"output",data:"..."}` which we `term.write(...)`
// into xterm.
//
// Lifecycle defense:
//   * We never call `term.write` or `ws.send` after unmount — both are
//     guarded by a `disposed` flag plus readyState checks.
//   * Resize is piped both directions: ResizeObserver → FitAddon.fit() →
//     ws.send({type:"resize",cols,rows}) so the backend PTY matches the
//     DOM viewport.
//
// No build step — this file is transformed at runtime by babel-standalone.

// Tiny helper: resolve the WebSocket URL from the current page. We serve
// the API on the same origin, so ws(s)://<host>:<port>/api/pty/ws.
function ptyWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/pty/ws`;
}

// Restart-ping state (module-level so it survives across pane mounts within
// the same app boot but resets on a page reload, which is exactly what we
// want — each viewer boot pings every restored session at most once).
//   window._restartPingPending: Set<sessionId> — populated during layout
//     hydration in app.jsx. A session is in this set only if the tab was
//     restored from persisted layout (not freshly opened by the user).
//   window._restartPingFired: Set<sessionId> — tracks which sessions were
//     already pinged this boot, so a split pane with the same session
//     can't trigger a double-ping.
// `null` means uninitialized — layout hydration populates the set to
// either a Set with ids or an empty Set.
window._restartPingPending = window._restartPingPending ?? new Set();
window._restartPingFired = window._restartPingFired ?? new Set();

// The exact text the user specified. Preserves the user's phrasing
// (including "LEFT OF" / "IDELING") so agents reading this don't feel
// misquoted. The message deliberately includes explicit guardrails:
//   1. GO ON EXACTLY — no re-planning, resume the same task
//   2. IF IDLE, KEEP IDLING — do not proactively jump to something new
//   3. IF IN PROGRESS, CONTINUE — resume the stopped work
//   4. NO NEW INITIATIVE — stick to the pre-restart scope
//   5. VALIDATE PRESERVED STATE — remind the agent to check background
//      tasks / services / cron jobs it was managing before the restart
const RESTART_PING_TEXT =
  'SOFTWARE RESTARTED - GO ON EXACTLY FROM WHERE YOU LEFT OF - IF YOU WAS IDLE '
  + 'WAITING FOR THE USER INPUT - KEEP IDELING, IF YOU WAS IN TASK PROGRESS AND '
  + 'WORK PLEASE GO ON WITH THE WORK, DO NOT TAKE INITIATIVE BEYOND WHAT YOU '
  + 'ALREADY DID BEFORE THIS SOFTWARE RESTART, PLEASE VALIDATE THAT ALL RUNNING '
  + 'BACKGROUND TASKS, SERVICES AND CRON JOBS ETC ARE PRESERVED JUST AS HOW WE '
  + 'LEFT OF BEFORE THE RESTART';

// Claude Code shows this prompt when you `--resume` a session older than
// ~some threshold (measured in age + token count): it offers "Resume from
// summary (recommended)" or "Resume full session as-is" or "Don't ask me
// again". The default cursor is on option 1 (summary), but for unattended
// resume we want option 2 — summary-compression hides the context the
// user has been actively working with. Matching a distinctive fragment
// of the prompt ensures we don't false-trigger on stray output.
const RESUME_PROMPT_MARKER = 'Resume full session as-is';
// Prefer a single digit keystroke over arrow+enter. Claude Code's select
// component (Ink's `C6`) accepts `2` as a one-keystroke pick for option 2
// — no Enter needed, no ESC sequence to get eaten by Ink's bracketed-paste
// detector. The v1.0.0 → v1.1.0 fixes tried increasingly elaborate
// arrow+enter schemes to beat the paste detector; the digit bypasses the
// paste detector entirely. See playgrounds/ research 2026-04-24.
const RESUME_PROMPT_PICK_FULL = '2';
// Dedupe across re-renders of the same pane: once a session has been
// auto-answered this boot, any later output still showing the prompt
// text (e.g. scrollback) shouldn't re-send.
if (!window._resumePromptHandled) window._resumePromptHandled = new Set();

// Track which panes have had their auto-resume command typed in. Keyed
// by spawn-id (the PTY's server-assigned id from the `ready` frame) so
// each independent pane gets its own typing even if multiple panes share
// a sessionId.
if (!window._autoResumeTyped) window._autoResumeTyped = new Set();

// Type a string into the PTY one frame at a time with a short gap
// between chunks. Ink-TUI's bracketed-paste detection treats fast back-
// to-back frames as a single paste — which ate the trailing Enter in
// v1.0.0 and caused the "compact instead of resume" disaster. Chunking
// 16 chars per frame with 30ms gaps is slow enough that each chunk
// shows up as individual typing, fast enough that the user perceives
// it as instant.
async function typeIntoPty(send, text) {
  const CHUNK = 16;
  for (let i = 0; i < text.length; i += CHUNK) {
    send({ type: 'input', data: text.slice(i, i + CHUNK) });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 30));
  }
}
// v1.1.0: under shell-wrap, we need to wait for: (a) the shell to
// render its prompt (~1.2s), (b) the auto-typed `claude --resume` to
// finish streaming (~2s for chunked typing), (c) claude to launch
// + render its own prompt (~3s). 8s leaves margin.
const RESTART_PING_DELAY_MS = 8000;

function TerminalPane({ spawn, onExit, onReady, onPtyReady, className, paneId }) {
  // `spawn` — object passed as the first WS frame. Shape:
  //   { cmd: ["cmd.exe"] }                // ad-hoc shell
  //   { provider: "claude-code", sessionId: "<uuid>" }  // resume
  //
  // `paneId` (optional) — when set, this TerminalPane is rendered flat
  // at the tab level (see app.jsx) and appendChild's its wrapper div
  // into the matching <div data-pane-slot={paneId}/> slot rendered by
  // TileTree. This keeps xterm + WebSocket + PTY alive across tile-tree
  // restructures (split, close-sibling, etc.) because the React tree
  // never sees the pane move. Legacy callers without paneId render in
  // place, unchanged.
  const wrapperRef = React.useRef(null);
  const hostRef = React.useRef(null);
  const termRef = React.useRef(null);
  const wsRef = React.useRef(null);
  const fitRef = React.useRef(null);
  const disposedRef = React.useRef(false);
  const reconnectCountRef = React.useRef(0);
  const statusRef = React.useRef('connecting');
  const ptyIdNotFoundRef = React.useRef(false);
  const [status, setStatusState] = React.useState('connecting'); // connecting|ready|exited|error
  const [error, setError] = React.useState(null);

  // Keep statusRef in sync with state on every update
  const setStatus = React.useCallback((s) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  // React's "original parent" for our wrapper — whatever DOM element
  // our wrapper was inserted into on first render (the tab div, as
  // part of app.jsx's flat panes.map). React will later call
  // `removeChild(wrapper)` on this parent when our pane is unmounted
  // (e.g. closing a split). If we've moved the wrapper elsewhere via
  // appendChild below, that removeChild throws "not a child of this
  // node" and React unmounts the ENTIRE sibling subtree — which is
  // exactly the v1.2.16 bug where closing one pane of a 2-pane split
  // collapsed the whole tab. Capture on mount and restore on unmount.
  const reactParentRef = React.useRef(null);

  // Move our wrapper div into the matching tile slot after every render.
  // useLayoutEffect runs after DOM commits and before paint, so users
  // never see a flash at the wrong position. No-op if already attached.
  //
  // v1.2.16: scope the slot lookup to the owning tab div. Pane ids are
  // only unique within a single tab's tree, not across tabs — and
  // already-persisted layouts can contain cross-tab duplicates (e.g.
  // term-1 has pane-2, term-4 also has pane-2). A document-wide
  // querySelector returned the FIRST match in document order, which
  // was almost always the hidden wrong tab and left the visible tab
  // blank. Walk up to the nearest [data-terminal-tab] ancestor and
  // search within it instead.
  React.useLayoutEffect(() => {
    if (!paneId || !wrapperRef.current) return;
    if (!reactParentRef.current) {
      reactParentRef.current = wrapperRef.current.parentElement;
    }
    const tabRoot = wrapperRef.current.closest('[data-terminal-tab]');
    const root = tabRoot || document;
    const slot = root.querySelector(`[data-pane-slot="${paneId}"]`);
    if (slot && wrapperRef.current.parentElement !== slot) {
      slot.appendChild(wrapperRef.current);
    }
  });

  // On unmount, restore the wrapper to React's original parent so
  // React's own removeChild call doesn't trip on "not a child of this
  // node" and tear down the whole sibling tree. Must be useLayoutEffect
  // so the cleanup runs SYNCHRONOUSLY during commit, before React's
  // DOM mutation phase (useEffect cleanup is async and fires too late).
  React.useLayoutEffect(() => {
    return () => {
      const wrapper = wrapperRef.current;
      const parent = reactParentRef.current;
      if (wrapper && parent && wrapper.parentElement !== parent) {
        try { parent.appendChild(wrapper); } catch { /* ignore */ }
      }
    };
  }, []);

  React.useEffect(() => {
    disposedRef.current = false;
    reconnectCountRef.current = 0;
    ptyIdNotFoundRef.current = false;
    // Guard against SSR / early mount where globals aren't loaded yet.
    if (typeof window === 'undefined' || !window.Terminal) {
      console.warn('[pty] xterm.js not loaded yet');
      setStatus('error');
      setError('xterm.js not loaded');
      return;
    }

    const Terminal = window.Terminal;
    const FitAddon = window.FitAddon && window.FitAddon.FitAddon;
    const WebLinksAddon = window.WebLinksAddon && window.WebLinksAddon.WebLinksAddon;

    const term = new Terminal({
      convertEol: false,  // pywinpty already emits \r\n; no double-conversion
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: '#0a0907',
        foreground: '#e8e4dc',
        cursor: '#d7a24a',
        selectionBackground: 'rgba(215, 162, 74, 0.35)',
      },
      scrollback: 5000,
      allowProposedApi: true,
    });
    termRef.current = term;

    const fit = FitAddon ? new FitAddon() : null;
    if (fit) {
      term.loadAddon(fit);
      fitRef.current = fit;
    }
    if (WebLinksAddon) term.loadAddon(new WebLinksAddon());

    term.open(hostRef.current);
    if (fit) {
      try { fit.fit(); } catch (e) { console.warn('[pty] initial fit failed', e); }
    }

    // Use wsRef so send always targets the current socket after reconnects
    const send = (obj) => {
      if (disposedRef.current) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify(obj));
    };

    // Ctrl+C with a selection → copy to clipboard (don't send SIGINT).
    // Ctrl+V → paste clipboard text into the PTY.
    // Ctrl+Shift+C / Ctrl+Shift+V remain available as always-copy / always-paste.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (!ctrl || ev.shiftKey || ev.altKey) return true;

      if (ev.key === 'c' && term.hasSelection()) {
        const text = term.getSelection();
        if (text) {
          navigator.clipboard.writeText(text).catch(() => {
            const ta = Object.assign(document.createElement('textarea'), {
              value: text,
            });
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch {}
            document.body.removeChild(ta);
          });
        }
        return false; // consumed — do NOT send SIGINT to PTY
      }

      if (ev.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text && !disposedRef.current) send({ type: 'input', data: text });
        }).catch(() => {});
        return false; // consumed — do NOT send 0x16 to PTY
      }

      return true;
    });

    function openWs() {
      const ws = new WebSocket(ptyWsUrl());
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        const cols = term.cols;
        const rows = term.rows;
        // Reattach if we have a ptyId; fresh spawn otherwise (strip ptyId field)
        if (spawn && spawn.ptyId) {
          const msg = { type: 'spawn', ptyId: spawn.ptyId, cols, rows };
          console.log('[pty] → spawn (reattach)', msg);
          ws.send(JSON.stringify(msg));
        } else {
          // Strip any ptyId from a prior session — this is a fresh spawn
          const spawnMsg = { type: 'spawn', cols, rows };
          if (spawn) {
            const { ptyId: _ignored, ...rest } = spawn;
            Object.assign(spawnMsg, rest);
          }
          console.log('[pty] → spawn', spawnMsg);
          ws.send(JSON.stringify(spawnMsg));
        }
      });

      ws.addEventListener('message', (ev) => {
        if (disposedRef.current) return;
        let msg;
        try { msg = JSON.parse(ev.data); }
        catch { console.warn('[pty] non-JSON frame', ev.data); return; }
        console.log('[pty] ← ', msg.type, msg);
        switch (msg.type) {
          case 'ready': {
            setStatus('ready');
            onReady && onReady(msg.id);
            onPtyReady && onPtyReady(msg.id);
            reconnectCountRef.current = 0;

            // v1.1.0 (#47): shell-wrap session tabs. If this pane was
            // opened via "In viewer" on a session, it spawned a shell
            // (cmd.exe) in the session's cwd — NOT `claude --resume`
            // directly. Here we type the resume command into the shell
            // so claude takes over the PTY. When the user later runs
            // `/exit`, claude quits and the shell prompt returns — the
            // tab stays alive and reusable.
            const autoResume = spawn?._autoResume;
            if (
              autoResume?.sessionId
              && msg.id
              && !window._autoResumeTyped.has(msg.id)
            ) {
              window._autoResumeTyped.add(msg.id);
              // Wait ~1.2s for the shell prompt to render. Then type the
              // command character-by-character (chunked) so Ink-TUI
              // doesn't mistake it for a paste block. Trailing Enter is
              // a SEPARATE frame for the same reason.
              (async () => {
                await new Promise((r) => setTimeout(r, 1200));
                if (disposedRef.current) return;
                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                const cmd = `claude --dangerously-skip-permissions --resume ${autoResume.sessionId}`;
                await typeIntoPty((o) => send(o), cmd);
                if (disposedRef.current) return;
                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                send({ type: 'input', data: '\r' });
              })();
            }

            // Restart-ping: if this PTY is the resume for a session that was
            // restored from persisted layout (i.e. the viewer just booted),
            // and we haven't pinged that session yet this boot, write the
            // "SOFTWARE RESTARTED" message after a longer delay so the
            // shell has run `claude --resume` AND claude has finished its
            // startup handshake.
            // Accepts either the legacy session spawn shape (spawn.sessionId,
            // pre-v1.1.0) or the shell-wrap shape (spawn._autoResume.sessionId).
            const sid = spawn?._autoResume?.sessionId || spawn?.sessionId;
            if (
              sid
              && window._restartPingPending.has(sid)
              && !window._restartPingFired.has(sid)
            ) {
              window._restartPingFired.add(sid);
              window._restartPingPending.delete(sid);
              setTimeout(() => {
                if (disposedRef.current) return;
                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                // CRITICAL: send text FIRST, wait, then Enter as a SEPARATE
                // WS frame. If we send text+\r together, Ink-TUI treats it
                // as bracketed paste — the trailing \r gets interpreted as
                // "confirm current menu option" (v1.0.0 bug where this
                // auto-picked "compact summary" on the resume-choice menu)
                // AND the ping text lands in the chat input unsent.
                send({ type: 'input', data: RESTART_PING_TEXT });
                setTimeout(() => {
                  if (disposedRef.current) return;
                  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                  send({ type: 'input', data: '\r' });
                }, 500);
              }, RESTART_PING_DELAY_MS);
            }
            break;
          }
          case 'output': {
            const data = msg.data || '';
            term.write(data);
            // Auto-select "Resume full session as-is" if Claude Code asks.
            // Send digit `2` — Ink's select component takes that as a
            // one-keystroke pick for the 2nd option. Deduped per sessionId
            // per viewer boot. Supports both the legacy spawn shape
            // (spawn.sessionId) and v1.1.0 shell-wrap (spawn._autoResume.
            // sessionId) so the auto-pick fires regardless of which path
            // seeded the pane.
            const sid = spawn?._autoResume?.sessionId || spawn?.sessionId;
            if (
              sid
              && typeof data === 'string'
              && data.includes(RESUME_PROMPT_MARKER)
              && !window._resumePromptHandled.has(sid)
            ) {
              window._resumePromptHandled.add(sid);
              // Small delay so the prompt is fully rendered before we
              // answer — firing input before Ink finishes laying out the
              // options can be dropped.
              setTimeout(() => {
                if (disposedRef.current) return;
                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                send({ type: 'input', data: RESUME_PROMPT_PICK_FULL });
              }, 400);
            }
            break;
          }
          case 'exit':
            setStatus('exited');
            onExit && onExit(msg.code);
            // Leave the terminal visible but disable input — user can see
            // the final output of a crashed shell.
            break;
          case 'error':
            // If the ptyId we tried to reattach to no longer exists,
            // signal the parent so it can clear the ptyId and retry a
            // fresh spawn. Don't set error status here — the effect will
            // rerun once spawn is updated.
            if (spawn && spawn.ptyId && String(msg.message || '').includes('not found')) {
              ptyIdNotFoundRef.current = true;
              onPtyReady && onPtyReady(null);
              return;
            }
            setStatus('error');
            setError(String(msg.message || 'server error'));
            break;
        }
      });

      ws.addEventListener('error', (ev) => {
        if (disposedRef.current) return;
        console.error('[pty] ws error', ev);
        // Don't set error here — the close handler will fire next and
        // decide whether to reconnect or mark as exited.
      });

      ws.addEventListener('close', (ev) => {
        if (ptyIdNotFoundRef.current) return; // effect will rerun after spawn update
        if (disposedRef.current) return;
        console.log('[pty] ws closed', ev.code, ev.reason);
        if (statusRef.current === 'exited') return;
        if (window._daemonToken && reconnectCountRef.current < 8) {
          reconnectCountRef.current += 1;
          setStatus('connecting');
          setTimeout(openWs, 2000);
        } else {
          setStatus('exited');
        }
      });
    }

    // Forward keystrokes → server
    const inputDisp = term.onData((data) => {
      send({ type: 'input', data });
    });

    // Forward resize events → server (debounced — xterm can fire many in
    // quick succession when the container grows).
    let resizeTimer = null;
    const resizeDisp = term.onResize(({ cols, rows }) => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        send({ type: 'resize', cols, rows });
      }, 40);
    });

    // Container resize → fit.fit() → term.onResize fires → we ship
    const ro = new ResizeObserver(() => {
      if (fitRef.current) {
        try { fitRef.current.fit(); } catch {}
      }
    });
    ro.observe(hostRef.current);

    openWs();

    return () => {
      disposedRef.current = true;
      try { ro.disconnect(); } catch {}
      try { inputDisp.dispose(); resizeDisp.dispose(); } catch {}
      try {
        const ws = wsRef.current;
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          ws.close(1000, 'pane-unmount');
        }
      } catch {}
      try { term.dispose(); } catch {}
      wsRef.current = null;
      termRef.current = null;
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps  — spawn change should remount
  }, [JSON.stringify(spawn)]);

  // Status ribbon — tiny, non-intrusive.
  const ribbon = (() => {
    if (status === 'ready') return null;
    if (status === 'connecting') return <div style={ribbonStyle('#d7a24a')}>connecting…</div>;
    if (status === 'exited') return <div style={ribbonStyle('#7a7366')}>session exited</div>;
    if (status === 'error') return <div style={ribbonStyle('#c85a5a')}>error: {error || 'unknown'}</div>;
    return null;
  })();

  return (
    <div
      ref={wrapperRef}
      className={className || ''}
      style={{
        position: 'relative', width: '100%', height: '100%',
        minHeight: 240, background: '#0a0907', padding: 8, borderRadius: 8,
      }}
    >
      {ribbon}
      <div ref={hostRef} style={{ position: 'absolute', inset: 8 }}/>
    </div>
  );
}

function ribbonStyle(color) {
  return {
    position: 'absolute', top: 6, right: 10, zIndex: 2,
    padding: '2px 8px', fontSize: 11, borderRadius: 4,
    background: 'rgba(10,9,7,0.7)', color, border: `1px solid ${color}33`,
    fontFamily: '"JetBrains Mono", monospace',
  };
}

window.TerminalPane = TerminalPane;
