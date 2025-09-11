import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Desktop from './desktop/Desktop'
import './desktop/styles.css'
import './tailwind.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>
)

// Lightweight HMR anti-flash mask
if (import.meta && (import.meta as any).hot) {
  try {
    const maskId = 'vite-hmr-mask'
    let mask = document.getElementById(maskId)
    const ensureMask = () => {
      if (!mask) {
        mask = document.createElement('div')
        mask.id = maskId
        mask.className = 'hmr-mask'
        document.body.appendChild(mask)
      }
      return mask as HTMLDivElement
    }
    const show = () => { ensureMask().classList.add('active') }
    const hideSoon = () => { setTimeout(() => ensureMask().classList.remove('active'), 120) }

    ;(import.meta as any).hot.on('vite:beforeUpdate', () => {
      // HMR update incoming; briefly mask
      show()
    })
    ;(import.meta as any).hot.on('vite:afterUpdate', () => {
      hideSoon()
    })
    ;(import.meta as any).hot.on('full-reload', () => {
      // Mask until the new page paints; keep active, browser reload will clear
      show()
    })
  } catch {}
}
