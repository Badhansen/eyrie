import { formatPrice, truncate } from '@/utils/format';

/** Builds the human-readable summary line stored on an order. */
export function buildOrderSummary(titles: string[], totalCents: number): string {
  return `${truncate(titles.join(', '), 120)} — ${formatPrice(totalCents)}`;
}
