import { useRef } from 'react';
import { Monitor } from 'lucide-react';
import { AnimatedThemeToggler, runThemeTransition } from './ui/animated-theme-toggler';
import { themeStore, useTheme } from '../state/theme';

export function ThemeToggle() {
  const preference = useTheme();
  const systemButtonRef = useRef<HTMLButtonElement>(null);

  const systemIsDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
  const currentIsDark = preference === 'system' ? systemIsDark : preference === 'dark';

  return (
    <div className="theme-toggle" role="group" aria-label="Theme settings">
      <button
        ref={systemButtonRef}
        type="button"
        className="theme-option"
        aria-checked={preference === 'system'}
        title="System theme"
        onClick={() => {
          if (preference === 'system') return;
          if (currentIsDark !== systemIsDark) {
            runThemeTransition({
              element: systemButtonRef.current,
              applyChange: () => themeStore.set('system'),
              variant: 'square',
            });
          } else {
            themeStore.set('system');
          }
        }}
      >
        <Monitor size={14} />
      </button>

      <AnimatedThemeToggler
        variant="square"
        className="theme-option"
        title={currentIsDark ? 'Switch to light theme' : 'Switch to dark theme'}
        theme={currentIsDark ? 'dark' : 'light'}
        onThemeChange={(newTheme) => themeStore.set(newTheme)}
      />
    </div>
  );
}
