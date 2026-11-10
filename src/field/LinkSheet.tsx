import { useState } from 'react'
import { connectUsb, connectWifi, disconnect, hasWebSerial, motionAllowed, send, sendStop, STALE_MS, useLink } from '../hw/link'
import { formatCompact, formatDeltaCompact } from '../lib/units'
import { useDesign } from '../model/library'
import { useUi } from '../app/ui'

const STATE_TEXT: Record<string, string> = { idle: 'ready', run: 'running', goto: 'moving to target', limit: 'AT LIMIT', stall: 'STALLED', nosensor: 'NO LASER' }

/** Link the laser hub and see what every tower controller is saying. */
export function LinkSheet() {
  const design = useDesign()
  const mode = useUi((s) => s.mode)
  const { status, via, error, hub, towers, log, guard, monitor: monitorSwitch, wsUrl, notice } = useLink()
  const [url, setUrl] = useState(wsUrl)
  const live = status === 'live'
  const now = Date.now()
  const driving = live && motionAllowed()
  const bench = mode === 'lab' && design.hardwareControl
  const monTowers = Object.values(towers).some((r) => r.mon && now - r.at < STALE_MS)
  const known = new Set(design.towers.map((t) => t.linkId))
  const strangers = Object.keys(towers).map(Number).filter((n) => !known.has(n) && now - towers[n].at < STALE_MS)
  const stop = formatDeltaCompact(design.tolerance.stopIn, 8).replace('+', '')

  return (
    <div className="panel link">
      <p className="hint">
        A laser and a controller on every tower report its height over the radio to one hub, plugged into this phone
        or laptop (USB) or on Wi-Fi. Each controller is set to a tower number; {design.short} expects{' '}
        {design.towers.map((t) => t.linkId).sort((a, b) => a - b).join(', ')}. Firmware and wiring: <code>hardware/</code> in the repo.
      </p>

      <h3>Hub</h3>
      {live ? (
        <div className="row">
          <span className="link-state on">LINKED over {via === 'usb' ? 'USB' : 'Wi-Fi'}{hub ? ` · hub ${hub.fw} · ch ${hub.ch}${hub.ip ? ` · ${hub.ip}` : ''}` : ' · waiting for the hub'}</span>
          <button onClick={() => disconnect()}>DISCONNECT</button>
        </div>
      ) : (
        <>
          <div className="row">
            <button className="primary" disabled={status === 'connecting' || !hasWebSerial()} onClick={() => connectUsb()}>CONNECT USB HUB</button>
            {!hasWebSerial() && <span className="hint">No Web Serial here: Chrome or Edge on a computer or Android has it.</span>}
          </div>
          <div className="row">
            <input className="text" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Wi-Fi hub address" />
            <button disabled={status === 'connecting'} onClick={() => connectWifi(url)}>CONNECT WI-FI HUB</button>
          </div>
          <p className="hint">Wi-Fi works from the dev server (<code>npm run dev</code>, http) on the same network; an https page can't open ws://.</p>
        </>
      )}
      {status === 'connecting' && <p className="hint">Connecting…</p>}
      {error && <p className="hint bad">{error}</p>}
      {notice && <p className="hint bad">{notice}</p>}

      <h3>Mode</h3>
      {bench ? (
        <>
          <div className="seg">
            <button className={!monitorSwitch ? 'on' : ''} onClick={() => useLink.setState({ monitor: false })}>DRIVE THE MODEL</button>
            <button className={monitorSwitch ? 'on' : ''} onClick={() => { sendStop(); useLink.setState({ monitor: true }) }}>MONITOR ONLY</button>
          </div>
          <p className="hint">Lab, bench model: GO, the switches and the bump list can run its motors. MONITOR ONLY rehearses the field.</p>
          {monTowers && <p className="hint bad">A tower reports a monitor-only build (no motor outputs), so the whole link is monitor only.</p>}
        </>
      ) : (
        <p className="hint"><b>MONITOR ONLY.</b> The {design.lift === 'motor' ? 'motors' : 'winches'} run from their own rated controls, never from this app. Linked, it reads each tower's laser, shows the level live and sounds the alarm at the stop tolerance.</p>
      )}

      {live && (
        <>
          <div className="row">
            {driving && <button className="danger" onClick={() => sendStop()}>■ STOP ALL</button>}
            <button onClick={() => confirm('Roof sitting on the deck at every tower? Every laser takes its reading right now as 0.') && send({ t: 'zero', n: 0 })}>ZERO ALL (ROOF ON DECK)</button>
          </div>

          <h3>Towers</h3>
          <div className="scroll-x">
            <table className="tower-table">
              <thead><tr><th>Tower</th><th>Controller</th><th title="Share of the tower's reports reaching the hub over the last 5 s">Signal</th><th>Height</th><th>Laser</th>{driving && <><th>Motor</th><th>Top limit</th></>}<th></th></tr></thead>
              <tbody>
                {design.towers.map((t) => {
                  const r = towers[t.linkId]
                  const fresh = r && now - r.at < STALE_MS
                  const bad = fresh && ['limit', 'stall', 'nosensor'].includes(r.s)
                  return (
                    <tr key={t.id} className={bad ? 'over' : ''}>
                      <td><span className="winch-num">{t.label}</span>{t.linkId !== Number(t.label) && <span className="dim"> #{t.linkId}</span>}</td>
                      <td>
                        {fresh ? `${STATE_TEXT[r.s]}${r.mon ? ' · monitor' : ''}` : <span className="dim">not heard from (set it to "tower {t.linkId}")</span>}
                        {fresh && r.via > 0 && <span className="via" title="The hub can't hear this tower directly; a neighbour is repeating its reports"> · via tower {r.via}</span>}
                      </td>
                      <td>{r ? <b className={`sig ${(r.sig ?? 0) >= 80 ? 'good' : (r.sig ?? 0) >= 40 ? 'fair' : 'poor'}`}>{r.sig ?? 0}%</b> : <span className="dim">-</span>}</td>
                      <td><b>{fresh && r.s !== 'nosensor' ? formatCompact(Math.max(0, r.h), 16) : '-'}</b></td>
                      <td className="dim">{fresh ? `${r.mm} mm${r.q ? ` · status ${r.q}` : ''}` : ''}</td>
                      {driving && <>
                        <td>{fresh ? (r.d > 0 ? '▲' : r.d < 0 ? '▼' : '○') : ''}</td>
                        <td className="dim">{fresh ? formatCompact(r.max, 8) : ''}</td>
                      </>}
                      <td>{fresh && <button onClick={() => confirm(`Tower ${t.label}: take its laser reading right now as 0?`) && send({ t: 'zero', n: t.linkId })}>ZERO</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {strangers.length > 0 && <p className="hint bad">Also reporting: tower {strangers.join(', ')}, which {design.short} has no tower set to. Check the controller numbers, or the link numbers in the stage design.</p>}
          {driving && <p className="hint">Towers stop on their own if the app goes quiet for 0.4 s, at 0 and at max trim ({formatCompact(design.maxTrimFt * 12, 8)}), and if they drive for 1.5 s without the laser seeing them move (stall: let go and press again to retry).</p>}
        </>
      )}

      <h3>{driving ? 'Interlock' : 'Stop alarm'}</h3>
      <label className="field check">
        <input type="checkbox" checked={guard} onChange={(e) => useLink.setState({ guard: e.target.checked })} />
        {driving
          ? <span>Stop a GO run when two neighbouring towers reach the stop tolerance ({stop}) and the gap is still growing. Runs that close the gap keep going.</span>
          : <span>Beep, buzz and flash STOP when two neighbouring towers with live lasers are {stop} (the stop tolerance) apart. Keep the phone's volume up; it repeats every 3 s until they're back inside.</span>}
      </label>

      {log.length > 0 && (
        <>
          <h3>Hub log</h3>
          <pre className="hub-log">{log.join('\n')}</pre>
        </>
      )}
    </div>
  )
}
