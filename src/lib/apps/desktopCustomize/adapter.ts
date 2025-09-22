import type { MutableRefObject } from 'react';
import type { WebContainer as WebContainerAPI } from '@webcontainer/api';

import {
  type DesktopCustomizeAsset,
  type DesktopCustomizeLayoutMutation,
  type DesktopCustomizeState,
  type DesktopCustomizeThemeMutation,
  type DesktopStateAdapter,
} from '@/lib/apps/desktopCustomize';

type FsBridge = {
  readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, recursive?: boolean) => Promise<void>;
};

type CreateDesktopStateAdapterOptions = {
  fs: FsBridge;
  instanceRef: MutableRefObject<WebContainerAPI | null>;
  now?: () => number;
  windowProvider?: () => (Window & typeof globalThis) | null;
};

type ValidationResult = {
  warnings?: string[];
  blockers?: string[];
};

type SimulationResult = {
  nextState: DesktopCustomizeState;
  warnings?: string[];
};

const DESKTOP_STATE_PATH = 'public/_fyos/desktop-state.json';
const THEME_STORAGE_KEY = 'fyos.desktop.theme';
const THEME_TOKENS_STORAGE_KEY = 'fyos.desktop.themeTokens';

export function createDesktopStateAdapter(options: CreateDesktopStateAdapterOptions): DesktopStateAdapter {
  const { fs, instanceRef, now = () => Date.now(), windowProvider = getDefaultWindow } = options;

  return {
    load: async () => {
      const state = await loadState(fs);
      const serialized = JSON.stringify(state);
      const hash = await computeHash(serialized);
      return { state, hash };
    },
    validate: async ({ request }): Promise<ValidationResult> => {
      const warnings: string[] = [];
      if (!Array.isArray(request.layoutMutations) || request.layoutMutations.length === 0) {
        if (!Array.isArray(request.themeMutations) || request.themeMutations.length === 0) {
          if (!Array.isArray(request.assets) || request.assets.length === 0) {
            warnings.push('No layout, theme, or asset mutations provided.');
          }
        }
      }
      return { warnings: warnings.length > 0 ? warnings : undefined, blockers: undefined };
    },
    simulate: async ({ state, request }): Promise<SimulationResult> => {
      const cloned = cloneState(state ?? createDefaultState());
      const warnings: string[] = [];

      if (Array.isArray(request.themeMutations) && request.themeMutations.length > 0) {
        warnings.push(...applyThemeMutations(cloned, request.themeMutations));
      }

      if (Array.isArray(request.layoutMutations) && request.layoutMutations.length > 0) {
        warnings.push(...applyLayoutMutations(cloned, request.layoutMutations));
      }

      cloned.version = Math.max(0, Number.isFinite(cloned.version) ? cloned.version : 0) + 1;
      cloned.updatedAt = new Date(now()).toISOString();
      cloned.metadata = {
        ...(isRecord(cloned.metadata) ? cloned.metadata : {}),
        lastRequestId: request.metadata?.requestId,
        lastActor: request.metadata?.actor,
        lastAppliedAt: cloned.updatedAt,
      };

      return { nextState: cloned, warnings: warnings.length > 0 ? warnings : undefined };
    },
    persist: async ({ state, request }) => {
      const normalized = normalizeState(state ?? createDefaultState());
      await fs.mkdir('public/_fyos', true).catch(() => {});

      const serialized = JSON.stringify(normalized, null, 2);
      await fs.writeFile(DESKTOP_STATE_PATH, serialized);

      await persistAssets(request.assets ?? [], { fs, instanceRef });

      const win = windowProvider();
      if (win) {
        if (normalized.theme) {
          try { win.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalized.theme)); } catch {}
          try { win.postMessage({ type: 'FYOS_SET_THEME', payload: normalized.theme }, '*'); } catch {}
        }
        const tokens = normalized.themeTokens ?? {};
        try { win.localStorage.setItem(THEME_TOKENS_STORAGE_KEY, JSON.stringify(tokens)); } catch {}
        applyThemeTokensToDocument(tokens, win);
        try { win.postMessage({ type: 'FYOS_DESKTOP_THEME_TOKENS', payload: tokens }, '*'); } catch {}
      }
    },
  };
}

