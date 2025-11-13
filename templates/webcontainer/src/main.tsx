import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Desktop from './desktop/Desktop'
import './globals.css'
import './desktop/styles.css'

type MaskMode = 'agent' | 'error' | 'reload' | 'hmr' | 'boot'

type ViteHotEvent = 'vite:beforeUpdate' | 'vite:afterUpdate' | 'full-reload' | 'vite:error'

type ViteHot = {
  on(event: ViteHotEvent, callback: (payload?: unknown) => void): void
}

type ViteErrorPayload = {
  err?: {
    message?: string
    stack?: string
    plugin?: string
    id?: string
    frame?: string
  }
}

class SnapshotMask {
  private overlay: HTMLDivElement
  private hideTimer: number | null = null
  private pinned: MaskMode | null = null

  constructor() {
    this.overlay = this.ensureOverlay()
  }

  private ensureOverlay() {
    const existing = document.getElementById('vite-hmr-mask')
    if (existing instanceof HTMLDivElement) {
      existing.classList.add('hmr-mask')
      return existing
    }
    const el = document.createElement('div')
    el.id = 'vite-hmr-mask'
    el.className = 'hmr-mask'
    document.body.appendChild(el)
    return el
  }

  private takeSnapshot() {
    const root = document.getElementById('root')
    if (!root) return
    const clone = root.cloneNode(true) as HTMLElement
    clone.id = 'hmr-mask-snapshot'
    clone.setAttribute('aria-hidden', 'true')
    clone.dataset.hmrSnapshot = 'true'
    clone.querySelectorAll('script').forEach((node) => node.remove())
    this.overlay.replaceChildren(clone)
  }

  private show(mode: MaskMode) {
    this.takeSnapshot()
    this.overlay.dataset.mode = mode
    this.overlay.classList.add('active')
  }

  flash(mode: MaskMode = 'hmr') {
    if (this.pinned) {
      this.takeSnapshot()
      return
    }
    this.show(mode)
    this.scheduleHide()
  }

  pin(mode: MaskMode = 'hmr') {
    this.pinned = mode
    this.show(mode)
  }

  unpin(mode?: MaskMode) {
    if (mode && this.pinned && this.pinned !== mode) return
    this.pinned = null
    this.clear()
  }

  private scheduleHide() {
    if (this.hideTimer) window.clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => {
      if (!this.pinned) {
        this.clear()
      }
    }, 140)
  }

  private clear() {
    this.overlay.classList.remove('active')
    this.overlay.dataset.mode = ''
    if (this.overlay.childNodes.length) {
      this.overlay.replaceChildren()
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Desktop />
  </StrictMode>
)

const hot = (import.meta as ImportMeta & { hot?: ViteHot }).hot
const mask = typeof window !== 'undefined' ? new SnapshotMask() : null

const MASK_MODES: MaskMode[] = ['agent', 'error', 'reload', 'hmr', 'boot']
const isMaskMode = (value: unknown): value is MaskMode => typeof value === 'string' && MASK_MODES.includes(value as MaskMode)

const sendBuildEvent = (type: 'APP_BUILD_ERROR' | 'APP_BUILD_ERROR_CLEARED', payload?: ViteErrorPayload) => {
  if (typeof window === 'undefined') return
  const target = window.parent || window.top
  if (!target) return
  if (type === 'APP_BUILD_ERROR') {
    const detail = payload?.err ?? {}
    const message = detail.message || 'Unknown build error'
    target.postMessage(
      {
        type,
        message,
        stack: detail.stack || '',
        plugin: detail.plugin || '',
        id: detail.id || '',
        frame: detail.frame || '',
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        timestamp: Date.now(),
      },
      '*',
    )
  } else {
    target.postMessage(
      {
        type,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        timestamp: Date.now(),
      },
      '*',
    )
  }
}


if (typeof window !== 'undefined' && mask) {
  const onMessage = (event: MessageEvent) => {
    const payload = event.data
    if (!payload || typeof payload !== 'object') return
    const type = (payload as { type?: unknown }).type
    if (type === 'FYOS_MASK_PIN') {
      const modeValue = (payload as { mode?: unknown }).mode
      const mode = isMaskMode(modeValue) ? modeValue : 'hmr'
      mask.pin(mode)
      return
    }
    if (type === 'FYOS_MASK_UNPIN') {
      const modeValue = (payload as { mode?: unknown }).mode
      const mode = isMaskMode(modeValue) ? modeValue : undefined
      mask.unpin(mode)
      return
    }
    if (type === 'FYOS_MASK_FLASH') {
      const modeValue = (payload as { mode?: unknown }).mode
      const mode = isMaskMode(modeValue) ? modeValue : 'hmr'
      mask.flash(mode)
    }
  }
  window.addEventListener('message', onMessage)
}

if (hot) {
  try {
    hot.on('vite:beforeUpdate', () => mask?.flash())
    hot.on('vite:afterUpdate', () => {
      mask?.unpin('error')
      mask?.unpin('reload')
      if (!mask) return
      mask.flash()
      sendBuildEvent('APP_BUILD_ERROR_CLEARED')
    })
    hot.on('full-reload', () => mask?.pin('reload'))
    hot.on('vite:error', (payload?: unknown) => {
      mask?.pin('error')
      sendBuildEvent('APP_BUILD_ERROR', payload as ViteErrorPayload)
    })
  } catch {}
}

// No agent-run masking: HMR updates flow normally without pausing
