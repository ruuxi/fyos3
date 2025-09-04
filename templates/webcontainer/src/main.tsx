import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Desktop from './desktop/Desktop'
import './desktop/styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>
)

// Send First Contentful Paint signal to parent WebContainer
// This notifies the parent that the desktop environment is ready
window.addEventListener('load', () => {
  setTimeout(() => {
    // Send the FCP message to parent window
    window.parent?.postMessage({ type: 'webcontainer:fcp' }, '*')
  }, 100) // Small delay to ensure everything is rendered
})