async function loadState(fs: FsBridge): Promise<DesktopCustomizeState> {
  try {
    const raw = await fs.readFile(DESKTOP_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return normalizeState(parsed);
  } catch {
    return createDefaultState();
  }
}

function createDefaultState(): DesktopCustomizeState {
  return {
    version: 0,
    updatedAt: new Date().toISOString(),
    theme: { mode: 'image', value: '/2.webp' },
    themeTokens: {},
    iconPositions: {},
    windowGeometries: {},
    windowTabs: {},
    appOrder: [],
    metadata: {},
  };
}

function normalizeState(state: unknown): DesktopCustomizeState {
  const base = createDefaultState();
  if (!isRecord(state)) {
    return base;
  }

  const next: DesktopCustomizeState = {
    version: typeof state.version === 'number' ? state.version : base.version,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : base.updatedAt,
    theme: normalizeTheme(state.theme) ?? base.theme,
    themeTokens: isRecord(state.themeTokens) ? { ...state.themeTokens } as Record<string, string> : {},
    iconPositions: isRecord(state.iconPositions) ? clonePlainObject(state.iconPositions) : {},
    windowGeometries: isRecord(state.windowGeometries) ? clonePlainObject(state.windowGeometries) : {},
    windowTabs: isRecord(state.windowTabs) ? { ...state.windowTabs } : {},
    appOrder: Array.isArray(state.appOrder) ? state.appOrder.filter((item): item is string => typeof item === 'string') : [],
    metadata: isRecord(state.metadata) ? { ...state.metadata } : {},
  };

  return next;
}

function normalizeTheme(theme: unknown): DesktopCustomizeState['theme'] | null {
  if (!isRecord(theme)) return null;
  const mode = theme.mode === 'gradient' || theme.mode === 'image' ? theme.mode : undefined;
  const value = typeof theme.value === 'string' ? theme.value : undefined;
  if (!mode || !value) return null;
  const normalized: DesktopCustomizeState['theme'] = { mode, value };
  if (typeof theme.label === 'string') normalized.label = theme.label;
  return normalized;
}

function clonePlainObject<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneState<T>(state: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(state);
    } catch {
      // fall back to JSON stringify below
    }
  }
  return JSON.parse(JSON.stringify(state)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function computeHash(serialized: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const digest = await crypto.subtle.digest('SHA-256', encoder.encode(serialized));
      return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      // fall through to simple hash
    }
  }
  return simpleHash(serialized);
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function applyThemeMutations(state: DesktopCustomizeState, mutations: DesktopCustomizeThemeMutation[]): string[] {
  const warnings: string[] = [];
  const tokens = { ...(state.themeTokens ?? {}) };

  for (const mutation of mutations) {
    const token = typeof mutation.token === 'string' ? mutation.token.trim() : '';
    const value = typeof mutation.value === 'string' ? mutation.value : '';
    if (!token || !value) {
      warnings.push('Skipped theme mutation with missing token or value.');
      continue;
    }

    const loweredToken = token.toLowerCase();
    if (loweredToken === 'theme.mode') {
      if (value === 'image' || value === 'gradient') {
        state.theme = { ...state.theme, mode: value };
      } else {
        warnings.push(`Unsupported theme.mode value: ${value}`);
      }
      continue;
    }

    if (loweredToken === 'theme.value') {
      state.theme = { ...state.theme, value };
      continue;
    }

    if (loweredToken === 'theme.image' || loweredToken === 'wallpaper.image') {
      state.theme = { ...state.theme, mode: 'image', value };
      continue;
    }

    if (loweredToken === 'theme.gradient' || loweredToken === 'wallpaper.gradient') {
      state.theme = { ...state.theme, mode: 'gradient', value };
      continue;
    }

    if (token.startsWith('--')) {
      tokens[token] = value;
      continue;
    }

    tokens[token] = value;
  }

  state.themeTokens = tokens;
  return warnings;
}

