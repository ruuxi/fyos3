import { WebContainer as WebContainerAPI } from '@webcontainer/api';
import { EventEmitter } from 'events';
import { 
  multiAppPersistence, 
  autoSaveManager, 
  exportAppVfs, 
  restoreAppVfs,
  type PersistedVfs 
} from '@/utils/multi-app-persistence';

export interface ContainerConfig {
  appId: string;
  displayName?: string;
  memoryLimit?: number; // In MB
  cpuLimit?: number; // Percentage (0-100)
  autoSuspend?: boolean; // Auto-suspend after inactivity
  suspendAfterMs?: number; // Milliseconds of inactivity before suspension
}

export interface ContainerMetrics {
  appId: string;
  displayName: string;
  state: ContainerState;
  memoryUsage: number; // Estimated in MB
  createdAt: number;
  lastAccessedAt: number;
  uptime: number; // Milliseconds
  serverUrl?: string;
  port?: number;
}

export type ContainerState = 
  | 'initializing' 
  | 'active' 
  | 'suspended' 
  | 'terminating' 
  | 'terminated'
  | 'error';

export interface NetworkPolicy {
  allowedPorts?: number[];
  blockedPorts?: number[];
  maxConnections?: number;
}

export class ContainerInstance extends EventEmitter {
  private _container: WebContainerAPI | null = null;
  private _state: ContainerState = 'initializing';
  private _serverUrl?: string;
  private _port?: number;
  private _lastAccessTime: number;
  private _createdAt: number;
  private _suspendedVFS?: PersistedVfs;
  private _suspendTimer?: NodeJS.Timeout;
  private _memoryUsage: number = 100; // Base memory estimate in MB

  constructor(
    public readonly appId: string,
    public readonly config: ContainerConfig,
    container: WebContainerAPI
  ) {
    super();
    this._container = container;
    this._createdAt = Date.now();
    this._lastAccessTime = Date.now();
    this.setupAutoSuspend();
    this.setupEventListeners();
  }

  get state(): ContainerState {
    return this._state;
  }

  get container(): WebContainerAPI | null {
    this.updateLastAccess();
    return this._container;
  }

  get serverUrl(): string | undefined {
    return this._serverUrl;
  }

  get port(): number | undefined {
    return this._port;
  }

  get metrics(): ContainerMetrics {
    return {
      appId: this.appId,
      displayName: this.config.displayName || this.appId,
      state: this._state,
      memoryUsage: this._memoryUsage,
      createdAt: this._createdAt,
      lastAccessedAt: this._lastAccessTime,
      uptime: Date.now() - this._createdAt,
      serverUrl: this._serverUrl,
      port: this._port,
    };
  }

  private setupEventListeners(): void {
    if (!this._container) return;

    this._container.on('server-ready', (port: number, url: string) => {
      this._port = port;
      this._serverUrl = url;
      this._state = 'active';
      this.emit('server-ready', { port, url });
      console.log(`[Container ${this.appId}] Server ready on port ${port}: ${url}`);
    });

    this._container.on('error', (error: Error) => {
      this._state = 'error';
      this.emit('error', error);
      console.error(`[Container ${this.appId}] Error:`, error);
    });
  }

  private setupAutoSuspend(): void {
    if (!this.config.autoSuspend) return;

    const suspendAfter = this.config.suspendAfterMs || 5 * 60 * 1000; // Default 5 minutes

    const resetTimer = () => {
      if (this._suspendTimer) {
        clearTimeout(this._suspendTimer);
      }

      if (this._state === 'active') {
        this._suspendTimer = setTimeout(() => {
          console.log(`[Container ${this.appId}] Auto-suspending due to inactivity`);
          this.suspend().catch(err => {
            console.error(`[Container ${this.appId}] Failed to auto-suspend:`, err);
          });
        }, suspendAfter);
      }
    };

    this.on('access', resetTimer);
    resetTimer();
  }

  private updateLastAccess(): void {
    this._lastAccessTime = Date.now();
    this.emit('access');
  }

  async suspend(): Promise<void> {
    if (this._state !== 'active' || !this._container) {
      return;
    }

    console.log(`[Container ${this.appId}] Suspending...`);
    this._state = 'suspended';

    // Save VFS state to IndexedDB
    try {
      this._suspendedVFS = await exportAppVfs(this._container);
      await multiAppPersistence.saveAppState(
        this.appId, 
        this._suspendedVFS, 
        this.config.displayName
      );
      console.log(`[Container ${this.appId}] VFS saved to IndexedDB`);
    } catch (error) {
      console.error(`[Container ${this.appId}] Failed to save VFS:`, error);
    }

    // Teardown container to free memory
    try {
      await this._container.teardown();
    } catch (error) {
      console.error(`[Container ${this.appId}] Teardown error:`, error);
    }

    this._container = null;
    this._memoryUsage = 10; // Suspended containers use minimal memory
    this.emit('suspended');
  }

