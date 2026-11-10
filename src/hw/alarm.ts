// The monitor-only alarm: the app can't stop a real hoist, so at the stop tolerance it makes noise.
// Browsers only allow audio after a tap, so arm() is called from the CONNECT button.

let ctx: AudioContext | null = null

export function armAlarm() {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
  } catch {
    ctx = null
  }
}

/** Three short high beeps and a buzz on phones that can. */
export function soundAlarm() {
  navigator.vibrate?.([200, 100, 200, 100, 200])
  if (!ctx) return
  const t0 = ctx.currentTime
  for (let k = 0; k < 3; k++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 1760
    gain.gain.setValueAtTime(0.0001, t0 + k * 0.25)
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + k * 0.25 + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + k * 0.25 + 0.16)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0 + k * 0.25)
    osc.stop(t0 + k * 0.25 + 0.18)
  }
}
