import { openai } from '@/lib/openai';
import { prisma } from '@/lib/prisma';
import { buildRecommendationPrompt } from '@/lib/prompt';

/**
 * Suggests books a customer might like, based on what they have already ordered.
 */
export class RecommenderService {
  async suggest(customerId: string): Promise<string[]> {
    const orders = await prisma.order.findMany({ where: { customerId } });
    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: buildRecommendationPrompt(orders.map((o) => o.summary)) }],
    });
    return parseSuggestions(response.choices[0]?.message.content ?? '');
  }
}

function parseSuggestions(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

export const recommenderService = new RecommenderService();
