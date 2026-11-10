import type { Rig, StageDesign } from '../types'
import { extentOf } from '../geometry'
import { demoRoof } from './demo-roof'
import { scaleModel } from './scale-model'

// The stage designs a fresh install starts with: a full-size roof and the tabletop scale model for the
// Lab. They are ordinary designs once seeded: edit them, attach their drawings, or remove them
// (Stage designs → RESTORE EXAMPLES brings them back).
//
// Real roofs measured off drawings you can't publish go in ./private/ (gitignored), as an index.ts
// exporting `rigs: Rig[]`. When it exists, those are seeded in place of the demo roof.
const PRIVATE_RIGS = Object.values(import.meta.glob<{ rigs: Rig[] }>('./private/index.ts', { eager: true })).flatMap((m) => m.rigs)

const EXAMPLE_RIGS: Rig[] = [...(PRIVATE_RIGS.length ? PRIVATE_RIGS : [demoRoof]), scaleModel]

/** The roof outline of a hand-written rig: wherever its truss runs reach. */
function roofOf(rig: Rig) {
  return extentOf([...rig.members.flatMap((m) => [{ x: m.a[0], y: m.a[1] }, { x: m.b[0], y: m.b[1] }]), ...rig.towers])
}

export function exampleDesign(rig: Rig, now = Date.now()): StageDesign {
  return { ...structuredClone(rig), roof: roofOf(rig), example: rig.id, createdAt: now, updatedAt: now }
}

export const exampleDesigns = (now = Date.now()) => EXAMPLE_RIGS.map((r) => exampleDesign(r, now))

export { demoRoof, scaleModel }
