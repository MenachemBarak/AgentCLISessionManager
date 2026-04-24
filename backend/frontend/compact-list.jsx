// Compact session list — tuned for narrow (25% width) left pane

const { useState: useStateCL, useEffect: useEffectCL, useMemo: useMemoCL, useRef: useRefCL } = React;

function CompactSearch({ value, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 10px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 7,
      color: 'rgba(255,255,255,0.5)',
    }}>
      <IconSearch size={12} stroke={1.8}/>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        data-testid="session-search-input"
        placeholder="Search sessions…  (press /)"
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          color: 'rgba(255,255,255,0.92)', fontFamily: 'inherit', fontSize: 12,
          minWidth: 0,
        }}/>
      {value && (
        <button onClick={() => onChange('')}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.4)', padding: 0, display: 'flex',
          }}>
          <IconClose size={11}/>
        </button>
      )}
    </div>
  );
}

function CompactDropdown({ value, options, onChange, label }) {
  const [open, setOpen] = useStateCL(false);
  const ref = useRefCL(null);
  useEffectCL(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', padding: '5px 8px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
          fontFamily: 'inherit', fontSize: 11,
          color: 'rgba(255,255,255,0.85)',
        }}>
        <span style={{
          fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.6,
          color: 'rgba(255,255,255,0.4)', fontWeight: 600,
        }}>{label}</span>
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, textAlign: 'left',
        }}>{current?.label}</span>
        <IconChevron size={11}/>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'rgba(28,24,20,0.98)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 7, padding: 4,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 30, backdropFilter: 'blur(20px)',
        }}>
          {options.map((o) => (
            <button key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              style={{
                width: '100%', padding: '6px 8px',
                background: o.value === value ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: 'none', borderRadius: 4, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 11.5, textAlign: 'left',
                color: 'rgba(255,255,255,0.85)',
              }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PinStar({ session, accent, visible }) {
  // Optimistic toggle — flip local state immediately so the click feels
  // instant; on API failure the next /api/sessions poll corrects it.
  const [optimistic, setOptimistic] = useStateCL(null);
  const pinned = optimistic !== null ? optimistic : !!session.pinned;
  if (!visible && !pinned) return null;
  const onClick = async (e) => {
    e.stopPropagation();
    const next = !pinned;
    setOptimistic(next);
    try {
      await fetch(`/api/sessions/${session.id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      });
    } catch {
      setOptimistic(!next);
    }
  };
  return (
    <button
      onClick={onClick}
      data-testid={`session-pin-${session.id.slice(0, 8)}`}
      title={pinned ? 'Unpin session' : 'Pin session to top'}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: '2px 4px', lineHeight: 1,
        color: pinned ? accent : 'rgba(255,255,255,0.35)',
        fontSize: 13,
      }}>{pinned ? '★' : '☆'}</button>
  );
}

function CompactRow({ session, accent, selected, onSelect, onOpen, onHover, onLeave, isNew }) {
  const [hover, setHover] = useStateCL(false);
  const ref = useRefCL(null);
  const sid8 = session.id.slice(0, 8);
  // When a terminal tab focuses us and `selected` flips on, auto-scroll
  // into view so the user can see what's been highlighted in a long list.
  // Uses `block: 'nearest'` to avoid jarring jumps when the row is already
  // on screen. Guarded by `selected` so clicking other rows doesn't
  // re-scroll each one individually.
  React.useEffect(() => {
    if (!selected || !ref.current) return;
    try {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
      // scrollIntoView options are only partially supported on older
      // webviews — the plain form still works.
      try { ref.current.scrollIntoView(); } catch {}
    }
  }, [selected]);
  return (
    <div
      ref={ref}
      data-testid={`session-row-${sid8}`}
      className={isNew ? 'row-enter' : ''}
      onClick={() => onSelect(session)}
      onMouseEnter={(e) => { setHover(true); onHover?.(session, ref.current); }}
      onMouseLeave={() => { setHover(false); onLeave?.(); }}
      style={{
        padding: '10px 12px',
        borderLeft: `2px solid ${selected ? accent : 'transparent'}`,
        background: selected ? 'rgba(255,255,255,0.045)'
          : hover ? 'rgba(255,255,255,0.025)' : 'transparent',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 4,
        borderBottom: '1px solid rgba(255,255,255,0.035)',
        position: 'relative',
        transition: 'background 100ms',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {session.active
          ? <PulseDot color={accent}/>
          : <IconDot size={6} color="rgba(255,255,255,0.22)"/>}
        <div style={{
          fontSize: 12.5, fontWeight: 500,
          color: 'rgba(255,255,255,0.94)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, minWidth: 0,
        }} title={session.title}>
          <RowTitle session={session} accent={accent}/>
        </div>
        <PinStar session={session} accent={accent} visible={hover || session.pinned}/>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10, color: 'rgba(255,255,255,0.4)',
        paddingLeft: 14,
      }}>
        {session.active && (
          <>
            <span style={{
              color: accent, textTransform: 'uppercase', letterSpacing: 0.5,
              fontWeight: 600, fontSize: 9.5,
            }}>{session.activityLabel}</span>
            <span style={{ opacity: 0.35 }}>·</span>
          </>
        )}
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, minWidth: 0,
        }}>{session.cwd}</span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span style={{ flexShrink: 0 }}>{formatRelative(session.lastActive)}</span>
      </div>
      <div style={{
        display: 'flex', gap: 4, paddingLeft: 14, marginTop: 2,
        opacity: hover || selected ? 1 : 0,
        transition: 'opacity 100ms',
        pointerEvents: hover || selected ? 'auto' : 'none',
      }}>
        {session.active ? (
          <IconBtn label="Focus" onClick={(e) => { e.stopPropagation(); onOpen(session, 'focus'); }} Icon={IconFocus}/>
        ) : (
          <>
            <IconBtn label="New tab" onClick={(e) => { e.stopPropagation(); onOpen(session, 'tab'); }} Icon={IconNewTab}/>
            <IconBtn label="Split" onClick={(e) => { e.stopPropagation(); onOpen(session, 'split'); }} Icon={IconSplit}/>
            {/* "In viewer" spawns the session inside an embedded terminal
                tab in the right pane instead of a Windows Terminal window.
                Uses the provider's `resume_command` via /api/pty/ws. */}
            <IconBtn label="In viewer" onClick={(e) => { e.stopPropagation(); onOpen(session, 'in-viewer'); }} Icon={IconNewTab}/>
          </>
        )}
        <span style={{ flex: 1 }}/>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5,
          color: 'rgba(255,255,255,0.35)',
        }}>{session.messageCount} msg</span>
      </div>
    </div>
  );
}

function stripSidSuffix(s, id) {
  if (!s || !id) return null;
  const sid8 = id.slice(0, 8);
  // Strip the hook's " · <sid>" suffix (partial or full UUID).
  const stripped = s.replace(new RegExp(`\\s*·\\s*${sid8}.*$`), '').trim();
  // Ignore titles that are our hook's placeholder (cc-<uuid>) — the user
  // didn't actually customize those; fall back to the first user message.
  if (!stripped) return null;
  if (/^cc-[0-9a-f]{8}/i.test(stripped)) return null;
  return stripped;
}

function RowTitle({ session, accent }) {
  const [editing, setEditing] = useStateCL(false);
  const [value, setValue] = useStateCL(session.userLabel || '');
  const [hover, setHover] = useStateCL(false);
  const inputRef = useRefCL(null);
  useEffectCL(() => {
    if (editing) {
      setValue(session.userLabel || '');
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing]);
  async function save() {
    const v = value.trim();
    setEditing(false);
    if ((v || null) !== (session.userLabel || null)) {
      await window.saveUserLabel(session.id, v || null);
    }
  }
  if (editing) {
    return (
      <input
        ref={inputRef} value={value}
        data-testid={`title-input-${session.id.slice(0,8)}`}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') save();
          else if (e.key === 'Escape') setEditing(false);
        }}
        placeholder={`cc-${session.id.slice(0,8)}`}
        style={{
          flex: 1, minWidth: 0,
          background: 'rgba(0,0,0,0.35)',
          border: `1px solid ${accent}55`,
          outline: `2px solid ${accent}44`,
          borderRadius: 4,
          padding: '2px 6px',
          color: 'rgba(255,255,255,0.95)',
          fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500,
        }}/>
    );
  }
  // Display priority: user-set label > Claude's /rename > first user message.
  const display = session.userLabel || stripSidSuffix(session.claudeTitle, session.id);
  const isUserSet = !!session.userLabel;
  return (
    <span
      data-testid={`title-${session.id.slice(0,8)}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, cursor: 'text' }}>
      {display ? (
        <>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: isUserSet ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.94)',
            borderBottom: isUserSet ? `1px dotted ${accent}88` : 'none',
          }}>{display}</span>
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 10, color: 'rgba(255,255,255,0.35)', flexShrink: 0,
          }}>· {session.id.slice(0, 8)}</span>
          {hover && (
            <span style={{
              fontSize: 9.5, color: accent, opacity: 0.7, flexShrink: 0,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>edit</span>
          )}
        </>
      ) : (
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: 'rgba(255,255,255,0.94)',
        }}>{session.title}</span>
      )}
    </span>
  );
}

