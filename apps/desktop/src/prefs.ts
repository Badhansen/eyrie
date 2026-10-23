/**
 * The UI's few saved choices (theme, 2D or 3D, lens), kept as JSON in the app's
 * user-data folder. In a browser the UI keeps them in localStorage, but the
 * desktop app serves each project's map on a new port, and localStorage belongs
 * to one origin, so a map page would forget them every time a project opens.
 * Needs nothing from Electron, so it is tested in Node.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The keys the UI saves (apps/web/src/state). Anything else a page sends is ignored. */
export const PREF_KEYS: readonly string[] = ['eyrie-theme', 'eyrie-view', 'eyrie-lens'];

const MAX_LENGTH = 64;

interface StoredPrefs {
  version: 1;
  values: Record<string, string>;
}

export class PrefStore {
  private values: Record<string, string> = {};

  constructor(private readonly file: string) {
    if (!existsSync(file)) return;
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredPrefs>;
      for (const [key, value] of Object.entries(stored.values ?? {})) if (valid(key, value)) this.values[key] = value;
    } catch {
      /* unreadable: start empty, and the next save replaces it */
    }
  }

  all(): Record<string, string> {
    return { ...this.values };
  }

  /** Saves a choice, or forgets it when `value` is null. False when the key or value is not one the UI uses. */
  set(key: unknown, value: unknown): boolean {
    if (value === null ? !PREF_KEYS.includes(key as string) : !valid(key, value)) return false;
    if (value === null) delete this.values[key as string];
    else this.values[key as string] = value as string;
    this.save();
    return true;
  }

  /** Writes a temporary file and renames it over the old one, so a crash never leaves half a file. */
  private save(): void {
    const body: StoredPrefs = { version: 1, values: this.values };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}

function valid(key: unknown, value: unknown): value is string {
  return typeof key === 'string' && PREF_KEYS.includes(key) && typeof value === 'string' && value.length <= MAX_LENGTH;
}
