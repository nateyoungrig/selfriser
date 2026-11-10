import type { PowerSpec, StageDesign, Tower, WinchSpec } from '../model/types'
import { towerLoads } from '../lib/loads'
import { learnFromSamples } from '../lib/sim'
import { patchActive } from '../model/library'
import { NumberField } from '../ui/NumberField'
import { samplesFor, useLog } from '../field/log'
import { lab, simModel } from './store'
import { liftTag } from './Paddle'
import { useLabData } from './LabScreen'

type NumericWinchKey = Exclude<keyof WinchSpec, 'kind'>
const WINCH_FIELDS: [NumericWinchKey, string, string][] = [
  ['lineFpmNoLoad', 'Line / chain speed, no load', 'fpm'],
  ['partsOfLine', 'Parts of line (default per tower)', ''],
  ['ratedLinePullLb', 'Rated line pull', 'lb'],
  ['ratedSlip', 'Motor slip at rated load', '0-1'],
  ['mechEfficiency', 'Gear + sheave efficiency', '0-1'],
  ['ratedVolts', 'Motor rated volts', 'V'],
  ['fullLoadAmps', 'Motor full-load amps', 'A'],
  ['drumDiaIn', 'Drum diameter', 'in'],
  ['drumWidthIn', 'Drum width', 'in'],
  ['ropeDiaIn', 'Rope diameter', 'in'],
]
const DRUM_FIELDS: NumericWinchKey[] = ['drumDiaIn', 'drumWidthIn', 'ropeDiaIn']
const POWER_FIELDS: [keyof PowerSpec, string, string][] = [
  ['supplyVolts', 'Volts at the distro', 'V'],
  ['feederOhmsPerKft', 'Feeder resistance (#10=1.24, #8=0.78, #6=0.49)', 'Ω/kft'],
]

const patch = (p: Partial<StageDesign>) => patchActive((d) => ({ ...d, ...p }))
const patchTower = (id: string, p: Partial<Tower>) => patchActive((d) => ({ ...d, towers: d.towers.map((t) => (t.id === id ? { ...t, ...p } : t)) }))

