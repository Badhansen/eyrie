import { openai } from '@/lib/openai';

/**
 * Wraps the LLM provider so the rest of the app never talks to OpenAI directly.
 */
export class AIService {
  async complete(prompt: string): Promise<string> {
    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
    });
    return parseCompletion(response.choices[0]?.message.content ?? '');
  }
}

function parseCompletion(text: string): string {
  return text.trim();
}
