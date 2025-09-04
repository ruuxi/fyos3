# WebContainer Architecture Documentation

## Overview

This document provides a comprehensive overview of how WebContainer technology is integrated and utilized within the FYOS3 application, including its interaction patterns, isolation mechanisms, and architectural considerations.

## Table of Contents

- [Core Technology](#core-technology)
- [Current Implementation](#current-implementation)
- [Interaction Flow](#interaction-flow)
- [Isolation Mechanisms](#isolation-mechanisms)
- [Current Limitations](#current-limitations)
- [Future Considerations](#future-considerations)

## Core Technology

### WebContainer API

WebContainer (`@webcontainer/api`) is a browser-based Node.js runtime that enables running Node.js applications entirely within the browser environment. Key characteristics include:

- **Browser-Native**: Runs entirely in the browser without server-side components
- **Process Isolation**: Uses browser-level sandboxing and Web Workers for process isolation
- **Virtual File System**: Provides a fully virtualized file system contained within the browser
- **Node.js Compatibility**: Supports most Node.js APIs and npm packages

### Key Components

1. **WebContainer Instance**: The core runtime environment
2. **Virtual File System**: In-memory file system for application files
3. **Process Management**: Controlled spawning and management of processes
4. **Network Layer**: Virtual networking for dev servers and HTTP requests

## Current Implementation

### Initialization Process

```typescript
// WebContainer boots with specific configuration
{
  coep: 'credentialless'  // Cross-Origin Embedder Policy for isolation
}

// Instance stored globally for reuse
(global as any).webcontainerInstance = await WebContainer.boot(config)
```

### Dev Server Configuration

- **Dynamic Port Assignment**: WebContainer assigns ports dynamically
- **Server URL Generation**: Automatically generates accessible URLs for iframe consumption
- **Hot Reload Support**: Maintains development server features within the container

## Interaction Flow

### 1. Initialization Flow

```
Application Start
    ↓
WebContainer.boot()
    ↓
Store Instance Globally
    ↓
Start Dev Server
    ↓
Generate Server URL
    ↓
Load in iframe
```

### 2. Data Flow Patterns

#### Host → WebContainer
- File operations (create, update, delete)
- Command execution (npm install, build, etc.)
- Environment configuration

#### WebContainer → Host
- Server ready events
- Output streams (stdout, stderr)
- Process status updates
- Error notifications

#### iframe ↔ Host
- PostMessage communication
- First Contentful Paint (FCP) notifications
- User interaction events
- Console output forwarding

### 3. iframe Integration

The iframe component integrates with WebContainer through:

```html
<iframe
  src={webcontainerServerUrl}
  sandbox="allow-forms allow-modals allow-popups 
           allow-presentation allow-same-origin 
           allow-scripts allow-downloads"
/>
```

**Sandbox Attributes Explained:**
- `allow-forms`: Permits form submission
- `allow-modals`: Enables alert/confirm/prompt
- `allow-popups`: Allows window.open()
- `allow-presentation`: Permits Presentation API
- `allow-same-origin`: Treats content as same-origin
- `allow-scripts`: Enables JavaScript execution
- `allow-downloads`: Permits file downloads

## Isolation Mechanisms

### Browser-Level Isolation

1. **iframe Sandbox Attribute**
   - Restricts capabilities of embedded content
   - Provides configurable permission model
   - Prevents unauthorized access to parent window

2. **Cross-Origin Embedder Policy (COEP)**
   - Prevents loading of non-CORS cross-origin resources
   - Required for SharedArrayBuffer support
   - Enhances security boundaries

3. **Same-Origin Policy**
   - Prevents direct DOM access between contexts
   - Enforces communication through postMessage
   - Maintains security isolation

### WebContainer-Level Isolation

1. **Instance Isolation**
   - Each WebContainer instance is isolated
   - No shared state between instances
   - Independent process spaces

2. **File System Virtualization**
   - Completely virtualized file system
   - No access to host file system
   - Contained within browser storage

3. **Process Control**
   - Managed process spawning
   - Controlled resource allocation
   - Sandboxed execution environment

## Current Limitations

### 1. Single Instance Architecture

**Current State:**
- Using one global WebContainer instance
- Stored as `(global as any).webcontainerInstance`
- Shared across all applications in the session

**Implications:**
- All apps share the same virtual file system
- Potential for cross-application interference
- Limited true multi-tenancy support

### 2. Port Management

**Challenges:**
- Multiple dev servers could conflict on ports
- Dynamic port assignment may cause collisions
- No built-in port namespace isolation

### 3. Resource Consumption

**Considerations:**
- Each WebContainer instance uses significant memory
- SharedArrayBuffer requirements impact performance
- Browser memory limits affect scalability

### 4. COEP Requirements

**Constraints:**
- SharedArrayBuffer requires specific COEP settings
- Makes multi-instance architecture more challenging
- Limits certain cross-origin resource loading

## Implementation Status ✅

The production-ready multi-container architecture has been implemented with the following components:

### Core Services

1. **WebContainerOrchestrator** (`src/services/WebContainerOrchestrator.ts`)
   - Manages multiple WebContainer instances
   - Handles container lifecycle (create, suspend, resume, terminate)
   - Implements memory pressure handling and LRU eviction
   - Supports up to 10 concurrent containers with 2GB memory limit

2. **Multi-App Persistence** (`src/utils/multi-app-persistence.ts`)
   - IndexedDB-based persistence per application
   - Separate storage namespaces for each app
   - Auto-save functionality with debouncing
   - Storage pruning for old applications

3. **Application Router** (`src/services/ApplicationRouter.ts`)
   - URL-based routing for applications
   - Deep linking support
   - Preloading capabilities
   - Route state management

### React Components

1. **Enhanced WebContainerProvider** (`src/components/WebContainerProvider.tsx`)
   - Orchestrator integration
   - App-aware file system operations
   - Backward compatibility with legacy code
   - New hooks: `useAppContainer`, `useWebContainer`

2. **Multi-Instance WebContainer** (`src/components/WebContainer.tsx`)
   - Accepts `appId` prop for container identification
   - Auto-save on visibility changes and unmount
   - Restore from persisted state
   - Error recovery and retry mechanisms

3. **Demo Component** (`src/components/MultiAppDemo.tsx`)
   - Showcases multi-container functionality
   - Real-time metrics display
   - Container management UI
   - Storage management

### Usage Example

```typescript
// Basic usage - single app
<WebContainer 
  appId="my-editor"
  displayName="Code Editor"
  onReady={(container) => console.log('Container ready', container)}
/>

// Multiple apps with routing
function MyApp() {
  const { createApp, getContainer } = useWebContainer();
  
  const launchEditor = async () => {
    const container = await createApp({
      appId: 'editor',
      displayName: 'Code Editor',
      autoSuspend: true,
      suspendAfterMs: 5 * 60 * 1000
    });
    
    // Container is now running
    console.log('Editor URL:', container.serverUrl);
  };
}

// App-specific operations
const { writeFile, readFile } = useWebContainer();
await writeFile('/app.js', 'console.log("Hello")', 'editor');
const content = await readFile('/app.js', 'utf-8', 'editor');
```

## Future Considerations

### Multi-Application Isolation Strategies

#### Option 1: Multiple WebContainer Instances

**Pros:**
- True isolation between applications
- Independent file systems
- Separate process spaces

**Cons:**
- High memory consumption
- COEP/SharedArrayBuffer complexity
- Browser resource limits

**Implementation Approach:**
```typescript
const instances = new Map<string, WebContainer>()

async function getOrCreateInstance(appId: string) {
  if (!instances.has(appId)) {
    instances.set(appId, await WebContainer.boot())
  }
  return instances.get(appId)
}
```

#### Option 2: Single Container with Namespacing

**Pros:**
- Lower resource consumption
- Simpler COEP management
- Better performance

**Cons:**
- Requires custom isolation layer
- More complex file system management
- Potential security considerations

**Implementation Approach:**
```typescript
// Namespace file system paths
const appPath = `/apps/${appId}`

// Namespace ports
const portRange = getPortRangeForApp(appId)

// Process isolation through prefixing
const processPrefix = `app-${appId}-`
```

#### Option 3: Hybrid Approach

**Strategy:**
- Use single container for development environments
- Spawn separate instances for production builds
- Implement namespace isolation for file systems
- Use port ranges for network isolation

### Recommended Improvements

1. **Instance Management Service**
   ```typescript
   class WebContainerManager {
     private instances: Map<string, WebContainer>
     private portAllocator: PortAllocator
     
     async getContainer(appId: string): Promise<WebContainer>
     async destroyContainer(appId: string): Promise<void>
     async allocatePort(appId: string): Promise<number>
   }
   ```

2. **File System Isolation**
   - Implement virtual path namespacing
   - Create app-specific mount points
   - Add file system quota management

3. **Resource Management**
   - Implement instance pooling
   - Add memory monitoring
   - Create cleanup strategies for idle instances

4. **Security Enhancements**
   - Add CSP headers for iframe content
   - Implement message validation for postMessage
   - Create audit logging for container operations

## Communication Patterns

### PostMessage Protocol

Current implementation uses postMessage for cross-origin communication:

```typescript
// From iframe to host
window.parent.postMessage({
  type: 'FCP_DETECTED',
  timestamp: Date.now()
}, '*')

// From host to iframe
iframe.contentWindow.postMessage({
  type: 'COMMAND',
  payload: { /* command data */ }
}, iframeOrigin)
```

### Recommended Message Structure

```typescript
interface WebContainerMessage {
  id: string           // Unique message ID
  type: MessageType    // Enumerated message types
  appId: string       // Application identifier
  payload: unknown    // Type-safe payload
  timestamp: number   // Message timestamp
}
```

## Performance Considerations

### Memory Management
- Monitor WebContainer memory usage
- Implement garbage collection for unused instances
- Consider memory limits per application

### Loading Optimization
- Cache WebContainer boot process
- Implement lazy loading for applications
- Use service workers for resource caching

### Network Performance
- Optimize dev server startup time
- Implement connection pooling
- Consider WebSocket for real-time updates

## Security Best Practices

1. **Never expose WebContainer instance globally in production**
2. **Validate all postMessage communications**
3. **Implement rate limiting for container operations**
4. **Use Content Security Policy (CSP) headers**
5. **Sanitize file paths and command inputs**
6. **Implement session-based access control**
7. **Monitor and log container operations**
8. **Regular security audits of isolation boundaries**

## References

- [WebContainer API Documentation](https://webcontainers.io/api)
- [Cross-Origin Embedder Policy (COEP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy)
- [iframe Sandbox Attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox)
- [PostMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)

---

*Last Updated: September 2025*
*Document Version: 1.0.0*