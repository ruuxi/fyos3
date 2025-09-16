import React, { StrictMode, Component, ComponentType, ErrorInfo, ReactNode } from 'react'
import { createRoot as createReactRoot } from 'react-dom/client'

interface ErrorBoundaryProps {
  name?: string;
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps){
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState{
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo){
    try{ console.error('[App iframe] render error:', error, info) } catch{}
  }
  render(){
    const { error } = this.state
    if (error){
      const message = (error && (error.message || String(error))) || 'Unknown error'
      return React.createElement('div', {
        style: {
          height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.75)', color: '#991b1b', padding: 16, textAlign: 'center'
        }, role: 'alert'
      },
      React.createElement('div', { style: { fontWeight: 600, marginBottom: 6 } }, 'This app crashed'),
      React.createElement('div', { style: { fontSize: 12, color: '#7f1d1d', whiteSpace: 'pre-wrap' } }, message),
      React.createElement('button', { onClick: ()=> location.reload(), style: { marginTop: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #fecaca', background: '#fee2e2', color: '#7f1d1d' } }, 'Reload app')
      )
    }
    return this.props.children
  }
}

export function createRoot(mountEl: HTMLElement, Comp: ComponentType | null | undefined, name?: string){
  const root = createReactRoot(mountEl)
  function Wrapper(){
    if (!Comp) return React.createElement('div', null, `Missing component: ${name || 'App'}`)
    return React.createElement(Comp)
  }
  root.render(
    React.createElement(StrictMode, null,
      React.createElement(ErrorBoundary, { name },
        React.createElement(Wrapper)
      )
    )
  )
  return root
}

