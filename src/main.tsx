// Bundled fonts (latin only) so the PWA renders the same offline. Barlow for text,
// Barlow Semi Condensed for the big numbers.
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow/latin-700.css'
import '@fontsource/barlow-semi-condensed/latin-600.css'
import '@fontsource/barlow-semi-condensed/latin-700.css'
import '@fontsource/barlow-semi-condensed/latin-800.css'
import '@fontsource/barlow-semi-condensed/latin-600-italic.css'
import '@fontsource/barlow-semi-condensed/latin-700-italic.css'
import '@fontsource/barlow-semi-condensed/latin-800-italic.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { activeDesign, useLibrary } from './model/library'
import { setDisplayDenom } from './lib/units'
import { startWatch } from './field/watch'
import './lab/hold'
import './styles.css'

registerSW({ immediate: true })

// The formatters read the precision globally so every length on screen agrees with the stage's setting.
setDisplayDenom(activeDesign().displayDenom ?? 1)
useLibrary.subscribe(() => setDisplayDenom(activeDesign().displayDenom ?? 1))
startWatch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