  async resume(): Promise<void> {
    if (this._state !== 'suspended') {
      return;
    }

    console.log(`[Container ${this.appId}] Resuming...`);
    this._state = 'initializing';
    
    try {
      // Re-boot container
      this._container = await WebContainerAPI.boot({
        coep: 'credentialless',
        workdirName: `app-${this.appId}`
      });

      // Restore VFS from suspension
      if (this._suspendedVFS) {
        const restored = await restoreAppVfs(this._container, this._suspendedVFS);
        if (restored) {
          console.log(`[Container ${this.appId}] VFS restored from suspension`);
        }
      } else {
        // Try to load from IndexedDB if not in memory
        const persistedVfs = await multiAppPersistence.loadAppState(this.appId);
        if (persistedVfs) {
          const restored = await restoreAppVfs(this._container, persistedVfs);
          if (restored) {
            console.log(`[Container ${this.appId}] VFS restored from IndexedDB`);
          }
        }
      }

      this._state = 'active';
      this._memoryUsage = 100; // Reset to base memory
      this.setupEventListeners();
      this.setupAutoSuspend();
      this.emit('resumed');
      
    } catch (error) {
      this._state = 'error';
      this.emit('error', error);
      throw error;
    }
  }

  async terminate(): Promise<void> {
    if (this._state === 'terminated') {
      return;
    }

    console.log(`[Container ${this.appId}] Terminating...`);
    this._state = 'terminating';

    if (this._suspendTimer) {
      clearTimeout(this._suspendTimer);
    }

    if (this._container) {
      try {
        await this._container.teardown();
      } catch (error) {
        console.error(`[Container ${this.appId}] Teardown error:`, error);
      }
    }

    this._container = null;
    this._state = 'terminated';
    this.emit('terminated');
    this.removeAllListeners();
  }

  isActive(): boolean {
    return this._state === 'active' && this._container !== null;
  }

  getEstimatedMemory(): number {
    return this._memoryUsage;
  }
}

export class WebContainerOrchestrator extends EventEmitter {
  private containers = new Map<string, ContainerInstance>();
  private maxContainers: number = 10;
  private maxMemoryMB: number = 2048;
  private defaultContainer?: ContainerInstance; // For backward compatibility
  private lruList: string[] = []; // Least Recently Used tracking

  constructor(config?: {
    maxContainers?: number;
    maxMemoryMB?: number;
  }) {
    super();
    if (config?.maxContainers) this.maxContainers = config.maxContainers;
    if (config?.maxMemoryMB) this.maxMemoryMB = config.maxMemoryMB;
    
    console.log('[Orchestrator] Initialized with limits:', {
      maxContainers: this.maxContainers,
      maxMemoryMB: this.maxMemoryMB
    });
  }

  async createApplication(config: ContainerConfig): Promise<ContainerInstance> {
    // Check if container already exists
    if (this.containers.has(config.appId)) {
      const existing = this.containers.get(config.appId)!;
      if (existing.state === 'suspended') {
        await existing.resume();
      }
      this.updateLRU(config.appId);
      return existing;
    }

    // Check resource limits
    await this.enforceResourceLimits();

    console.log(`[Orchestrator] Creating container for app: ${config.appId}`);
    
    // Boot new container
    const webcontainer = await WebContainerAPI.boot({
      coep: 'credentialless',
      workdirName: `app-${config.appId}`
    });

    // Create container instance
    const instance = new ContainerInstance(config.appId, config, webcontainer);
    
    // Track container
    this.containers.set(config.appId, instance);
    this.updateLRU(config.appId);

    // Set as default if first container (backward compatibility)
    if (!this.defaultContainer) {
      this.defaultContainer = instance;
    }

    // Listen for container events
    instance.on('suspended', () => {
      this.emit('container-suspended', config.appId);
    });

    instance.on('error', (error) => {
      this.emit('container-error', { appId: config.appId, error });
    });

    this.emit('container-created', config.appId);
    
    return instance;
  }

  async suspendApplication(appId: string): Promise<void> {
    const container = this.containers.get(appId);
    if (container) {
      await container.suspend();
    }
  }

