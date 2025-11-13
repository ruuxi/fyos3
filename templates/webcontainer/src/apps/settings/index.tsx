import { useState } from 'react'

type WallpaperTheme = 'default' | '1' | '2' | '3' | '4' | '5'

export default function Settings() {
  const [wallpaper, setWallpaper] = useState<WallpaperTheme>(() => {
    try {
      return (localStorage.getItem('fyos-wallpaper') as WallpaperTheme) || 'default'
    } catch {
      return 'default'
    }
  })

  const [animationsEnabled, setAnimationsEnabled] = useState(() => {
    try {
      return localStorage.getItem('fyos-animations') !== 'false'
    } catch {
      return true
    }
  })

  const [iconSize, setIconSize] = useState(() => {
    try {
      return parseInt(localStorage.getItem('fyos-icon-size') || '64', 10)
    } catch {
      return 64
    }
  })

  const themeNames: Record<WallpaperTheme, string> = {
    'default': 'Default (Image)',
    '1': 'Deep Purple',
    '2': 'Slate Blue',
    '3': 'Forest Green',
    '4': 'Mystic Pink',
    '5': 'Ocean Blue'
  }

  const handleWallpaperChange = (theme: WallpaperTheme) => {
    setWallpaper(theme)
    try {
      localStorage.setItem('fyos-wallpaper', theme)
      window.parent?.postMessage({
        type: 'FYOS_SET_WALLPAPER',
        theme
      }, '*')
    } catch (e) {
      console.error('Failed to update wallpaper:', e)
    }
  }

  const handleAnimationsToggle = () => {
    const newValue = !animationsEnabled
    setAnimationsEnabled(newValue)
    try {
      localStorage.setItem('fyos-animations', newValue.toString())
      window.parent?.postMessage({
        type: 'FYOS_SET_ANIMATIONS',
        enabled: newValue
      }, '*')
    } catch (e) {
      console.error('Failed to update animations:', e)
    }
  }

  const handleIconSizeChange = (size: number) => {
    setIconSize(size)
    try {
      localStorage.setItem('fyos-icon-size', size.toString())
      window.parent?.postMessage({
        type: 'FYOS_SET_ICON_SIZE',
        size
      }, '*')
    } catch (e) {
      console.error('Failed to update icon size:', e)
    }
  }

  const handleResetWindows = () => {
    if (!confirm('Reset all window positions and sizes? This cannot be undone.')) {
      return
    }
    
    try {
      window.parent?.postMessage({
        type: 'FYOS_RESET_WINDOWS'
      }, '*')
      alert('Window positions have been reset')
    } catch (e) {
      console.error('Failed to reset windows:', e)
    }
  }

  const handleResetIcons = () => {
    if (!confirm('Reset all desktop icon positions? This cannot be undone.')) {
      return
    }
    
    try {
      window.parent?.postMessage({
        type: 'FYOS_RESET_ICONS'
      }, '*')
      alert('Icon positions have been reset')
    } catch (e) {
      console.error('Failed to reset icons:', e)
    }
  }

  return (
    <div className="h-full overflow-auto" style={{ background: 'rgba(12,18,36,0.02)', color: '#e5e7eb' }}>
      <div className="p-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">Settings</h1>
          <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>System</span>
        </div>

        {/* Appearance */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-3" style={{ color: '#cbd5e1' }}>APPEARANCE</h2>
          
          <div className="p-4 rounded-lg mb-3" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <label className="block mb-2 text-sm font-medium">Wallpaper Theme</label>
            <select
              value={wallpaper}
              onChange={(e) => handleWallpaperChange(e.target.value as WallpaperTheme)}
              className="w-full px-3 py-2 text-sm rounded"
              style={{
                background: 'rgba(12,18,36,0.9)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#e5e7eb'
              }}
            >
              {(Object.keys(themeNames) as WallpaperTheme[]).map(key => (
                <option key={key} value={key} style={{ background: '#1a1f36', color: '#e5e7eb' }}>{themeNames[key]}</option>
              ))}
            </select>
            <p className="mt-2 text-xs" style={{ color: '#cbd5e1' }}>
              Choose a gradient theme for your desktop background
            </p>
          </div>

          <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <label className="block mb-2 text-sm font-medium">Desktop Icon Size: {iconSize}px</label>
            <input
              type="range"
              min="48"
              max="80"
              step="4"
              value={iconSize}
              onChange={(e) => handleIconSizeChange(Number(e.target.value))}
              className="w-full"
            />
            <p className="mt-2 text-xs" style={{ color: '#cbd5e1' }}>
              Adjust the size of desktop icons (48px - 80px)
            </p>
          </div>
        </section>

        {/* Behavior */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-3" style={{ color: '#cbd5e1' }}>BEHAVIOR</h2>
          
          <div className="p-4 rounded-lg mb-3" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <label className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium mb-1">Window Animations</div>
                <p className="text-xs" style={{ color: '#cbd5e1' }}>
                  Enable smooth animations for windows
                </p>
              </div>
              <div className="relative inline-block w-12 h-6">
                <input
                  type="checkbox"
                  checked={animationsEnabled}
                  onChange={handleAnimationsToggle}
                  className="sr-only peer"
                />
                <div
                  onClick={handleAnimationsToggle}
                  className="w-12 h-6 rounded-full cursor-pointer transition-colors"
                  style={{
                    background: animationsEnabled ? 'rgba(56,189,248,0.6)' : 'rgba(255,255,255,0.2)',
                    border: `1px solid ${animationsEnabled ? 'rgba(56,189,248,0.8)' : 'rgba(255,255,255,0.3)'}`
                  }}
                >
                  <div
                    className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform"
                    style={{
                      background: '#ffffff',
                      transform: animationsEnabled ? 'translateX(24px)' : 'translateX(0)'
                    }}
                  />
                </div>
              </div>
            </label>
          </div>
        </section>

        {/* Window Management */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-3" style={{ color: '#cbd5e1' }}>WINDOW MANAGEMENT</h2>
          
          <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <div className="mb-3">
              <div className="text-sm font-medium mb-1">Reset Window Positions</div>
              <p className="text-xs mb-3" style={{ color: '#cbd5e1' }}>
                Clear all saved window positions and sizes
              </p>
              <button
                onClick={handleResetWindows}
                className="px-4 py-2 text-sm rounded transition-all"
                style={{
                  background: 'rgba(239,68,68,0.2)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  color: '#e5e7eb'
                }}
              >
                Reset Windows
              </button>
            </div>

            <div className="pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="text-sm font-medium mb-1">Reset Icon Positions</div>
              <p className="text-xs mb-3" style={{ color: '#cbd5e1' }}>
                Reset all desktop icons to default positions
              </p>
              <button
                onClick={handleResetIcons}
                className="px-4 py-2 text-sm rounded transition-all"
                style={{
                  background: 'rgba(239,68,68,0.2)',
                  border: '1px solid rgba(239,68,68,0.4)',
                  color: '#e5e7eb'
                }}
              >
                Reset Icons
              </button>
            </div>
          </div>
        </section>

        {/* About */}
        <section>
          <h2 className="text-sm font-semibold mb-3" style={{ color: '#cbd5e1' }}>ABOUT</h2>
          
          <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)' }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl">🖥️</div>
              <div>
                <div className="text-sm font-semibold">FromYou Desktop</div>
                <div className="text-xs" style={{ color: '#cbd5e1' }}>AI-First Infinite Creation Desktop</div>
              </div>
            </div>
            <div className="text-xs space-y-1" style={{ color: '#cbd5e1' }}>
              <div>Version: 1.0.0</div>
              <div>Build: WebContainer Runtime</div>
              <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                Create anything with AI-powered apps
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
