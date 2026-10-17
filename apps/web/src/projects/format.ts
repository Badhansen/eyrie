/** Wording for times and sizes on the Projects page. Pure, so it is tested in Node. */

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

/** "just now", "5 min. ago", "3 hr. ago", "yesterday", then a date. */
export function timeAgo(at: number, now: number): string {
  const seconds = (now - at) / 1000;
  if (seconds < 45) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return relative.format(-Math.round(minutes), 'minute');
  const hours = minutes / 60;
  if (hours < 24) return relative.format(-Math.round(hours), 'hour');
  const days = hours / 24;
  if (days < 30) return relative.format(-Math.round(days), 'day');
  return new Date(at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** How long an index took: "640 ms", "4.2 s", "38 s", "2 min 5 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Time since a scan or open started, for a running status: "0:07", "1:32". */
export function formatElapsed(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "1 project", "3 projects". */
export function plural(count: number, word: string): string {
  return `${count.toLocaleString('en')} ${word}${count === 1 ? '' : 's'}`;
}
