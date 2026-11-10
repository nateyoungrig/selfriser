import { useCallback } from 'react'
import { openSheet, useUi } from './app/ui'
import { useDesign } from './model/library'
import { Header } from './ui/Header'
import { Sheet } from './ui/Sheet'
import { FieldScreen } from './field/FieldScreen'
import { LinkSheet } from './field/LinkSheet'
import { LevelSheet } from './field/LevelSheet'
import { LogSheet } from './field/LogSheet'
import { useFieldData } from './field/readings'
import { LabLevelSheet, LabScreen } from './lab/LabScreen'
import { SimSheet } from './lab/SimSheet'
import { DesignsSheet } from './designs/DesignsSheet'
import { Editor } from './designs/Editor'

const TITLES = { link: 'Tower lasers', level: 'Level & bump list', log: 'Lift log', designs: 'Stage designs', sim: 'Sim settings' } as const

/** The field's bump list works off live readings. */
function FieldLevelSheet() {
  const { design, heightsIn, known, report } = useFieldData()
  return <LevelSheet rig={design} heightsIn={heightsIn} known={known} report={report} />
}

export default function App() {
  const mode = useUi((s) => s.mode)
  const sheet = useUi((s) => s.sheet)
  const editor = useUi((s) => s.editor)
  // Re-render everything when the stage's display precision changes; the formatters read it globally.
  const denom = useDesign().displayDenom
  const close = useCallback(() => openSheet(null), [])

  return (
    <div className={`app mode-${mode}`} data-denom={denom}>
      <Header />
      {mode === 'field' ? <FieldScreen /> : <LabScreen />}

      {sheet && (
        <Sheet title={sheet === 'level' && mode === 'lab' ? 'Bump list (sim)' : TITLES[sheet]} onClose={close}>
          {sheet === 'link' ? <LinkSheet />
            : sheet === 'level' ? (mode === 'lab' ? <LabLevelSheet /> : <FieldLevelSheet />)
            : sheet === 'log' ? <LogSheet />
            : sheet === 'designs' ? <DesignsSheet />
            : <SimSheet />}
        </Sheet>
      )}
      {editor && <Editor key={JSON.stringify('id' in editor ? editor.id : 'pdf' in editor ? editor.pdf.name : 'blank')} target={editor} />}
    </div>
  )
}
