// Real data source — replaces the mock from the design.
// Fetches sessions from the FastAPI backend and subscribes to SSE live updates.

const API = ''; // same origin (backend serves this page at /)

async function apiJson(path, opts) {
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}

// Maps a server session to the shape consumed by the UI.
// Server already returns the exact schema; we just ensure defaults.
function normalize(s) {
  return {
    id: s.id,
    title: s.title || '(untitled)',
    label: s.label || null,
    userLabel: s.userLabel || null,
    cwd: s.cwd || '',
    branch: s.branch || '-',
    model: s.model || 'claude',
    createdAt: s.createdAt || Date.now(),
    lastActive: s.lastActive || Date.now(),
    messageCount: s.messageCount || 0,
    tokens: s.tokens || 0,
    active: !!s.active,
    activityLabel: s.activityLabel || null,
    firstUserMessages: s.firstUserMessages || [],
    transcript: s.transcript || [],
  };
}

async function generateLabel(id) {
  try {
    await fetch(`/api/sessions/${id}/label/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (e) {}
}

async function setUserLabel(id, userLabel) {
  try {
    const r = await fetch(`/api/sessions/${id}/label`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userLabel }),
    });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

async function fetchStatus() {
  try { return await apiJson('/api/status'); } catch { return null; }
}

async function fetchInitialSessions() {
  try {
    const data = await apiJson('/api/sessions?limit=50000');
    return (data.items || []).map(normalize);
  } catch (e) {
    console.error('fetch sessions failed', e);
    return [];
  }
}

async function fetchTranscript(id) {
  try {
    const data = await apiJson(`/api/sessions/${id}/transcript?limit=400`);
    return data.messages || [];
  } catch (e) {
    console.error('transcript failed', e);
    return [];
  }
}

async function fetchPreview(id) {
  try {
    return normalize(await apiJson(`/api/sessions/${id}/preview`));
  } catch (e) {
    return null;
  }
}

async function openSession(id, mode) {
  try {
    const url = mode === 'focus' ? '/api/focus' : '/api/open';
    const body = mode === 'focus' ? { sessionId: id } : { sessionId: id, mode };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) { console.error('open failed', e); }
}

// Bus compatible with the original design contract:
// subscribe(fn) -> fn(ev, list)   events: init, session_created, session_activity, session_ended
// start(), stop()
function createSessionBus() {
  let sessions = [];
  const listeners = new Set();
  let es = null;
  let running = false;

  const emit = (ev) => listeners.forEach((l) => l(ev, [...sessions]));

  function upsert(s) {
    const i = sessions.findIndex((x) => x.id === s.id);
    const normalized = normalize({ ...s });
    if (i >= 0) {
      // preserve transcript if present
      normalized.transcript = sessions[i].transcript || [];
      normalized.firstUserMessages = normalized.firstUserMessages.length
        ? normalized.firstUserMessages : sessions[i].firstUserMessages;
      sessions[i] = normalized;
    } else {
      sessions.unshift(normalized);
    }
    return { index: i, session: normalized };
  }

  function openSSE() {
    if (es || !running) return;
    es = new EventSource('/api/stream');
    es.addEventListener('session', (e) => {
      try {
        const ev = JSON.parse(e.data);
        const { index } = upsert(ev.session);
        if (ev.type === 'session_created' && index < 0) {
          emit({ type: 'session_created', session: normalize(ev.session) });
        } else {
          emit({ type: 'session_activity', id: ev.session.id });
        }
      } catch (err) { console.error(err); }
    });
    es.onerror = () => { /* browser auto-reconnects */ };
  }
  function closeSSE() { if (es) { es.close(); es = null; } }

  return {
    subscribe(fn) {
      listeners.add(fn);
      fn({ type: 'init' }, [...sessions]);
      // Poll index progress until ready, then fetch sessions
      (async () => {
        let ready = false;
        for (let i = 0; i < 600 && !ready; i++) {
          const st = await fetchStatus();
          if (st) {
            emit({ type: 'loading_progress', status: st });
            if (st.ready) ready = true;
          }
          if (!ready) await new Promise((r) => setTimeout(r, 400));
        }
        const list = await fetchInitialSessions();
        sessions = list;
        emit({ type: 'loading_done' });
        emit({ type: 'init' });
      })();
      return () => listeners.delete(fn);
    },
    start() { if (running) return; running = true; openSSE(); },
    stop()  { running = false; closeSSE(); },
    async loadTranscript(id) {
      const msgs = await fetchTranscript(id);
      const s = sessions.find((x) => x.id === id);
      if (s) { s.transcript = msgs; emit({ type: 'session_activity', id }); }
      return msgs;
    },
    async loadPreview(id) {
      const p = await fetchPreview(id);
      if (p) {
        const s = sessions.find((x) => x.id === id);
        if (s) {
          s.firstUserMessages = p.firstUserMessages;
          emit({ type: 'session_activity', id });
        }
      }
    },
  };
}

// Stub so existing design import still resolves
function makeInitialSessions() { return []; }

Object.assign(window, { makeInitialSessions, createSessionBus, openSession, fetchTranscript, fetchPreview, generateLabel, setUserLabel });
