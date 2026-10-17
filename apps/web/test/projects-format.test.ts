import { describe, expect, it } from 'vitest';
import { formatDuration, formatElapsed, plural, timeAgo } from '../src/projects/format';

describe('Projects page wording', () => {
  const now = Date.UTC(2026, 9, 17, 12, 0, 0);
  const ago = (ms: number) => timeAgo(now - ms, now);

  it('says how long ago an index finished', () => {
    expect(ago(10_000)).toBe('just now');
    expect(ago(5 * 60_000)).toBe('5 min. ago');
    expect(ago(3 * 3_600_000)).toBe('3 hr. ago');
    expect(ago(26 * 3_600_000)).toBe('yesterday');
    expect(ago(4 * 86_400_000)).toBe('4 days ago');
    expect(ago(90 * 86_400_000)).toMatch(/2026$/);
  });

  it('says how long an index took', () => {
    expect(formatDuration(640)).toBe('640 ms');
    expect(formatDuration(4210)).toBe('4.2 s');
    expect(formatDuration(38_400)).toBe('38 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
  });

  it('counts a running scan up in minutes and seconds', () => {
    expect(formatElapsed(now - 7_400, now)).toBe('0:07');
    expect(formatElapsed(now - 92_000, now)).toBe('1:32');
    expect(formatElapsed(now + 500, now)).toBe('0:00');
  });

  it('pluralises counts', () => {
    expect(plural(1, 'project')).toBe('1 project');
    expect(plural(1200, 'project')).toBe('1,200 projects');
  });
});
