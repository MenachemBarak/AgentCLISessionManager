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
        placeholder="Search sessions…"
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

function CompactRow({ session, accent, selected, onSelect, onOpen, onHover, onLeave, isNew }) {
  const [hover, setHover] = useStateCL(false);
  const ref = useRefCL(null);
  return (
    <div
      ref={ref}
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
        }}>{session.title}</div>
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

function IconBtn({ label, onClick, Icon }) {
  const [hover, setHover] = useStateCL(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={label}
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SectionHeader
        label={`Active · ${active.length}`}
        right={
          <span style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9.5, color: 'rgba(255,255,255,0.35)',
          }}>
            <PulseDot color="#4ade80"/>
            live
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
  // sort folders by most-recent lastActive in each group
  return [...map.entries()].sort((a, b) => {
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

  // Active sessions bypass folder/date filters — always show ALL running sessions.
  // Search still applies so user can narrow even active.
  const active = useMemoCL(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!s.active) return false;
      if (q && !(
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.branch.toLowerCase().includes(q)
      )) return false;
      return true;
    }).sort((a, b) => b.lastActive - a.lastActive);
  }, [sessions, query]);

  const idle = useMemoCL(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    const filteredIdle = sessions.filter((s) => {
      if (s.active) return false;
      if (folderFilter && !folderFilter.has(s.cwd || '(unknown)')) return false;
      if (dateRange === 'today' && now - s.createdAt > dayMs) return false;
      if (dateRange === '7d' && now - s.createdAt > 7 * dayMs) return false;
      if (dateRange === '30d' && now - s.createdAt > 30 * dayMs) return false;
      if (q && !(
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.branch.toLowerCase().includes(q)
      )) return false;
      return true;
    });
    return sortSessions(filteredIdle, sort);
  }, [sessions, query, dateRange, folderFilter, sort]);
  const idleGroups = useMemoCL(() => groupByCwd(idle), [idle]);

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

      {/* status footer */}
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
        <span>{sessions.length} total</span>
      </div>
    </aside>
  );
}

Object.assign(window, { CompactList });
