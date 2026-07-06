import OpenAI from 'openai';
import { PromptCache } from './promptCache';

const cache = new PromptCache(100, 60);

export class PromptEnhancer {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
  }

  async enhance(userPrompt: string): Promise<string> {
    if (!process.env.OPENAI_API_KEY) return userPrompt;

    const cached = cache.get(userPrompt);
    if (cached) return cached;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an expert prompt engineer for AI image generation. Your task is to enhance user prompts to create more detailed, visually appealing, and technically optimized prompts for image generation models.

Guidelines for enhancement:
- Add specific visual details (lighting, composition, style, colors)
- Include technical photography terms when appropriate
- Specify art styles or techniques if relevant
- Add atmosphere and mood descriptors
- Keep the core concept intact while making it more vivid
- Aim for 1-2 sentences maximum
- Focus on visual elements that will produce better images`,
          },
          {
            role: 'user',
            content: `Please enhance this prompt for AI image generation: "${userPrompt}"`,
          },
        ],
        max_tokens: 150,
        temperature: 0.7,
      });

      const enhanced = response.choices[0]?.message?.content?.trim() || userPrompt;
      cache.set(userPrompt, enhanced);
      return enhanced;
    } catch (error) {
      console.error('[PromptEnhancer] Error:', (error as Error).message);
      return userPrompt;
    }
  }

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  getCacheStats() {
    return cache.getStats();
  }

  clearCache(): void {
    cache.clear();
  }
}
