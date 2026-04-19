// Shared utilities

function formatRelative(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatTokens(t) {
  if (t >= 1000) return `${(t / 1000).toFixed(1)}k`;
  return `${t}`;
}

// sort helpers
function sortSessions(list, mode) {
  const arr = [...list];
  if (mode === 'created') arr.sort((a, b) => b.createdAt - a.createdAt);
  else if (mode === 'created_asc') arr.sort((a, b) => a.createdAt - b.createdAt);
  else if (mode === 'messages') arr.sort((a, b) => b.messageCount - a.messageCount);
  else arr.sort((a, b) => b.lastActive - a.lastActive);
  return arr;
}

Object.assign(window, { formatRelative, formatDate, formatDateTime, formatTokens, sortSessions });
