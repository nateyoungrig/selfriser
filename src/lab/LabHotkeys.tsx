import { useEffect } from 'react'
import { pressLocal, releaseLocal, startRun, stopRun } from './hold'
import type { Switch } from '../lib/sim'
import { activeDesign } from '../model/library'
import { useUi } from '../app/ui'
import { lab, switchesFor, useLab } from './store'

const typing = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)

/**
 *  Space / Enter (hold)  GO: every winch runs in its switch direction
 *  Up / Down             master: flips every switch that isn't OFF to that direction and runs (hold)
 *                        with a winch picked: tap = one bump that way, hold = run it alone
 *  Left / Right          pick the previous / next winch        Esc  back to master
 *  T                     cycle the picked winch's switch UP -> OFF -> DOWN     Shift+T  all OFF
 *  Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z)  undo / redo
 */
export function LabHotkeys() {
  useEffect(() => {
    let runKey: string | null = null
    let localKey: string | null = null
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return
      const ui = useUi.getState()
      if (ui.sheet || ui.editor) return
      const st = useLab.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === 'z') { e.shiftKey ? lab.redo() : lab.undo(); e.preventDefault(); return }
      if (mod && key === 'y') { lab.redo(); e.preventDefault(); return }
      if (mod || e.altKey) return
      const rig = activeDesign()
      const n = rig.towers.length
      const switches = switchesFor(rig, st.switches[rig.id])

      if (e.key === ' ' || e.key === 'Enter') {
        if (st.selected !== null) return // the keypad owns Enter while a tower is picked
        e.preventDefault()
        if (e.repeat || runKey) return
        runKey = e.key
        startRun(switches)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (e.repeat || runKey || localKey) return
        const dir = e.key === 'ArrowUp' ? 1 : -1
        if (st.selected !== null) {
          localKey = e.key
          pressLocal(st.selected, dir, n)
        } else {
          runKey = e.key
          const dirs = switches.map((s): Switch => (s ? dir : 0))
          // Flip every switch that is on to this direction (OFF stays OFF), like reaching across the panel.
          if (dirs.some(Boolean)) lab.setAllSwitches(dirs)
          startRun(dirs)
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.key === 'ArrowRight' ? 1 : -1
        lab.select(st.selected === null ? (step === 1 ? 0 : n - 1) : (st.selected + step + n) % n)
      } else if (key === 't') {
        if (e.shiftKey) lab.setAllSwitches(0)
        else if (st.selected !== null) lab.setSwitch(st.selected, ({ 1: 0, 0: -1, '-1': 1 } as Record<string, Switch>)[String(switches[st.selected])])
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === runKey) { runKey = null; stopRun() }
      if (e.key === localKey) { localKey = null; releaseLocal() }
    }
    const blur = () => { runKey = null; localKey = null; stopRun() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      stopRun()
    }
  }, [])
  return null
}