function applyLayoutMutations(state: DesktopCustomizeState, mutations: DesktopCustomizeLayoutMutation[]): string[] {
  const warnings: string[] = [];

  for (const mutation of mutations) {
    const action = typeof mutation.action === 'string' ? mutation.action.toLowerCase() : '';
    const target = typeof mutation.target === 'string' ? mutation.target.toLowerCase() : '';
    const payload = isRecord(mutation.payload) ? mutation.payload : {};

    if (!action) {
      warnings.push('Skipped layout mutation with missing action.');
      continue;
    }

    if (action === 'set_app_order' || target === 'layout:app_order') {
      const order = extractStringArray(payload.order);
      if (order.length === 0) {
        warnings.push('set_app_order mutation provided no order array.');
      } else {
        state.appOrder = order;
      }
      continue;
    }

    if (action === 'reset_icons') {
      state.iconPositions = {};
      continue;
    }

    if (action === 'set_icon_positions') {
      const positions = Array.isArray(payload.positions) ? payload.positions : [];
      if (positions.length === 0) {
        warnings.push('set_icon_positions mutation provided no positions.');
      } else {
        for (const entry of positions) {
          if (!isRecord(entry)) continue;
          const appId = typeof entry.appId === 'string' ? entry.appId : typeof entry.id === 'string' ? entry.id : '';
          const left = Number(entry.left);
          const top = Number(entry.top);
          if (!appId || Number.isNaN(left) || Number.isNaN(top)) {
            warnings.push(`Skipped icon position due to missing data (${JSON.stringify(entry)}).`);
            continue;
          }
          state.iconPositions = { ...state.iconPositions, [appId]: { left, top } };
        }
      }
      continue;
    }

    if (target.startsWith('icon:')) {
      const appId = target.split(':')[1] ?? '';
      if (!appId) {
        warnings.push(`Icon mutation missing app id for target ${mutation.target}`);
        continue;
      }
      if (action === 'remove') {
        const { [appId]: _, ...rest } = state.iconPositions;
        state.iconPositions = rest;
        continue;
      }
      const left = getNumber(payload.left);
      const top = getNumber(payload.top);
      if (left === null || top === null) {
        warnings.push(`Icon mutation for ${appId} missing coordinates.`);
        continue;
      }
      state.iconPositions = { ...state.iconPositions, [appId]: { left, top } };
      continue;
    }

    if (target.startsWith('window:')) {
      const windowId = target.split(':')[1] ?? '';
      if (!windowId) {
        warnings.push(`Window mutation missing window id for target ${mutation.target}`);
        continue;
      }
      if (action === 'remove') {
        const { [windowId]: _, ...rest } = state.windowGeometries;
        state.windowGeometries = rest;
        continue;
      }
      const nextGeom = extractGeometry(payload);
      if (!nextGeom) {
        warnings.push(`Window mutation for ${windowId} missing geometry.`);
        continue;
      }
      state.windowGeometries = { ...state.windowGeometries, [windowId]: nextGeom };
      continue;
    }

    if (action === 'set_window_geometries') {
      const geometries = Array.isArray(payload.geometries) ? payload.geometries : [];
      if (geometries.length === 0) {
        warnings.push('set_window_geometries mutation provided no geometries.');
      } else {
        for (const entry of geometries) {
          if (!isRecord(entry)) continue;
          const windowId = typeof entry.windowId === 'string' ? entry.windowId : typeof entry.appId === 'string' ? entry.appId : '';
          const geom = extractGeometry(entry);
          if (!windowId || !geom) {
            warnings.push(`Skipped window geometry due to missing data (${JSON.stringify(entry)}).`);
            continue;
          }
          state.windowGeometries = { ...state.windowGeometries, [windowId]: geom };
        }
      }
      continue;
    }

    warnings.push(`Unhandled layout mutation: action=${mutation.action ?? 'unknown'} target=${mutation.target ?? 'unknown'}`);
  }

  return warnings;
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function getNumber(value: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? num : null;
}

function extractGeometry(value: unknown): DesktopCustomizeState['windowGeometries'][string] | null {
  if (!isRecord(value)) return null;
  const left = getNumber(value.left);
  const top = getNumber(value.top);
  const width = getNumber(value.width);
  const height = getNumber(value.height);
  if (left === null || top === null || width === null || height === null) return null;
  return { left, top, width, height };
}

async function persistAssets(assets: DesktopCustomizeAsset[], ctx: { fs: FsBridge; instanceRef: MutableRefObject<WebContainerAPI | null> }): Promise<void> {
  if (!Array.isArray(assets) || assets.length === 0) return;

  for (const asset of assets) {
    const path = sanitizeRelativePath(asset.path ?? '');
    if (!path) {
      throw new Error('Asset path is required.');
    }

    const dir = dirname(path);
    if (dir) {
      await ctx.fs.mkdir(dir, true).catch(() => {});
    }

    const encoding = asset.encoding ?? 'utf-8';
    if (encoding === 'base64') {
      const data = decodeBase64(asset.contents ?? '');
      const instance = ctx.instanceRef.current;
      if (!instance) {
        throw new Error('WebContainer instance unavailable for base64 asset write.');
      }
      await instance.fs.writeFile(`/${path}`, data);
    } else {
      await ctx.fs.writeFile(path, asset.contents ?? '');
    }
  }
}

function sanitizeRelativePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized) return '';
  const segments = normalized.split('/');
  const safeSegments: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') throw new Error(`Invalid asset path segment: ${rawPath}`);
    safeSegments.push(segment);
  }
  return safeSegments.join('/');
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx === -1) return '';
  return path.slice(0, idx);
}

function decodeBase64(value: string): Uint8Array {
  const input = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  if (typeof atob !== 'function') {
    throw new Error('Base64 decoding not supported in this environment.');
  }
  const binary = atob(input);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getDefaultWindow(): (Window & typeof globalThis) | null {
  if (typeof window === 'undefined') return null;
  return window;
}

function applyThemeTokensToDocument(tokens: Record<string, string>, win: Window): void {
  if (!tokens || typeof tokens !== 'object') return;
  const root = win.document?.documentElement;
  if (!root) return;
  for (const [token, value] of Object.entries(tokens)) {
    if (!token || typeof value !== 'string') continue;
    if (token.startsWith('--')) {
      root.style.setProperty(token, value);
      continue;
    }
    if (token.startsWith('css.')) {
      const cssVar = `--${token.slice(4)}`;
      root.style.setProperty(cssVar, value);
    }
  }
}