/** Learned speeds, and teaching the sim from a recorded real lift. */
function Learning() {
  const { rig, session } = useLabData()
  const recordings = useLog((s) => s.recordings)
  const tag = liftTag(rig)
  const learned = session.calibration.map((c, i) => ({ label: `${tag}${rig.towers[i].label}`, pct: (c - 1) * 100 })).filter((x) => Math.abs(x.pct) >= 0.5)
  const usable = recordings.filter((r) => r.samples.some((s) => s.rigId === rig.id && s.heightsIn.length === rig.towers.length))

  const teach = (id: string) => {
    const rec = recordings.find((r) => r.id === id)!
    const learnedNow = learnFromSamples(simModel(rig, rig.towers.map(() => 1)), samplesFor(rec, rig.id))
    if (!learnedNow) { alert('Not enough to learn from: the recording needs at least a foot of runs with every tower\'s laser reading.'); return }
    lab.setCalibration(learnedNow)
  }

  return (
    <>
      <h3>Learned {rig.lift} speeds</h3>
      <p className="hint">
        {learned.length ? learned.map((x) => `${x.label} ${x.pct > 0 ? '+' : ''}${x.pct.toFixed(1)}%`).join(', ') : `Nothing yet: every ${rig.lift} runs at its modeled speed.`}
        {learned.length > 0 && <> <button className="danger inline" onClick={() => confirm(`Forget the learned ${rig.lift} speeds for ${rig.short}?`) && lab.setCalibration(rig.towers.map(() => 1))}>FORGET</button></>}
      </p>
      <p className="hint">A lift recorded in the field (Lift log) shows how each tower really tracks its neighbours on a run. Teaching replaces the learned speeds with what that lift shows.</p>
      {usable.length ? (
        <div className="rec-list">
          {[...usable].reverse().map((r) => (
            <div className="rec-item" key={r.id}>
              <span>{new Date(r.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {r.samples.filter((s) => s.rigId === rig.id).length} readings</span>
              <button onClick={() => teach(r.id)}>TEACH THE SIM</button>
            </div>
          ))}
        </div>
      ) : <p className="hint dim">No recorded lifts for {rig.short} yet.</p>}
    </>
  )
}

/** The model behind the simulator: lifters, power, per-tower details and the load estimate. Edits the stage design itself. */
export function SimSheet() {
  const { rig } = useLabData()
  const report = towerLoads(rig)
  const band = rig.loadBandKips
  const kips = rig.towers.some((_, i) => report.towerLb[i] >= 1000)

  return (
    <div className="panel settings">
      <p className="hint">{rig.name}. Everything here only changes the simulator; the field view reads lasers and needs none of it. Values marked ASSUMED in a design are starting guesses.</p>
      <Learning />

      <h3>Bench model</h3>
      <label className="field check">
        <input type="checkbox" checked={!!rig.hardwareControl} onChange={(e) => (!e.target.checked || confirm(`Let the Lab drive ${rig.short}'s motors through the hub? Only for a tabletop model with its own low-voltage controllers, never a real roof: a full-size roof's hoists run from their own rated controls.`)) && patch({ hardwareControl: e.target.checked })} />
        <span>This is a bench model: in the Lab, GO and the switches may drive its motors over the hub</span>
      </label>
      <div className="fields">
        <NumberField label={`One bump (tap on a ${rig.lift} switch)`} unit="in" value={rig.bumpIn} onChange={(v) => patch({ bumpIn: v })} />
      </div>

      <h3>{rig.lift === 'motor' ? 'Chain motors' : 'Winches'}</h3>
      <div className="fields">
        {WINCH_FIELDS.filter(([key]) => rig.winch.kind === 'winch' || !DRUM_FIELDS.includes(key)).map(([key, label, unit]) => (
          <NumberField key={key} label={label} unit={unit} value={rig.winch[key]} onChange={(v) => patch({ winch: { ...rig.winch, [key]: v } })} />
        ))}
      </div>

      <h3>Power</h3>
      <div className="fields">
        {POWER_FIELDS.map(([key, label, unit]) => (
          <NumberField key={key} label={label} unit={unit} value={rig.power[key]} onChange={(v) => patch({ power: { ...rig.power, [key]: v } })} />
        ))}
      </div>

      <h3>Per tower</h3>
      <p className="hint">Known load wins over the estimate: use it when you have engineering reactions or load-cell readings. 0 = use the estimate.</p>
      <div className="scroll-x">
        <table className="tower-table">
          <thead><tr><th>Tower</th><th>Feeder ft</th><th>Parts of line</th><th>{rig.lift === 'motor' ? 'Motors' : 'Winches'}</th>{rig.winch.kind === 'winch' && <th>Rope on drum at deck, ft</th>}<th>Estimate</th><th>Known {kips ? 'kips' : 'lb'}</th></tr></thead>
          <tbody>
            {rig.towers.map((t, i) => (
              <tr key={t.id}>
                <td><span className="winch-num">{t.label}</span></td>
                <td><NumberField value={t.feederFt} onChange={(v) => patchTower(t.id, { feederFt: v })} /></td>
                <td><NumberField value={t.partsOfLine ?? rig.winch.partsOfLine} onChange={(v) => patchTower(t.id, { partsOfLine: v })} /></td>
                <td><NumberField value={t.motors ?? 1} onChange={(v) => patchTower(t.id, { motors: Math.max(1, Math.round(v)) })} /></td>
                {rig.winch.kind === 'winch' && <td><NumberField value={t.ropeOnDrumAtZeroFt} onChange={(v) => patchTower(t.id, { ropeOnDrumAtZeroFt: v })} /></td>}
                <td className="dim">{kips ? `${(report.estimatedLb[i] / 1000).toFixed(1)}k → ${(report.towerLb[i] / 1000).toFixed(1)}k` : `${report.towerLb[i].toFixed(2)} lb`}</td>
                <td><NumberField value={(t.loadLb ?? 0) / (kips ? 1000 : 1)} onChange={(v) => patchTower(t.id, { loadLb: v > 0 ? v * (kips ? 1000 : 1) : undefined })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Load estimate</h3>
      <p className="hint">Weights below set the <i>pattern</i> (which towers are heavy). With the band on, that pattern is pinned so the lightest and heaviest towers land on the range you were given. Total now: {kips ? `${(report.totalLb / 1000).toFixed(0)} kips` : `${report.totalLb.toFixed(1)} lb`}.</p>
      <div className="fields">
        <label className="field check">
          <input type="checkbox" checked={band !== null} onChange={(e) => patch({ loadBandKips: e.target.checked ? [8, 16] : null })} />
          <span>Pin tower loads to a known range</span>
        </label>
        {band && (
          <>
            <NumberField label="Lightest tower" unit="kips" value={band[0]} onChange={(v) => patch({ loadBandKips: [v, band[1]] })} />
            <NumberField label="Heaviest tower" unit="kips" value={band[1]} onChange={(v) => patch({ loadBandKips: [band[0], v] })} />
          </>
        )}
        {Object.entries(rig.memberPlf).map(([kind, plf]) => (
          <NumberField key={kind} label={`Truss: ${kind}`} unit="lb/ft" value={plf} onChange={(v) => patch({ memberPlf: { ...rig.memberPlf, [kind]: v } })} />
        ))}
        {rig.areaLoads.map((a) => (
          <NumberField key={a.id} label={a.label} unit="psf" value={a.psf} onChange={(v) => patch({ areaLoads: rig.areaLoads.map((x) => (x.id === a.id ? { ...x, psf: v } : x)) })} />
        ))}
        {rig.pointLoads.map((p) => (
          <NumberField key={p.id} label={p.label} unit="lb" value={p.lbs} onChange={(v) => patch({ pointLoads: rig.pointLoads.map((x) => (x.id === p.id ? { ...x, lbs: v } : x)) })} />
        ))}
        <NumberField label="Load picked up per inch a tower rides high" unit="lb/in" value={rig.couplingLbPerIn} onChange={(v) => patch({ couplingLbPerIn: v })} />
      </div>
    </div>
  )
}
