export type MutableWindow = Window & {
  __FYOS_FIRST_TOOL_CALLED_REF?: { current: boolean };
  __FYOS_SUPPRESS_PREVIEW_ERRORS_UNTIL?: number;
};

export const getMutableWindow = (): MutableWindow | null => {
  if (typeof window === 'undefined') return null;
  return window as MutableWindow;
};

