import { useEffect } from 'react'
import { connectUsb, connectWifi, hasWebSerial, useLink } from '../hw/link'
import { formatCompact, formatDeltaCompact } from '../lib/units'
import { openSheet } from '../app/ui'
import { Scene } from '../ui/Scene'
import { Legend, ViewBar } from '../ui/ViewBar'
import { Summary } from '../ui/Summary'
import { TowerGrid } from '../ui/TowerGrid'
import { Keypad } from '../ui/Keypad'
import { deviationColor, SOURCE_COLOR } from '../ui/colors'
import { selectTower, setAllTape, setEntryText, setTape, useField } from './store'
import { useFieldData, type Reading } from './readings'

const ago = (at: number | null, now: number) => {
  if (at === null) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

const FAULT: Record<string, string> = { limit: 'AT LIMIT', stall: 'STALL', nosensor: 'NO LASER' }

/** Where the height came from, in the card's corner. */
function SourceBadge({ r, linked, now }: { r: Reading; linked: boolean; now: number }) {
  const fault = r.report && now - r.report.at < 1000 ? FAULT[r.report.s] : undefined
  if (fault) return <span className="src bad">{fault}</span>
  if (r.source === 'live') {
    const sig = r.report?.sig ?? 100
    return <span className={`src live ${sig >= 80 ? '' : sig >= 40 ? 'fair' : 'poor'}`} title={`Laser, live · signal ${sig}%${r.report?.via ? ` · via tower ${r.report.via}` : ''}`}><i />LIVE{sig < 80 ? ` ${sig}%` : ''}</span>
  }
  if (r.source === 'tape') return <span className="src tape" title="Typed off a tape">TAPE</span>
  if (r.source === 'stale') return <span className="src stale" title="Last laser reading">{ago(r.at, now)}</span>
  return <span className="src none">{linked ? 'NO LINK' : 'NO DATA'}</span>
}

/** Big call to action when no hub is linked: this is a laser tool first. */
function ConnectCard() {
  const status = useLink((s) => s.status)
  const error = useLink((s) => s.error)
  const wsUrl = useLink((s) => s.wsUrl)
  if (status === 'live') return null
  return (
    <div className="connect-card">
      <div>
        <b>{status === 'connecting' ? 'Linking the laser hub…' : 'Tower lasers not linked'}</b>
        <span>{error ?? 'Plug the hub into this phone or laptop, or join its Wi-Fi. Tap a tower to type a height off a tape meanwhile.'}</span>
      </div>
      <div className="row">
        {hasWebSerial() && <button className="primary" disabled={status === 'connecting'} onClick={() => connectUsb()}>USB HUB</button>}
        <button className={hasWebSerial() ? '' : 'primary'} disabled={status === 'connecting'} onClick={() => connectWifi(wsUrl)}>WI-FI HUB</button>
        <button onClick={() => openSheet('link')}>MORE…</button>
      </div>
    </div>
  )
}

/**
 * The field screen: the stage on screen with every tower's live laser height. The app only watches
 * here; the hoists run from their own controls. Towers without a laser take a height off a tape.
 */
export function FieldScreen() {
  const { design, readings, known, heightsIn, report, linked, liveCount } = useFieldData()
  const selected = useField((s) => s.selected)
  const entryText = useField((s) => s.entryText)
  const alarm = useLink((s) => s.alarm)
  const notice = useLink((s) => s.notice)
  const now = Date.now()
  const n = design.towers.length
  const empty = !known.some(Boolean)

  // A different stage, or towers added or removed: the pick no longer means anything.
  useEffect(() => { selectTower(null) }, [design.id, n])
  useEffect(() => {
    if (selected !== null) return
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { selectTower(e.key === 'ArrowRight' ? 0 : n - 1); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, n])

  const sel = selected !== null && selected < n ? selected : null
  const r = sel !== null ? readings[sel] : null
  const t = sel !== null ? design.towers[sel] : null

  return (
    <>
      <section className="stage">
        <Scene
          rig={design} heightsIn={heightsIn} known={known} report={report} selected={sel} onSelect={selectTower}
          towerColor={(i) => SOURCE_COLOR[readings[i].source]}
        />
        <ViewBar />
        {alarm && <div className="hw-alarm" role="alert">{alarm}</div>}
        {notice && !alarm && <button className="hw-notice" onClick={() => useLink.setState({ notice: null })}>{notice} ✕</button>}
        <Legend tolerance={design.tolerance} />
      </section>

      <section className={`controls ${sel !== null ? 'entering' : ''}`}>
        <div className="controls-top">
          <Summary rig={design} report={report} empty={empty}>
            <div className="stat live-count"><label>LASERS</label><b>{linked ? `${liveCount}/${n}` : 'OFF'}</b></div>
          </Summary>
          <ConnectCard />
          <TowerGrid
            towers={design.towers} selected={sel}
            footer={known.some((k) => !k) ? `${known.filter(Boolean).length} of ${n} towers have a height` : undefined}
            cell={(i, style) => {
              const tw = design.towers[i]
              const rd = readings[i]
              const dev = report.devIn[i]
              const devColor = deviationColor(dev, design.tolerance.stopIn)
              // Bar grows up from center when high, down when low; full height = stop tolerance.
              const fill = Math.min(1, Math.abs(dev) / design.tolerance.stopIn) * 50
              return (
                <div
                  key={tw.id} role="button" tabIndex={0} style={style}
                  className={`cell live-cell ${known[i] ? report.towerStatus[i] : 'unknown'} ${sel === i ? 'selected' : ''} src-${rd.source}`}
                  onClick={() => selectTower(sel === i ? null : i)}
                >
                  <span className="devbar">{known[i] && <i style={{ height: `${fill}%`, [dev >= 0 ? 'bottom' : 'top']: '50%', background: devColor }} />}</span>
                  <div className="cell-head">
                    <span className="num-wrap">
                      <span className="winch-num">{tw.label}</span>
                      {tw.linkId !== Number(tw.label) && <span className="cell-link" title={`Laser controller set to tower ${tw.linkId}`}>#{tw.linkId}</span>}
                    </span>
                    <span className="cell-dev" style={{ color: known[i] ? devColor : undefined }}>{known[i] ? formatDeltaCompact(dev) : ''}</span>
                  </div>
                  <span className={`cell-height ${sel === i ? 'editing' : ''} ${rd.source === 'stale' ? 'est' : ''}`}>
                    {sel === i && entryText ? entryText : rd.in === null ? '-' : formatCompact(rd.in)}
                  </span>
                  <div className="cell-foot"><SourceBadge r={rd} linked={linked} now={now} /></div>
                </div>
              )
            }}
          />
        </div>
        {sel !== null && t && r && (
          <Keypad
            tag={t.label}
            text={entryText}
            currentIn={r.in}
            hint={r.source === 'live' ? 'laser is live · a tape entry is replaced by its next reading' : r.source === 'tape' ? `tape, ${ago(r.at, now)} · type to change` : r.source === 'stale' ? `last laser reading, ${ago(r.at, now)}` : "no height yet · e.g. 23'4½"}
            maxFt={design.towerHeightFt}
            disabled={r.source === 'live'}
            setText={setEntryText}
            onEntry={(inches) => setTape(design.id, t.id, inches)}
            onNext={(step) => selectTower((sel + step + n) % n)}
            onClear={r.source === 'tape' ? () => { setTape(design.id, t.id, null); setEntryText('') } : undefined}
            onSetAll={r.in !== null ? () => { setAllTape(design.id, design.towers.map((x) => x.id), r.in!); setEntryText('') } : undefined}
            setAllLabel={`ALL ${n} TO THIS`}
            onDone={() => selectTower(null)}
          />
        )}
      </section>
    </>
  )
}
