/**
 * The UI's saved choices: theme, 2D or 3D, lens. In a browser they live in
 * localStorage. In the desktop app they live with the app, through its bridge:
 * it serves each project's map on a new port, and localStorage belongs to one
 * origin, so the map would forget them every time a project opens.
 */
import { desktop } from '../lib/desktop';

export function readPref(key: string): string | null {
  if (desktop?.prefs) return desktop.prefs.get(key);
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saves a choice, or forgets it when `value` is null. */
export function writePref(key: string, value: string | null): void {
  if (desktop?.prefs) return desktop.prefs.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* the choice just won't be remembered */
  }
}
