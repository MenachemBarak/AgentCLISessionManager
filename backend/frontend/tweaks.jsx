// Tweaks panel + toasts

const { useState: useState_T, useEffect: useEffect_T } = React;

function TweaksPanel({ open, tweaks, setTweaks, onClose }) {
  if (!open) return null;
  const set = (k, v) => setTweaks({ ...tweaks, [k]: v });

  return (
    <div style={{
      position: 'fixed', right: 24, bottom: 24, width: 280,
      zIndex: 100,
      background: 'rgba(22,20,18,0.98)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 12,
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      backdropFilter: 'blur(20px)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <IconCog size={13}/>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4 }}>Tweaks</span>
        <span style={{ flex: 1 }}/>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.5)', padding: 0, display: 'flex',
        }}>
          <IconClose size={13}/>
        </button>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TweakGroup label="Theme">
          <Segmented value={tweaks.theme} onChange={(v) => set('theme', v)} options={[
            { value: 'dark', label: 'Dark' },
            { value: 'warm', label: 'Warm' },
            { value: 'light', label: 'Light' },
          ]}/>
        </TweakGroup>
        <TweakGroup label="Accent">
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { v: 'amber', c: '#d7a24a' },
              { v: 'coral', c: '#e47a6b' },
              { v: 'sage', c: '#8ab078' },
              { v: 'violet', c: '#a189d4' },
              { v: 'sky', c: '#6ca6c9' },
            ].map((o) => (
              <button key={o.v} onClick={() => set('accent', o.v)}
                style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: o.c,
                  border: tweaks.accent === o.v
                    ? '2px solid rgba(255,255,255,0.8)'
                    : '2px solid transparent',
                  cursor: 'pointer', padding: 0,
                }}/>
            ))}
          </div>
        </TweakGroup>
        <TweakGroup label="Density">
          <Segmented value={tweaks.density} onChange={(v) => set('density', v)} options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Cozy' },
            { value: 'spacious', label: 'Roomy' },
          ]}/>
        </TweakGroup>
        <TweakGroup label="Hover preview">
          <Segmented value={tweaks.hoverMode} onChange={(v) => set('hoverMode', v)} options={[
            { value: 'popover', label: 'Popover' },
            { value: 'sidepanel', label: 'Side panel' },
          ]}/>
        </TweakGroup>
        <TweakGroup label="Live activity">
          <Segmented value={tweaks.liveOn ? 'on' : 'off'}
            onChange={(v) => set('liveOn', v === 'on')}
            options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Paused' }]}/>
        </TweakGroup>
        <HookToggle/>
      </div>
    </div>
  );
}

function HookToggle() {
  const [state, setState] = useState_T({ loading: true, installed: false });
  useEffect_T(() => {
    fetch('/api/hook/status').then(r => r.json()).then(s => setState({ loading: false, installed: !!s.installed }));
  }, []);
  async function toggle() {
    setState((s) => ({ ...s, loading: true }));
    const path = state.installed ? '/api/hook/uninstall' : '/api/hook/install';
    const r = await fetch(path, { method: 'POST' }).then(r => r.json());
    setState({ loading: false, installed: !!r.installed });
  }
  return (
    <TweakGroup label="Per-tab focus (hook)">
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        fontSize: 10.5, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4,
      }}>
        <span>Installs a Claude SessionStart hook that stamps tab titles so Focus can switch to the exact Windows Terminal tab.</span>
        <button onClick={toggle} disabled={state.loading}
          style={{
            padding: '6px 10px',
            background: state.installed ? 'rgba(138,176,120,0.18)' : 'rgba(255,255,255,0.06)',
            border: '1px solid ' + (state.installed ? 'rgba(138,176,120,0.5)' : 'rgba(255,255,255,0.1)'),
            borderRadius: 6, cursor: state.loading ? 'wait' : 'pointer',
            color: state.installed ? '#8ab078' : 'rgba(255,255,255,0.85)',
            fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
          }}>
          {state.loading ? '…' : state.installed ? '✓ Installed — click to remove' : 'Install hook'}
        </button>
      </div>
    </TweakGroup>
  );
}

// Segmented — horizontal option group. Each option renders as a flat
// button; the selected one gets an accent fill. Used by every Tweaks
// row except the Accent swatches (which are their own color grid).
//
// Was referenced by TweaksPanel for months but never defined anywhere,
// causing `ReferenceError: Segmented is not defined` on every click of
// the Tweaks button. Caught by e2e/tests/feature/tweaks.spec.ts.
function Segmented({ value, onChange, options }) {
  return (
    <div
      data-testid="segmented-group"
      style={{
        display: 'flex', gap: 0,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6, padding: 2,
      }}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            data-testid={`segmented-option-${o.value}`}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1, padding: '5px 8px',
              background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 'none',
              borderRadius: 4,
              color: active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)',
              fontFamily: 'inherit', fontSize: 11, fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              transition: 'background 100ms, color 100ms',
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function TweakGroup({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.8, color: 'rgba(255,255,255,0.45)',
      }}>{label}</div>
      {children}
    </div>
  );
}

function ToastStack({ toasts }) {
  return (
    <div style={{
      position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
      zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8,
      alignItems: 'center', pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          padding: '8px 14px',
          background: 'rgba(30,26,22,0.96)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          fontSize: 12, color: 'rgba(255,255,255,0.9)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'toastIn 200ms ease-out',
        }}>
          {t.icon}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { TweaksPanel, ToastStack });