  async resumeApplication(appId: string): Promise<ContainerInstance | null> {
    const container = this.containers.get(appId);
    if (container) {
      await container.resume();
      this.updateLRU(appId);
      return container;
    }
    return null;
  }

  async terminateApplication(appId: string): Promise<void> {
    const container = this.containers.get(appId);
    if (container) {
      await container.terminate();
      this.containers.delete(appId);
      this.lruList = this.lruList.filter(id => id !== appId);
      
      // Update default container if needed
      if (this.defaultContainer?.appId === appId) {
        this.defaultContainer = this.containers.values().next().value;
      }
      
      this.emit('container-terminated', appId);
    }
  }

  getContainer(appId: string): ContainerInstance | undefined {
    const container = this.containers.get(appId);
    if (container) {
      this.updateLRU(appId);
    }
    return container;
  }

  getDefaultContainer(): ContainerInstance | undefined {
    return this.defaultContainer;
  }

  getAllContainers(): ContainerInstance[] {
    return Array.from(this.containers.values());
  }

  getMetrics(): {
    total: number;
    active: number;
    suspended: number;
    memoryUsageMB: number;
    containers: ContainerMetrics[];
  } {
    const containers = Array.from(this.containers.values());
    const active = containers.filter(c => c.state === 'active').length;
    const suspended = containers.filter(c => c.state === 'suspended').length;
    const memoryUsageMB = containers.reduce((sum, c) => sum + c.getEstimatedMemory(), 0);

    return {
      total: containers.length,
      active,
      suspended,
      memoryUsageMB,
      containers: containers.map(c => c.metrics),
    };
  }

  private updateLRU(appId: string): void {
    // Remove from current position
    this.lruList = this.lruList.filter(id => id !== appId);
    // Add to end (most recently used)
    this.lruList.push(appId);
  }

  private async enforceResourceLimits(): Promise<void> {
    // Check container count limit
    if (this.containers.size >= this.maxContainers) {
      await this.evictLRUContainer();
    }

    // Check memory limit
    while (this.getTotalMemoryUsage() > this.maxMemoryMB) {
      await this.handleMemoryPressure();
    }
  }

  private async evictLRUContainer(): Promise<void> {
    if (this.lruList.length === 0) return;

    // Find least recently used container that can be evicted
    for (const appId of this.lruList) {
      const container = this.containers.get(appId);
      if (container && container.appId !== this.defaultContainer?.appId) {
        console.log(`[Orchestrator] Evicting LRU container: ${appId}`);
        
        // Try to suspend first, terminate if needed
        if (container.state === 'active') {
          await container.suspend();
        } else {
          await this.terminateApplication(appId);
        }
        break;
      }
    }
  }

  private async handleMemoryPressure(): Promise<void> {
    console.log('[Orchestrator] Handling memory pressure...');
    
    // First, try to suspend inactive containers
    for (const appId of this.lruList) {
      if (this.getTotalMemoryUsage() <= this.maxMemoryMB) break;
      
      const container = this.containers.get(appId);
      if (container && container.state === 'active' && container.appId !== this.defaultContainer?.appId) {
        await container.suspend();
      }
    }

    // If still over limit, terminate suspended containers
    if (this.getTotalMemoryUsage() > this.maxMemoryMB) {
      for (const appId of this.lruList) {
        if (this.getTotalMemoryUsage() <= this.maxMemoryMB) break;
        
        const container = this.containers.get(appId);
        if (container && container.state === 'suspended') {
          await this.terminateApplication(appId);
        }
      }
    }
  }

  private getTotalMemoryUsage(): number {
    let total = 0;
    for (const container of this.containers.values()) {
      total += container.getEstimatedMemory();
    }
    return total;
  }

  async shutdown(): Promise<void> {
    console.log('[Orchestrator] Shutting down all containers...');
    
    // Terminate all containers
    const promises: Promise<void>[] = [];
    for (const container of this.containers.values()) {
      promises.push(container.terminate());
    }
    
    await Promise.all(promises);
    this.containers.clear();
    this.lruList = [];
    this.defaultContainer = undefined;
    this.removeAllListeners();
    
    console.log('[Orchestrator] Shutdown complete');
  }
}

// Singleton instance for global access
let orchestratorInstance: WebContainerOrchestrator | null = null;

export function getOrchestrator(): WebContainerOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new WebContainerOrchestrator();
  }
  return orchestratorInstance;
}

export function resetOrchestrator(): void {
  if (orchestratorInstance) {
    orchestratorInstance.shutdown().catch(console.error);
    orchestratorInstance = null;
  }
}