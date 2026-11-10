import { useEffect, type ReactNode } from 'react'

/** A full-screen page over the app with a title and CLOSE. Esc closes it too. */
export function Sheet({ title, onClose, children, actions }: { title: ReactNode; onClose(): void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="sheet-head">
        <h2>{title}</h2>
        <div className="row">
          {actions}
          <button onClick={onClose}>CLOSE ✕</button>
        </div>
      </div>
      {children}
    </div>
  )
}
