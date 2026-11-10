import { useEffect, useMemo } from 'react'
import { analyzeLevel } from '../lib/level'
import { coupledLoads } from '../lib/loads'
import { readouts } from '../lib/sim'
import { formatCompact, formatDeltaCompact, formatLoad, formatTotalLoad } from '../lib/units'
import { motionAllowed, STALE_MS, useLink } from '../hw/link'
import { sendGotoAll } from './hold'
import { TIME_SCALE_MAX, TIME_SCALE_MIN, TIME_SCALE_STEP, openSheet, useUi } from '../app/ui'
import { Scene } from '../ui/Scene'
import { Legend, Slider, ViewBar } from '../ui/ViewBar'
import { Summary } from '../ui/Summary'
import { TowerGrid } from '../ui/TowerGrid'
import { Keypad } from '../ui/Keypad'
import { deviationColor, loadColor, signedPct } from '../ui/colors'
import { LevelSheet } from '../field/LevelSheet'
import { displayHeights, lab, useLab, useLabSession } from './store'
import { liftTag, Paddle } from './Paddle'
import { SwitchControl } from './SwitchControl'
import { LabHotkeys } from './LabHotkeys'

/** The active design's sim session and everything derived from the heights on screen right now. */
export function useLabData() {
  const active = useLabSession()
  const { rig, session, model } = active
  const heightsIn = useMemo(() => displayHeights(session), [session])
  const report = useMemo(() => analyzeLevel(rig, heightsIn), [rig, heightsIn])
  // Tower positions -> who is carrying more or less than their level-roof share.
  const loadsLb = useMemo(() => coupledLoads(rig, model.staticLb, heightsIn), [rig, model, heightsIn])
  const overPct = loadsLb.map((w, i) => (model.staticLb[i] > 0 ? (w / model.staticLb[i] - 1) * 100 : 0))
  // Tower capacity = lifter rating x parts of line x motors on that tower.
  const ratedPct = loadsLb.map((w, i) => (w / (rig.winch.ratedLinePullLb * (rig.towers[i].partsOfLine ?? rig.winch.partsOfLine) * (rig.towers[i].motors ?? 1))) * 100)
  return { ...active, heightsIn, report, loadsLb, overPct, ratedPct }
}

