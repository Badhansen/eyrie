import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'eyrie-theme';

type Listener = () => void;

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function savedPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

/** Apply the resolved theme to the document so CSS and Three.js pick it up. */
function applyTheme(pref: ThemePreference): void {
  const resolved = pref === 'system' ? getSystemTheme() : pref;
  document.documentElement.setAttribute('data-theme', resolved);
}

class ThemeStore {
  private preference: ThemePreference = savedPreference();
  private listeners = new Set<Listener>();

  constructor() {
    // Apply on load.
    applyTheme(this.preference);

    // When the OS theme changes, re-apply if we are in system mode.
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (this.preference === 'system') {
        applyTheme('system');
        this.emit();
      }
    });
  }

  get = (): ThemePreference => this.preference;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set = (pref: ThemePreference): void => {
    this.preference = pref;
    try {
      if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* storage unavailable */
    }
    applyTheme(pref);
    this.emit();
  };

  /** Cycle: system → light → dark → system. */
  cycle = (): void => {
    const next: ThemePreference = this.preference === 'system' ? 'light' : this.preference === 'light' ? 'dark' : 'system';
    this.set(next);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const themeStore = new ThemeStore();

export function useTheme(): ThemePreference {
  return useSyncExternalStore(themeStore.subscribe, themeStore.get);
}
