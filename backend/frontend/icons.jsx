// Tiny inline SVG icons — stroke-based, 16px default, currentColor

const Icon = ({ d, size = 16, stroke = 1.6, fill = 'none' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
       style={{ flexShrink: 0 }}>
    {d}
  </svg>
);

const IconNewTab = (p) => <Icon {...p} d={<>
  <rect x="3" y="5" width="18" height="14" rx="2"/>
  <path d="M3 9h18"/>
  <path d="M12 13v4M10 15h4"/>
</>}/>;

const IconSplit = (p) => <Icon {...p} d={<>
  <rect x="3" y="5" width="18" height="14" rx="2"/>
  <path d="M12 5v14"/>
  <path d="M15 10l2 2-2 2"/>
</>}/>;

const IconSearch = (p) => <Icon {...p} d={<>
  <circle cx="11" cy="11" r="7"/>
  <path d="M20 20l-3.5-3.5"/>
</>}/>;

const IconFilter = (p) => <Icon {...p} d={<>
  <path d="M4 5h16l-6 8v5l-4 2v-7L4 5z"/>
</>}/>;

const IconFolder = (p) => <Icon {...p} d={<>
  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
</>}/>;

const IconBranch = (p) => <Icon {...p} d={<>
  <circle cx="6" cy="6" r="2"/>
  <circle cx="6" cy="18" r="2"/>
  <circle cx="18" cy="8" r="2"/>
  <path d="M6 8v8"/>
  <path d="M18 10c0 3-4 3-4 6v2"/>
</>}/>;

const IconChat = (p) => <Icon {...p} d={<>
  <path d="M21 12a8 8 0 1 1-3.1-6.3L21 4l-.7 3.1A8 8 0 0 1 21 12z"/>
</>}/>;

const IconSparkle = (p) => <Icon {...p} d={<>
  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>
</>}/>;

const IconClose = (p) => <Icon {...p} d={<>
  <path d="M6 6l12 12M18 6l-12 12"/>
</>}/>;

const IconCog = (p) => <Icon {...p} d={<>
  <circle cx="12" cy="12" r="3"/>
  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>
</>}/>;

const IconChevron = (p) => <Icon {...p} d={<>
  <path d="M6 9l6 6 6-6"/>
</>}/>;

const IconFocus = (p) => <Icon {...p} d={<>
  <circle cx="12" cy="12" r="3"/>
  <path d="M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4"/>
</>}/>;

const IconDot = ({ size = 8, color = 'currentColor' }) => (
  <span style={{
    width: size, height: size, borderRadius: '50%', background: color,
    display: 'inline-block', flexShrink: 0,
  }}/>
);

Object.assign(window, {
  IconNewTab, IconSplit, IconSearch, IconFilter, IconFolder, IconBranch,
  IconChat, IconSparkle, IconClose, IconCog, IconChevron, IconDot, IconFocus,
});
