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
