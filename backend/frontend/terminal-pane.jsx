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
// Down-arrow + Enter moves from option 1 to option 2 and confirms. Plain
// "2\r" also works in most Ink-TUI builds, but arrow+enter is the
// universally-accepted navigation that matches what Claude Code's own
// docs demonstrate.
const RESUME_PROMPT_PICK_FULL = '\x1b[B\r';
// Dedupe across re-renders of the same pane: once a session has been
// auto-answered this boot, any later output still showing the prompt
// text (e.g. scrollback) shouldn't re-send.
if (!window._resumePromptHandled) window._resumePromptHandled = new Set();
const RESTART_PING_DELAY_MS = 5000;  // wait for claude --resume prompt

function TerminalPane({ spawn, onExit, onReady, className }) {
  // `spawn` — object passed as the first WS frame. Shape:
  //   { cmd: ["cmd.exe"] }                // ad-hoc shell
  //   { provider: "claude-code", sessionId: "<uuid>" }  // resume
  const hostRef = React.useRef(null);
  const termRef = React.useRef(null);
  const wsRef = React.useRef(null);
  const fitRef = React.useRef(null);
  const disposedRef = React.useRef(false);
  const [status, setStatus] = React.useState('connecting'); // connecting|ready|exited|error
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    disposedRef.current = false;
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

    const ws = new WebSocket(ptyWsUrl());
    wsRef.current = ws;

    const send = (obj) => {
      if (disposedRef.current) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(obj));
    };

    ws.addEventListener('open', () => {
      const cols = term.cols;
      const rows = term.rows;
      const first = { type: 'spawn', cols, rows, ...spawn };
      console.log('[pty] → spawn', first);
      send(first);
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
          // Restart-ping: if this PTY is the resume for a session that was
          // restored from persisted layout (i.e. the viewer just booted),
          // and we haven't pinged that session yet this boot, write the
          // "SOFTWARE RESTARTED" message after a short delay so claude
          // --resume has time to finish its startup handshake and show the
          // prompt. The delay is a heuristic — prompt-idle detection would
          // be more robust but adds substantial complexity for marginal
          // gain.
          const sid = spawn?.sessionId;
          if (
            sid
            && window._restartPingPending.has(sid)
            && !window._restartPingFired.has(sid)
          ) {
            window._restartPingFired.add(sid);
            window._restartPingPending.delete(sid);
            setTimeout(() => {
              if (disposedRef.current) return;
              if (!ws || ws.readyState !== WebSocket.OPEN) return;
              send({ type: 'input', data: RESTART_PING_TEXT + '\r' });
            }, RESTART_PING_DELAY_MS);
          }
          break;
        }
        case 'output': {
          const data = msg.data || '';
          term.write(data);
          // Auto-select "Resume full session as-is" if Claude Code asks.
          // Default cursor is on option 1 (summary); we send down-arrow +
          // Enter to pick option 2. Deduped per sessionId per viewer boot.
          const sid = spawn?.sessionId;
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
              if (!ws || ws.readyState !== WebSocket.OPEN) return;
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
          setStatus('error');
          setError(String(msg.message || 'server error'));
          break;
      }
    });

    ws.addEventListener('error', (ev) => {
      if (disposedRef.current) return;
      console.error('[pty] ws error', ev);
      setStatus('error');
      setError('websocket error');
    });

    ws.addEventListener('close', (ev) => {
      if (disposedRef.current) return;
      console.log('[pty] ws closed', ev.code, ev.reason);
      if (status !== 'exited' && status !== 'error') {
        setStatus('exited');
      }
    });

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

    return () => {
      disposedRef.current = true;
      try { ro.disconnect(); } catch {}
      try { inputDisp.dispose(); resizeDisp.dispose(); } catch {}
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
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