function IconBtn({ label, onClick, Icon, testid }) {
  const [hover, setHover] = useStateCL(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={label}
      data-testid={testid || `rowbtn-${String(label || '').toLowerCase().replace(/\s+/g, '-')}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 3,
        padding: '3px 7px',
        background: hover ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        color: 'rgba(255,255,255,0.75)',
        fontFamily: 'inherit', fontSize: 10, fontWeight: 500,
        cursor: 'pointer', transition: 'all 80ms',
      }}>
      <Icon size={10} stroke={1.8}/>
      {label}
    </button>
  );
}

function ActiveSectionCompact({ active, accent, selectedId, onSelect, onOpen, onHover, onLeave, recentlyCreated }) {
  const groups = useMemoCL(() => groupByCwd(active), [active]);
  const [rescanning, setRescanning] = useStateCL(false);
  const handleRescan = async (e) => {
    e.stopPropagation();
    setRescanning(true);
    try {
      await fetch('/api/rescan', { method: 'POST' });
    } catch {}
    setTimeout(() => setRescanning(false), 600);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SectionHeader
        label={`Active · ${active.length}`}
        right={
          <span style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9.5, color: 'rgba(255,255,255,0.35)',
          }}>
            <button onClick={handleRescan}
              disabled={rescanning}
              data-testid="rescan-btn"
              title="Rescan sessions & remove stale active markers"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.55)',
                fontFamily: 'inherit', fontSize: 9.5,
                padding: '1px 6px', borderRadius: 3,
                cursor: rescanning ? 'default' : 'pointer',
                opacity: rescanning ? 0.4 : 1,
              }}>
              {rescanning ? '…' : 'rescan'}
            </button>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <PulseDot color="#4ade80"/>
              live
            </span>
          </span>
        }
      />
      {active.length === 0 ? (
        <div style={{
          padding: '14px 14px', fontSize: 11,
          color: 'rgba(255,255,255,0.3)',
        }}>No sessions running.</div>
      ) : groups.map(([folder, list]) => (
        <React.Fragment key={folder}>
          <FolderHeading folder={folder} count={list.length}/>
          {list.map((s) => (
            <CompactRow key={s.id} session={s} accent={accent}
              selected={selectedId === s.id} isNew={recentlyCreated.has(s.id)}
              onSelect={onSelect} onOpen={onOpen}
              onHover={onHover} onLeave={onLeave}/>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function groupByCwd(list) {
  const map = new Map();
  for (const s of list) {
    const key = s.cwd || '(unknown)';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  // Group order: any folder containing a pinned session floats to the
  // top regardless of recency; within each pinned/unpinned bucket sort
  // by the group's most-recent lastActive.
  return [...map.entries()].sort((a, b) => {
    const aPinned = a[1].some((s) => s.pinned) ? 1 : 0;
    const bPinned = b[1].some((s) => s.pinned) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    const ma = Math.max(...a[1].map((s) => s.lastActive));
    const mb = Math.max(...b[1].map((s) => s.lastActive));
    return mb - ma;
  });
}

function basename(p) {
  if (!p) return '(unknown)';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

function FolderHeading({ folder, count }) {
  return (
    <div style={{
      padding: '8px 14px 4px', display: 'flex', alignItems: 'center', gap: 8,
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: 10, color: 'rgba(255,255,255,0.55)',
      background: 'rgba(255,255,255,0.02)',
      borderTop: '1px solid rgba(255,255,255,0.035)',
    }} title={folder}>
      <IconFolder size={10}/>
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
      }}>{basename(folder)}</span>
      <span style={{ opacity: 0.5 }}>{count}</span>
    </div>
  );
}

function FolderFilter({ folderCounts, folderFilter, setFolderFilter }) {
  const [open, setOpen] = useStateCL(false);
  const entries = useMemoCL(() => [...folderCounts.entries()].sort((a, b) => b[1] - a[1]), [folderCounts]);
  if (!entries.length) return null;
  const total = entries.length;
  const selected = entries.filter(([f]) => folderFilter.has(f)).length;
  function toggle(f) {
    const next = new Set(folderFilter);
    if (next.has(f)) next.delete(f); else next.add(f);
    setFolderFilter(next);
  }
  function setAll(v) {
    setFolderFilter(v ? new Set(entries.map(([f]) => f)) : new Set());
  }
  function only(f) {
    const next = new Set([f]);
    next.__seen = new Set(entries.map(([x]) => x));
    setFolderFilter(next);
  }
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        width: '100%', padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'rgba(255,255,255,0.75)', fontFamily: 'inherit',
        fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1,
      }}>
        <IconChevron size={11} style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }}/>
        <span>Folders</span>
        <span style={{ flex: 1 }}/>
        <span style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
          {selected}/{total}
        </span>
      </button>
      {open && (
        <div style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 8px 8px' }}>
          <div style={{ display: 'flex', gap: 6, padding: '4px 4px 8px' }}>
            <button onClick={() => setAll(true)} style={miniBtn}>All</button>
            <button onClick={() => setAll(false)} style={miniBtn}>None</button>
          </div>
          {entries.map(([folder, count]) => {
            const checked = folderFilter.has(folder);
            return (
              <FolderRow key={folder} folder={folder} count={count}
                checked={checked} onToggle={() => toggle(folder)} onOnly={() => only(folder)}/>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FolderRow({ folder, count, checked, onToggle, onOnly }) {
  const [hover, setHover] = useStateCL(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px',
        fontSize: 11, color: 'rgba(255,255,255,0.8)',
        borderRadius: 4,
        background: hover ? 'rgba(255,255,255,0.04)' : 'transparent',
      }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
        cursor: 'pointer',
      }}>
        <input type="checkbox" checked={checked} onChange={onToggle} style={{ margin: 0 }}/>
        <span title={folder} style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 10.5,
        }}>{basename(folder)}</span>
      </label>
      <button onClick={(e) => { e.stopPropagation(); onOnly(); }}
        title={`Show only ${basename(folder)}`}
        style={{
          padding: '2px 7px',
          background: hover ? 'rgba(215,162,74,0.18)' : 'transparent',
          border: '1px solid ' + (hover ? 'rgba(215,162,74,0.4)' : 'transparent'),
          borderRadius: 3,
          color: hover ? '#d7a24a' : 'rgba(255,255,255,0.35)',
          fontFamily: 'inherit', fontSize: 9.5, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 0.5,
          cursor: 'pointer', transition: 'all 100ms',
        }}>only</button>
      <span style={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10, color: count > 1000 ? '#e47a6b' : 'rgba(255,255,255,0.45)',
        minWidth: 38, textAlign: 'right',
      }}>{count}</span>
    </div>
  );
}

const miniBtn = {
  padding: '3px 10px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 4,
  color: 'rgba(255,255,255,0.8)',
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 500,
  cursor: 'pointer',
};

function SectionHeader({ label, right }) {
  return (
    <div style={{
      padding: '10px 14px 6px',
      display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 10, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: 1.2,
      color: 'rgba(255,255,255,0.45)',
      position: 'sticky', top: 0,
      background: 'rgba(20,18,16,0.96)',
      backdropFilter: 'blur(8px)', zIndex: 2,
    }}>
      <span>{label}</span>
      <span style={{ flex: 1 }}/>
      {right}
    </div>
  );
}

function CompactList({ sessions, accent, selectedId, onSelect, sort, setSort, query, setQuery,
                      dateRange, setDateRange, statusFilter, setStatusFilter,
                      recentlyCreated, onOpen, onHover, onLeave }) {
  // Refresh relative times
  const [, force] = useStateCL(0);
  useEffectCL(() => {
    const i = setInterval(() => force((x) => x + 1), 2000);
    return () => clearInterval(i);
  }, []);

  // Folder counts over all sessions (pre-filter)
  const folderCounts = useMemoCL(() => {
    const m = new Map();
    for (const s of sessions) {
      const k = s.cwd || '(unknown)';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [sessions]);

  // Folder filter: all checked by default, except folders with >1000 sessions.
  const [folderFilter, setFolderFilter] = useStateCL(null);
  const initializedFoldersRef = useRefCL(false);
  useEffectCL(() => {
    if (initializedFoldersRef.current) {
      // Keep newly-appeared folders checked unless big; preserve user toggles
      setFolderFilter((prev) => {
        if (!prev) return prev;
        const next = new Set(prev);
        for (const [f, count] of folderCounts) {
          if (!next.has(f) && count <= 1000 && !prev.__seen?.has(f)) {
            next.add(f);
          }
        }
        next.__seen = new Set(folderCounts.keys());
        return next;
      });
      return;
    }
    if (folderCounts.size === 0) return;
    const init = new Set();
    for (const [f, count] of folderCounts) {
      if (count <= 1000) init.add(f);
    }
    init.__seen = new Set(folderCounts.keys());
    setFolderFilter(init);
    initializedFoldersRef.current = true;
  }, [folderCounts]);

  // Smart search (task #40): when query has 2+ tokens, hit /api/search
  // for TF-weighted ranking. Single-token and empty queries keep the
  // instant local substring filter — zero-latency typing UX. The API
  // call is debounced 250ms so per-keystroke fetches don't hammer the
  // backend; we retain the previous result during pending fetches so
  // the list doesn't flicker.
  const [smartIds, setSmartIds] = useStateCL(null); // Set<string> | null (null = skip smart)
  useEffectCL(() => {
    const q = query.trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      setSmartIds(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=100`);
        if (!r.ok || cancelled) return;
        const body = await r.json();
        const ids = new Set((body.items || []).map((s) => s.id));
        setSmartIds(ids);
      } catch {
        if (!cancelled) setSmartIds(null);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

  // Active sessions bypass folder/date filters — always show ALL running sessions.
  // Search still applies so user can narrow even active.
  const active = useMemoCL(() => {
    const q = query.trim().toLowerCase();
    const useSmart = smartIds !== null;
    return sessions.filter((s) => {
      if (!s.active) return false;
      if (!q) return true;
      if (useSmart) return smartIds.has(s.id);
      return (
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.branch.toLowerCase().includes(q)
      );
    }).sort((a, b) => b.lastActive - a.lastActive);
  }, [sessions, query, smartIds]);

  const idle = useMemoCL(() => {
    const q = query.trim().toLowerCase();
    const useSmart = smartIds !== null;
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    const filteredIdle = sessions.filter((s) => {
      if (s.active) return false;
      if (folderFilter && !folderFilter.has(s.cwd || '(unknown)')) return false;
      if (dateRange === 'today' && now - s.createdAt > dayMs) return false;
      if (dateRange === '7d' && now - s.createdAt > 7 * dayMs) return false;
      if (dateRange === '30d' && now - s.createdAt > 30 * dayMs) return false;
      if (!q) return true;
      if (useSmart) return smartIds.has(s.id);
      return (
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.branch.toLowerCase().includes(q)
      );
    });
    return sortSessions(filteredIdle, sort);
  }, [sessions, query, smartIds, dateRange, folderFilter, sort]);
  const idleGroups = useMemoCL(() => groupByCwd(idle), [idle]);

  // Flat ordered list of visible session IDs in DOM order — powers
  // keyboard navigation (↑/↓). Active section first, then each cwd
  // group in its sort order.
  const visibleIds = useMemoCL(() => {
    const out = [];
    if (statusFilter !== 'idle') for (const s of active) out.push(s.id);
    if (statusFilter !== 'active') {
      for (const [, list] of idleGroups) for (const s of list) out.push(s.id);
    }
    return out;
  }, [active, idleGroups, statusFilter]);

  // Global keyboard nav:
  //   ↑ / ↓    — move selection (within visibleIds)
  //   Enter    — same as a click (onSelect)
  //   /        — focus the search input
  //   Esc      — clear search if focused, else blur
  // Ignored when a text input / contenteditable / xterm has focus so
  // typing a session name doesn't accidentally scroll the list.
  React.useEffect(() => {
    const onKey = (e) => {
      // Let the Ctrl+K palette and the intra-input editing work.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ae = document.activeElement;
      const tag = ae?.tagName;
      const inTextInput =
        tag === 'INPUT' || tag === 'TEXTAREA' || ae?.isContentEditable;
      const inXterm = !!ae?.closest?.('.xterm');
      if (inXterm) return;

      if (e.key === '/') {
        if (inTextInput) return;
        const input = document.querySelector('[data-testid="session-search-input"]');
        if (input) {
          e.preventDefault();
          input.focus();
          input.select?.();
        }
        return;
      }
      if (e.key === 'Escape') {
        const input = document.querySelector('[data-testid="session-search-input"]');
        if (ae === input) {
          e.preventDefault();
          if (input.value) {
            // React controlled input — dispatch input event so setQuery fires.
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            input.blur();
          }
        }
        return;
      }
      if (inTextInput) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (visibleIds.length === 0) return;
        e.preventDefault();
        const i = selectedId ? visibleIds.indexOf(selectedId) : -1;
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        const nextIdx = Math.max(0, Math.min(visibleIds.length - 1, (i < 0 ? 0 : i + dir)));
        const nextId = visibleIds[nextIdx];
        const s = sessions.find((x) => x.id === nextId);
        if (s) onSelect(s);
        return;
      }
      if (e.key === 'Enter') {
        if (inTextInput) return;
        const s = sessions.find((x) => x.id === selectedId);
        if (s) onSelect(s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleIds, selectedId, onSelect, sessions]);

  return (
    <aside style={{
      width: '25%', minWidth: 320, maxWidth: 420,
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(0,0,0,0.12)',
    }}>
      {/* controls */}
      <div style={{
        padding: '12px 12px 10px',
        display: 'flex', flexDirection: 'column', gap: 8,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <CompactSearch value={query} onChange={setQuery}/>
        <div style={{ display: 'flex', gap: 6 }}>
          <CompactDropdown label="Sort" value={sort} onChange={setSort}
            options={[
              { value: 'last_active', label: 'Last active' },
              { value: 'created', label: 'Newest' },
              { value: 'created_asc', label: 'Oldest' },
              { value: 'messages', label: 'Msgs' },
            ]}/>
          <CompactDropdown label="Created" value={dateRange} onChange={setDateRange}
            options={[
              { value: 'any', label: 'All time' },
              { value: 'today', label: 'Today' },
              { value: '7d', label: 'Last 7d' },
              { value: '30d', label: 'Last 30d' },
            ]}/>
        </div>
      </div>

      <FolderFilter folderCounts={folderCounts}
        folderFilter={folderFilter || new Set()}
        setFolderFilter={setFolderFilter}/>

      {/* scrollable list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {statusFilter !== 'idle' && (
          <ActiveSectionCompact active={active} accent={accent}
            selectedId={selectedId} onSelect={onSelect} onOpen={onOpen}
            onHover={onHover} onLeave={onLeave} recentlyCreated={recentlyCreated}/>
        )}
        {statusFilter !== 'active' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <SectionHeader label={`All sessions · ${idle.length}`}/>
            {idle.length === 0 ? (
              <div style={{
                padding: '14px', fontSize: 11, color: 'rgba(255,255,255,0.3)',
              }}>No matches.</div>
            ) : idleGroups.map(([folder, list]) => (
              <React.Fragment key={folder}>
                <FolderHeading folder={folder} count={list.length}/>
                {list.map((s) => (
                  <CompactRow key={s.id} session={s} accent={accent}
                    selected={selectedId === s.id} isNew={recentlyCreated.has(s.id)}
                    onSelect={onSelect} onOpen={onOpen}
                    onHover={onHover} onLeave={onLeave}/>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* status footer — when filters are active, show a "showing X of Y"
          summary so the user can see at a glance when results are being
          hidden (e.g. by a stale search or folder-filter toggle). */}
      <div style={{
        padding: '8px 14px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10, color: 'rgba(255,255,255,0.4)',
      }}>
        <PulseDot color="#4ade80"/>
        <span>~/.claude/sessions</span>
        <span style={{ flex: 1 }}/>
        {(() => {
          const visible = active.length + idle.length;
          const total = sessions.length;
          const filtering = visible < total;
          const clearAll = () => {
            setQuery('');
            setDateRange('any');
            setStatusFilter('all');
            // Reset folder filter to "all folders checked" baseline.
            const allFolders = new Set(folderCounts.keys());
            allFolders.__seen = new Set(folderCounts.keys());
            setFolderFilter(allFolders);
          };
          return (
            <>
              <span data-testid="session-count-footer" style={{
                color: filtering ? 'rgba(215, 162, 74, 0.85)' : 'rgba(255,255,255,0.4)',
              }}>
                {filtering ? `showing ${visible} of ${total}` : `${total} total`}
              </span>
              {filtering && (
                <button
                  data-testid="clear-all-filters"
                  onClick={clearAll}
                  title="Clear search, date range, status filter, and folder filter"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(215, 162, 74, 0.35)',
                    color: 'rgba(215, 162, 74, 0.9)',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 9,
                    textTransform: 'uppercase', letterSpacing: 0.6,
                    padding: '1px 6px', borderRadius: 3,
                    cursor: 'pointer', marginLeft: 6,
                  }}>clear</button>
              )}
            </>
          );
        })()}
      </div>
    </aside>
  );
}

Object.assign(window, { CompactList });
