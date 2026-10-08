import { truncate } from '@/utils/format';

/** Builds the LLM prompt that turns past orders into new book recommendations. */
export function buildRecommendationPrompt(pastOrders: string[]): string {
  return `Recommend five books for a customer who previously bought:\n${truncate(pastOrders.join('\n'), 4000)}`;
}
