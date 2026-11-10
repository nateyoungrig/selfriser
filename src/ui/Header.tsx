import { useEffect, useState, type ReactNode } from 'react'
import { openEditor, openSheet, useUi } from '../app/ui'
import { setActive, useDesign, useLibrary } from '../model/library'
import { useLink } from '../hw/link'
import { useLog } from '../field/log'
import { ChevronDown, FileIcon, FlaskIcon, LaserIcon, LevelIcon, MenuIcon, PlusIcon, RecIcon, SlidersIcon, StagesIcon } from './icons'

/** A menu that drops from its button and closes on a tap outside or Esc. */
function Dropdown({ open, onClose, className, children }: { open: boolean; onClose(): void; className: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <button className="scrim" aria-label="Close menu" onClick={onClose} />
      <div className={`dropdown ${className}`} role="menu">{children}</div>
    </>
  )
}

/** The stage on screen, and every other design on the device one tap away. */
function StagePicker() {
  const design = useDesign()
  const designs = useLibrary((s) => s.designs)
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const pick = (id: string) => { setActive(id); close() }
  return (
    <div className="picker">
      <button className="picker-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={design.name}>
        <span className="picker-name">{design.short || design.name}</span>
        <span className="picker-meta">{design.towers.length} towers{design.venue ? ` · ${design.venue}` : ''}</span>
        <ChevronDown />
      </button>
      <Dropdown open={open} onClose={close} className="picker-menu">
        {designs.map((d) => (
          <button key={d.id} role="menuitemradio" aria-checked={d.id === design.id} className={`menu-item ${d.id === design.id ? 'current' : ''}`} onClick={() => pick(d.id)}>
            <span className="menu-main">
              <b>{d.name}</b>
              <small>{d.towers.length} towers · {d.lift === 'motor' ? 'chain motors' : 'winches'}{d.drawing ? ' · from drawing' : ''}{d.hardwareControl ? ' · bench model' : ''}</small>
            </span>
            {d.id === design.id && <span className="tick">✓</span>}
          </button>
        ))}
        <div className="menu-sep" />
        <button className="menu-item" onClick={() => { close(); openSheet('designs') }}><StagesIcon /><span className="menu-main"><b>Manage stage designs…</b></span></button>
        <label className="menu-item">
          <PlusIcon />
          <span className="menu-main"><b>Import a stage drawing (PDF)…</b></span>
          <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; close(); if (f) openEditor({ pdf: f }) }} />
        </label>
      </Dropdown>
    </div>
  )
}

/** Laser link at a glance: dot and how many towers are reporting. Tap for the Lasers page. */
function LinkPill() {
  const status = useLink((s) => s.status)
  const design = useDesign()
  const towers = useLink((s) => s.towers)
  const now = Date.now()
  const live = design.towers.filter((t) => { const r = towers[t.linkId]; return r && now - r.at < 1000 && r.s !== 'nosensor' }).length
  return (
    <button className={`link-pill ${status}`} title="Tower lasers" onClick={() => openSheet('link')}>
      <i />
      {status === 'live' ? <span><b>{live}</b>/{design.towers.length}</span> : status === 'connecting' ? 'LINKING' : 'NOT LINKED'}
    </button>
  )
}

function MainMenu() {
  const mode = useUi((s) => s.mode)
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const item = (icon: ReactNode, title: string, sub: string, go: () => void) => (
    <button className="menu-item" onClick={() => { close(); go() }}>{icon}<span className="menu-main"><b>{title}</b><small>{sub}</small></span></button>
  )
  return (
    <>
      <button className="icon" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MenuIcon /></button>
      <Dropdown open={open} onClose={close} className="main-menu">
        {item(<LaserIcon />, 'Tower lasers', 'Link the hub, signal, zero, stop alarm', () => openSheet('link'))}
        {item(<LevelIcon />, 'Level & bump list', 'Who to bump which way, and every pair', () => openSheet('level'))}
        {item(<RecIcon />, 'Lift log', 'Record a lift\'s laser heights, export', () => openSheet('log'))}
        {item(<StagesIcon />, 'Stage designs', 'Import drawings, edit, remove', () => openSheet('designs'))}
        {mode === 'lab' && item(<SlidersIcon />, 'Sim settings', 'Lifters, power, loads, learned speeds', () => openSheet('sim'))}
        <div className="menu-sep" />
        {mode === 'field'
          ? item(<FlaskIcon />, 'Lab', 'Simulator and bench model. Not live data.', () => useUi.setState({ mode: 'lab', sheet: null }))
          : item(<FileIcon />, 'Back to the field', 'Leave the Lab: live laser heights', () => useUi.setState({ mode: 'field', sheet: null }))}
      </Dropdown>
    </>
  )
}

export function Header() {
  const mode = useUi((s) => s.mode)
  const recording = useLog((s) => s.current !== null)
  return (
    <header className={mode === 'lab' ? 'lab' : ''}>
      {mode === 'lab' && <span className="lab-badge" title="Simulator: nothing here is a live reading"><FlaskIcon />LAB</span>}
      <StagePicker />
      <nav>
        {/* Never recording by accident: this shows whenever the lift log is on. */}
        {recording && <button className="rec-chip" title="Recording this lift (Lift log)" onClick={() => openSheet('log')}><i />REC</button>}
        <LinkPill />
        {mode === 'lab' && <button className="exit-lab" onClick={() => useUi.setState({ mode: 'field', sheet: null })}>EXIT LAB</button>}
        <MainMenu />
      </nav>
    </header>
  )
}
