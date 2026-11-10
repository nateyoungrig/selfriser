// Line icons, 24 px grid, drawn in the current text color.

const Svg = ({ children, size = 18 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const MenuIcon = () => <Svg><path d="M4 6h16M4 12h16M4 18h16" /></Svg>
export const ChevronDown = () => <Svg size={16}><path d="m6 9 6 6 6-6" /></Svg>
export const FlaskIcon = () => <Svg><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7 15h10" /></Svg>
export const LaserIcon = () => <Svg><circle cx="12" cy="5" r="2" /><path d="M12 7v14" strokeDasharray="2 2.5" /><path d="M8 21h8" /></Svg>
export const LevelIcon = () => <Svg><path d="M3 12h18" /><path d="M7 8v8M17 6v12" /><path d="M12 9v6" /></Svg>
export const RecIcon = () => <Svg><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" /></Svg>
export const StagesIcon = () => <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 9v11M16 9v11" /></Svg>
export const SlidersIcon = () => <Svg><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></Svg>
export const FileIcon = () => <Svg><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></Svg>
export const PlusIcon = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>
