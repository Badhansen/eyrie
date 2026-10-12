import { Monitor, Moon, Sun } from 'lucide-react';
import { themeStore, useTheme, type ThemePreference } from '../state/theme';

const OPTIONS: { value: ThemePreference; icon: React.ReactNode; tip: string }[] = [
  { value: 'system', icon: <Monitor size={14} />, tip: 'System theme' },
  { value: 'light', icon: <Sun size={14} />, tip: 'Light theme' },
  { value: 'dark', icon: <Moon size={14} />, tip: 'Dark theme' },
];

export function ThemeToggle() {
  const current = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="theme-toggle">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={current === o.value}
          aria-label={o.tip}
          title={o.tip}
          tabIndex={current === o.value ? 0 : -1}
          onClick={() => themeStore.set(o.value)}
          className="theme-option"
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