/** The Lab: the simulator for the stage on screen, and the driver for a linked bench model. */
export function LabScreen() {
  const { rig, session, switches, heightsIn, report, loadsLb, overPct, ratedPct } = useLabData()
  const selected = useLab((s) => s.selected)
  const entryText = useLab((s) => s.entryText)
  const canUndo = useLab((s) => (s.past[rig.id]?.length ?? 0) > 0)
  const canRedo = useLab((s) => (s.future[rig.id]?.length ?? 0) > 0)
  const timeScale = useUi((s) => s.timeScale)
  const linked = useLink((s) => s.status === 'live')
  const reports = useLink((s) => s.towers)
  const notice = useLink((s) => s.notice)
  const alarm = useLink((s) => s.alarm)
  const n = rig.towers.length
  const ran = session.runSeconds > 0
  const tag = liftTag(rig)
  const known = useMemo(() => rig.towers.map(() => true), [rig])
  useEffect(() => { lab.select(null) }, [rig.id, n])

  const sel = selected !== null && selected < n ? selected : null
  return (
    <>
      <LabHotkeys />
      <section className="stage">
        <Scene
          rig={rig} heightsIn={heightsIn} known={known} report={report} selected={sel} onSelect={lab.select}
          // Tower color = load picked up (red) or shed (blue) versus its level share.
          towerColor={(i) => loadColor(overPct[i])} dimmed={switches.map((s) => s === 0)}
        />
        <ViewBar>
          <Slider
            label="SIM SPEED" value={timeScale} min={TIME_SCALE_MIN} max={TIME_SCALE_MAX} step={TIME_SCALE_STEP}
            title="How fast the sim clock runs while you hold GO or a switch" onChange={(v) => useUi.setState({ timeScale: v })}
          />
        </ViewBar>
        <div className="sim-watermark">SIMULATOR</div>
        {alarm && <div className="hw-alarm" role="alert">{alarm}</div>}
        {notice && !alarm && <button className="hw-notice" onClick={() => useLink.setState({ notice: null })}>{notice} ✕</button>}
        <Legend tolerance={rig.tolerance} />
        <div className="keys-hint">Space GO &middot; ↑↓ master run, or bump/run the picked {rig.lift} &middot; ←→ pick {rig.lift} (Esc = master) &middot; T switch ▲/○/▼ &middot; Ctrl+Z / Y undo redo &middot; WASD fly, Q/E height &middot; drag pan, right-drag orbit</div>
      </section>

      <section className={`controls ${sel !== null ? 'entering' : ''}`}>
        <div className="controls-top">
          <Summary rig={rig} report={report}>
            <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={lab.undo}>↶</button>
            <button title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={lab.redo}>↷</button>
          </Summary>
          <div className="row lab-tools">
            <button className="danger" onClick={() => confirm(`Reset the sim: roof back on the deck, all switches up. Learned ${rig.lift} speeds are kept. (Ctrl+Z brings it back.)`) && lab.reset()}>RESET SIM</button>
            <button onClick={() => openSheet('level')}>BUMP LIST</button>
            <button onClick={() => openSheet('sim')}>SIM SETTINGS</button>
          </div>
          <TowerGrid
            towers={rig.towers} selected={sel}
            footer={<span title={`Total load on all the ${rig.lift} lines`}>{formatTotalLoad(loadsLb.reduce((s, v) => s + v, 0))}</span>}
            cell={(i, style) => {
              const t = rig.towers[i]
              const dev = report.devIn[i]
              const devColor = deviationColor(dev, rig.tolerance.stopIn)
              const estimated = ran && session.enteredIn[i] === null
              const fill = Math.min(1, Math.abs(dev) / rig.tolerance.stopIn) * 50
              // Linked: what this tower's controller says, as a badge after the height.
              const r = reports[t.linkId]
              const hw = !linked ? undefined : !r || Date.now() - r.at > STALE_MS ? 'NO LINK' : ({ limit: 'LIMIT', stall: 'STALL', nosensor: 'NO LASER' } as Record<string, string>)[r.s] ?? 'LASER'
              return (
                <div
                  key={t.id} role="button" tabIndex={0} style={style}
                  className={`cell ${report.towerStatus[i]} ${sel === i ? 'selected' : ''} ${switches[i] === 0 ? 'off' : ''}`}
                  onClick={() => lab.select(sel === i ? null : i)}
                >
                  <span className="devbar"><i style={{ height: `${fill}%`, [dev >= 0 ? 'bottom' : 'top']: '50%', background: devColor }} /></span>
                  <div className="cell-head">
                    <span className="num-wrap">
                      <span className="winch-num">{t.label}</span>
                      {(t.motors ?? 1) > 1 && <span className="cell-motors" title={`${t.motors} ${rig.lift}s on this tower, run together`}>×{t.motors}</span>}
                    </span>
                    <span className="cell-dev" style={{ color: devColor }}>{formatDeltaCompact(dev)}</span>
                  </div>
                  <span
                    className={`cell-height ${sel === i ? 'editing' : ''} ${estimated && !(sel === i && entryText) ? 'est' : ''} ${hw ? (hw === 'LASER' ? 'hw' : 'hw bad') : ''}`}
                    data-hw={hw === 'LASER' ? '' : hw}
                    title={hw ? (hw === 'LASER' ? 'Laser reading, live' : `Tower controller: ${hw}`) : estimated ? 'Sim estimate. Tap to type a height.' : 'Typed. Tap to change.'}
                  >
                    {sel === i && entryText ? entryText : formatCompact(heightsIn[i])}
                  </span>
                  <span
                    className={`cell-load ${ratedPct[i] > 100 ? 'over' : ratedPct[i] > 85 ? 'warm' : ''}`}
                    title={`${formatLoad(loadsLb[i])} on this tower, ${Math.round(ratedPct[i])}% of the tower's ${rig.lift} rating, ${signedPct(overPct[i])} vs its share with the roof level`}
                  >
                    <b style={{ color: ratedPct[i] > 100 ? 'var(--stop)' : loadColor(overPct[i]) }}>{formatLoad(loadsLb[i])}</b>
                    <i>{Math.round(ratedPct[i])}%</i>
                  </span>
                  <SwitchControl i={i} n={n} value={switches[i]} size="large" />
                </div>
              )
            }}
          />
        </div>
        {sel !== null && (
          <Keypad
            tag={`${tag}${rig.towers[sel].label}`}
            text={entryText}
            currentIn={heightsIn[sel]}
            hint={session.enteredIn[sel] !== null ? 'typed · type to change' : ran ? 'sim estimate · type a height' : "e.g. 23'4½"}
            maxFt={rig.towerHeightFt}
            setText={lab.setEntryText}
            onEntry={(inches) => lab.setEntry(sel, inches)}
            onNext={(step) => lab.select((sel + step + n) % n)}
            onClear={session.enteredIn[sel] !== null ? () => { lab.setEntry(sel, null); lab.setEntryText('') } : undefined}
            onSetAll={() => { lab.setAll(heightsIn[sel]); lab.setEntryText('') }}
            setAllLabel={`SET ALL ${n}`}
            onDone={() => lab.select(null)}
          />
        )}
        <Paddle />
      </section>
    </>
  )
}

/** The bump list in the Lab: seconds from the winch model, and buttons that act on it. */
export function LabLevelSheet() {
  const { rig, model, heightsIn, report } = useLabData()
  const known = useMemo(() => rig.towers.map(() => true), [rig])
  const canDrive = useLink((s) => s.status === 'live') && motionAllowed()
  const up = readouts(model, heightsIn, 1), down = readouts(model, heightsIn, -1)
  return (
    <LevelSheet
      rig={rig} heightsIn={heightsIn} known={known} report={report}
      seconds={(i, inches) => Math.abs(inches) / ((((inches > 0 ? up : down)[i].roofFpm) * 12) / 60)}
      actions={(fix, target) => (
        <>
          {canDrive && <button className="primary" onClick={() => { sendGotoAll(fix, heightsIn); openSheet(null) }}>RUN THESE ON THE MODEL</button>}
          <button onClick={() => { lab.applyCorrection(target); openSheet(null) }}>APPLY IN SIM (pretend I bumped these)</button>
        </>
      )}
    />
  )
}
