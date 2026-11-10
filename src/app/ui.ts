import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LevelTarget } from '../lib/level'

// App-wide view state. The app always opens in the field: live laser heights for the stage on screen.
// The Lab (simulator and bench model) is something you go into on purpose and is never remembered
// across a reload.

export type Mode = 'field' | 'lab'
export type ViewName = 'iso' | 'front' | 'side' | 'plan'
export type SheetName = 'link' | 'level' | 'log' | 'designs' | 'sim' | null

/** What the design editor is working on: an existing design, or a new one from a drawing or from scratch. */
export type EditorTarget = { id: string } | { pdf: File } | { blank: true }

interface UiState {
  mode: Mode
  sheet: SheetName
  editor: EditorTarget | null
  view: ViewName
  /** Bumped to re-frame the camera even when the view name doesn't change. */
  viewNonce: number
  /** Out-of-level drawn this many times bigger than life in the 3D view (1 = true scale). */
  exaggeration: number
  /** Lab: sim clock multiplier while holding GO or a switch. */
  timeScale: number
  /** Which height the bump list levels to. */
  levelTarget: LevelTarget
}

export const MAGNIFY_MAX = 20
/** Sim clock runs at least 5x real time; the slider steps by 5 up to 50x. */
export const TIME_SCALE_MIN = 5
export const TIME_SCALE_MAX = 50
export const TIME_SCALE_STEP = 5

export const useUi = create<UiState>()(
  persist(
    (): UiState => ({ mode: 'field', sheet: null, editor: null, view: 'iso', viewNonce: 0, exaggeration: 5, timeScale: TIME_SCALE_MIN, levelTarget: 'median' }),
    {
      name: 'selfriser-ui',
      partialize: (s) => ({ view: s.view, exaggeration: s.exaggeration, timeScale: s.timeScale, levelTarget: s.levelTarget }),
    },
  ),
)

export const openSheet = (sheet: SheetName) => useUi.setState({ sheet })
export const setView = (view: ViewName) => useUi.setState((s) => ({ view, viewNonce: s.viewNonce + 1 }))
export const openEditor = (editor: EditorTarget | null) => useUi.setState({ editor, sheet: null })
