import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Desktop from './desktop/Desktop'
import './desktop/styles.css'

type ViteHotEvent = 'vite:beforeUpdate' | 'vite:afterUpdate' | 'full-reload'

type ViteHot = {
  on(event: ViteHotEvent, callback: () => void): void
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>
)

// Lightweight HMR anti-flash mask
const hot = (import.meta as ImportMeta & { hot?: ViteHot }).hot
if (hot) {
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

    hot.on('vite:beforeUpdate', () => {
      // HMR update incoming; briefly mask
      show()
    })
    hot.on('vite:afterUpdate', () => {
      hideSoon()
    })
    hot.on('full-reload', () => {
      // Mask until the new page paints; keep active, browser reload will clear
      show()
    })
  } catch {}
}
