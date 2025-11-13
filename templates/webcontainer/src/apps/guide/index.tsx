import React, { useState, useEffect } from 'react'

type Section = 'welcome' | 'ai-apps' | 'desktop' | 'settings' | 'tips'

interface TutorialSection {
  id: Section
  title: string
  icon: string
  content: React.ReactNode
}

export default function Guide() {
  const [activeSection, setActiveSection] = useState<Section>('welcome')
  const [completedSections, setCompletedSections] = useState<Section[]>(() => {
    try {
      const saved = localStorage.getItem('fyos-guide-progress')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('fyos-guide-progress', JSON.stringify(completedSections))
    } catch {}
  }, [completedSections])

  const markCompleted = (section: Section) => {
    if (!completedSections.includes(section)) {
      setCompletedSections([...completedSections, section])
    }
  }

  const openApp = (appId: string) => {
    try {
      window.parent?.postMessage({ type: 'FYOS_OPEN_APP', appId }, '*')
    } catch (e) {
      console.error('Failed to open app:', e)
    }
  }

  const scrollToSection = (section: Section) => {
    setActiveSection(section)
    markCompleted(section)
  }

  const TryItButton: React.FC<{ appId: string; label: string }> = ({ appId, label }) => (
    <button
      onClick={() => openApp(appId)}
      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-all"
      style={{
        background: 'rgba(56,189,248,0.3)',
        border: '1px solid rgba(56,189,248,0.5)',
        color: '#e5e7eb'
      }}
    >
      <span>▶</span> {label}
    </button>
  )

  const sections: TutorialSection[] = [
    {
      id: 'welcome',
      title: 'Welcome to FromYou',
      icon: '👋',
      content: (
        <div className="space-y-4">
          <p className="text-base leading-relaxed">
            Welcome to <strong>FromYou</strong> — an AI-first infinite creation desktop where you describe what you want, 
            and intelligent apps materialize to help you create.
          </p>
          
          <div className="p-4 rounded-lg" style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)' }}>
            <h3 className="text-sm font-semibold mb-2">🎯 What You Can Do</h3>
            <ul className="space-y-2 text-sm" style={{ color: '#cbd5e1' }}>
              <li>✨ Transform sketches into polished artwork with AI</li>
              <li>📸 Edit photos using natural language</li>
              <li>🎮 Play games and explore creative apps</li>
              <li>🎨 Customize your desktop experience</li>
              <li>🚀 Install and share apps with others</li>
            </ul>
          </div>

          <p className="text-sm" style={{ color: '#cbd5e1' }}>
            This guide will walk you through everything you need to know. Click on sections in the sidebar 
            to explore, or continue below to learn about AI-powered apps.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => scrollToSection('ai-apps')}
              className="px-4 py-2 text-sm font-medium rounded transition-all"
              style={{
                background: 'rgba(56,189,248,0.4)',
                border: '1px solid rgba(56,189,248,0.5)',
                color: '#e5e7eb'
              }}
            >
              Next: AI Apps →
            </button>
          </div>
        </div>
      )
    },
    {
      id: 'ai-apps',
      title: 'Using AI Apps',
      icon: '✨',
      content: (
        <div className="space-y-4">
          <p className="text-base leading-relaxed">
            FromYou includes powerful AI apps that turn your ideas into reality. Here's what you can create:
          </p>

          <div className="space-y-3">
            {/* Sketch Studio */}
            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div className="flex items-start gap-3 mb-2">
                <span className="text-2xl">🎨</span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-1">Sketch Studio</h3>
                  <p className="text-xs mb-2" style={{ color: '#cbd5e1' }}>
                    Draw rough sketches and watch AI transform them into polished artwork. 
                    Choose from styles like realistic, cartoon, anime, and more.
                  </p>
                  <TryItButton appId="sketch-studio" label="Open Sketch Studio" />
                </div>
              </div>
            </div>

            {/* Photo Lab */}
            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div className="flex items-start gap-3 mb-2">
                <span className="text-2xl">📸</span>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-1">Photo Lab</h3>
                  <p className="text-xs mb-2" style={{ color: '#cbd5e1' }}>
                    Edit photos using natural language. Just describe what you want: 
                    "make the sky more dramatic" or "change this to autumn colors".
                  </p>
                  <TryItButton appId="photo-lab" label="Open Photo Lab" />
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 rounded" style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)' }}>
            <p className="text-xs" style={{ color: '#cbd5e1' }}>
              💡 <strong>Tip:</strong> AI processing may take 10-30 seconds. Be patient and describe your vision clearly for best results.
            </p>
          </div>

          <button
            onClick={() => scrollToSection('desktop')}
            className="px-4 py-2 text-sm rounded"
            style={{
              background: 'rgba(56,189,248,0.4)',
              border: '1px solid rgba(56,189,248,0.5)',
              color: '#e5e7eb'
            }}
          >
            Next: Desktop Features →
          </button>
        </div>
      )
    },
    {
      id: 'desktop',
      title: 'Desktop Features',
      icon: '🖥️',
      content: (
        <div className="space-y-4">
          <p className="text-base leading-relaxed">
            Your FromYou desktop works like a modern operating system with windows, icons, and multitasking.
          </p>

          <div className="space-y-3">
            {/* Windows */}
            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <h3 className="text-sm font-semibold mb-2">📐 Windows & Tabs</h3>
              <ul className="space-y-2 text-sm" style={{ color: '#cbd5e1' }}>
                <li>• Click desktop icons to open apps in windows</li>
                <li>• Drag window edges to resize, drag title bar to move</li>
                <li>• Use tabs (+ button) to open multiple apps in one window</li>
                <li>• Minimize, expand, or close windows with buttons</li>
              </ul>
            </div>

            {/* Icons */}
            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <h3 className="text-sm font-semibold mb-2">🎯 Desktop Icons</h3>
              <ul className="space-y-2 text-sm" style={{ color: '#cbd5e1' }}>
                <li>• Drag icons to rearrange on your desktop</li>
                <li>• Click once to launch an app</li>
                <li>• Positions are automatically saved</li>
              </ul>
            </div>

            {/* More Apps */}
            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <h3 className="text-sm font-semibold mb-2">🎮 More Apps</h3>
              <ul className="space-y-2 text-sm mb-3" style={{ color: '#cbd5e1' }}>
                <li>• Explore all available apps from the desktop</li>
                <li>• Each app is designed for a specific creative purpose</li>
                <li>• More apps coming soon!</li>
              </ul>
              <div className="flex gap-2">
                <TryItButton appId="flappy-bird" label="Play Flappy Bird" />
              </div>
            </div>
          </div>

          <button
            onClick={() => scrollToSection('settings')}
            className="px-4 py-2 text-sm rounded"
            style={{
              background: 'rgba(56,189,248,0.4)',
              border: '1px solid rgba(56,189,248,0.5)',
              color: '#e5e7eb'
            }}
          >
            Next: Settings & Customization →
          </button>
        </div>
      )
    },
    {
      id: 'settings',
      title: 'Settings & Customization',
      icon: '⚙️',
      content: (
        <div className="space-y-4">
          <p className="text-base leading-relaxed">
            Customize your desktop experience to match your style and workflow.
          </p>

          <div className="space-y-3">
            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <h3 className="text-sm font-semibold mb-2">🎨 Appearance</h3>
              <ul className="space-y-2 text-sm" style={{ color: '#cbd5e1' }}>
                <li>• Choose from 5 beautiful gradient wallpaper themes</li>
                <li>• Adjust desktop icon size (48-80px)</li>
                <li>• All changes are saved automatically</li>
              </ul>
            </div>

            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <h3 className="text-sm font-semibold mb-2">⚡ Behavior</h3>
              <ul className="space-y-2 text-sm" style={{ color: '#cbd5e1' }}>
                <li>• Toggle window animations on/off</li>
                <li>• Reset window positions if they get messy</li>
                <li>• Reset icon positions to default grid</li>
              </ul>
            </div>

            <div className="mt-3">
              <TryItButton appId="settings" label="Open Settings" />
            </div>
          </div>

          <button
            onClick={() => scrollToSection('tips')}
            className="px-4 py-2 text-sm rounded"
            style={{
              background: 'rgba(56,189,248,0.4)',
              border: '1px solid rgba(56,189,248,0.5)',
              color: '#e5e7eb'
            }}
          >
            Next: Tips & Shortcuts →
          </button>
        </div>
      )
    },
    {
      id: 'tips',
      title: 'Tips & Shortcuts',
      icon: '💡',
      content: (
        <div className="space-y-4">
          <p className="text-base leading-relaxed">
            Here are some tips to help you get the most out of FromYou:
          </p>

          <div className="space-y-3">
            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <h3 className="text-sm font-semibold mb-2">🎯 Best Practices</h3>
              <ul className="space-y-2 text-sm" style={{ color: '#cbd5e1' }}>
                <li>• <strong>Be specific with AI:</strong> Detailed descriptions = better results</li>
                <li>• <strong>Experiment with styles:</strong> Try different AI styles for unique outputs</li>
                <li>• <strong>Save your work:</strong> Download AI-generated images before closing</li>
                <li>• <strong>Organize windows:</strong> Use tabs to group related apps together</li>
              </ul>
            </div>

            <div className="p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <h3 className="text-sm font-semibold mb-2">⌨️ Keyboard Shortcuts</h3>
              <ul className="space-y-2 text-sm" style={{ color: '#cbd5e1' }}>
                <li>• <strong>Space:</strong> Jump in Flappy Bird</li>
                <li>• <strong>Enter:</strong> Apply edits in Photo Lab</li>
                <li>• <strong>Esc:</strong> Close dialogs and modals</li>
              </ul>
            </div>

            <div className="p-4 rounded-lg" style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)' }}>
              <h3 className="text-sm font-semibold mb-2">🚀 What's Next?</h3>
              <p className="text-sm mb-3" style={{ color: '#cbd5e1' }}>
                You're all set! Start creating amazing things with AI. Need more apps? 
                Check the App Store or create your own.
              </p>
              <div className="flex gap-2">
                <TryItButton appId="sketch-studio" label="Start Creating" />
                <button
                  onClick={() => {
                    try {
                      localStorage.removeItem('fyos-guide-progress')
                      setCompletedSections([])
                      setActiveSection('welcome')
                    } catch {}
                  }}
                  className="px-3 py-1.5 text-sm rounded"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#e5e7eb'
                  }}
                >
                  Restart Guide
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ]

  const currentSection = sections.find(s => s.id === activeSection) || sections[0]
  const progress = Math.round((completedSections.length / sections.length) * 100)

  return (
    <div className="h-full flex" style={{ background: 'rgba(12,18,36,0.02)', color: '#e5e7eb' }}>
      {/* Sidebar */}
      <div 
        className="w-56 p-4 overflow-auto"
        style={{ 
          background: 'rgba(255,255,255,0.05)', 
          borderRight: '1px solid rgba(255,255,255,0.12)' 
        }}
      >
        <div className="mb-4">
          <h2 className="text-xs font-semibold mb-2" style={{ color: '#cbd5e1' }}>PROGRESS</h2>
          <div className="text-sm font-semibold mb-1">{progress}% Complete</div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div 
              className="h-full transition-all"
              style={{ 
                width: `${progress}%`, 
                background: 'linear-gradient(90deg, rgba(56,189,248,0.6), rgba(56,189,248,0.9))' 
              }}
            />
          </div>
        </div>

        <nav>
          <h2 className="text-xs font-semibold mb-2" style={{ color: '#cbd5e1' }}>SECTIONS</h2>
          <ul className="space-y-1">
            {sections.map(section => (
              <li key={section.id}>
                <button
                  onClick={() => scrollToSection(section.id)}
                  className="w-full text-left px-3 py-2 text-sm rounded transition-all flex items-center gap-2"
                  style={{
                    background: activeSection === section.id ? 'rgba(56,189,248,0.2)' : 'transparent',
                    border: `1px solid ${activeSection === section.id ? 'rgba(56,189,248,0.4)' : 'transparent'}`,
                    color: activeSection === section.id ? '#e5e7eb' : '#cbd5e1'
                  }}
                >
                  <span>{section.icon}</span>
                  <span className="flex-1">{section.title}</span>
                  {completedSections.includes(section.id) && <span>✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-3xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">{currentSection.icon}</span>
              <h1 className="text-2xl font-semibold">{currentSection.title}</h1>
            </div>
            {!completedSections.includes(currentSection.id) && (
              <button
                onClick={() => markCompleted(currentSection.id)}
                className="text-xs px-2 py-1 rounded"
                style={{
                  background: 'rgba(34,197,94,0.2)',
                  border: '1px solid rgba(34,197,94,0.4)',
                  color: '#cbd5e1'
                }}
              >
                Mark as Complete
              </button>
            )}
          </div>

          <div className="prose prose-invert max-w-none">
            {currentSection.content}
          </div>
        </div>
      </div>
    </div>
  )
}

