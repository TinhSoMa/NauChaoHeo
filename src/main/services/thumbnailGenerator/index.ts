const { v4: uuidv4 } = require('uuid') as { v4: () => string };
import { ImageGenerator } from './imageGenerator';
import { PromptEnhancer } from './promptEnhancer';
import { ImageStorage } from './imageStorage';
import { ThumbnailGeneratorDatabase } from '../../database/thumbnailGeneratorDatabase';
import type { ThumbnailGenerationOptions, ThumbnailHistoryEntry, ThumbnailHistoryResult } from '../../../shared/types/thumbnailGenerator';

function generateEnhancedPrompt(fields: {
  originalPrompt: string
  category?: string
  mood?: string
  theme?: string
  primaryColor?: string
  includeText?: boolean
  textStyle?: string
  thumbnailStyle?: string
  customPrompt?: string
}, isImageToImage = false): string {
  const { originalPrompt, category, mood, theme, primaryColor, includeText, textStyle, thumbnailStyle, customPrompt } = fields;

  if (isImageToImage) {
    let prompt = originalPrompt
      ? `Primary objective: ${originalPrompt}. Use the reference image provided as the foundation and modify it to fulfill this main requirement. `
      : 'Create a thumbnail based on the reference image provided, maintaining the core visual elements, characters, objects, and composition from the original image. ';

    const tweaks: string[] = [];
    if (category) tweaks.push(`adapt it for ${category} content style`);
    if (mood) tweaks.push(`adjust the mood to be ${mood.toLowerCase()}`);
    if (theme) tweaks.push(`apply ${theme.toLowerCase()} visual theme`);
    if (primaryColor) tweaks.push(`emphasize ${primaryColor.toLowerCase()} color tones`);
    if (thumbnailStyle) tweaks.push(`render in ${thumbnailStyle.toLowerCase()} style`);
    if (includeText && textStyle) tweaks.push(`add ${textStyle.toLowerCase()} text overlay`);
    else if (includeText) tweaks.push('add text overlay');

    if (tweaks.length > 0) prompt += 'Secondary style adjustments: ' + tweaks.join(', ') + '. ';
    if (customPrompt) prompt += `Additional requirements: ${customPrompt}. `;
    prompt += 'IMPORTANT: Focus primarily on fulfilling the main objective while preserving recognizable elements from the reference image. Ensure the result is suitable as a thumbnail - eye-catching, clear, and professional.';
    return prompt;
  }

  let prompt = 'Create a YouTube thumbnail in STRICT 16:9 aspect ratio (1920x1080 dimensions). ';
  if (originalPrompt) prompt += `Main subject: ${originalPrompt}. `;
  if (customPrompt) prompt += `Additional requirements: ${customPrompt}. `;

  const parts: string[] = [];
  if (category) parts.push(`${category} style`);
  if (thumbnailStyle) parts.push(`${thumbnailStyle} thumbnail`);
  if (theme) parts.push(`with ${theme} theme`);
  if (mood) parts.push(`${mood} mood`);
  if (primaryColor) parts.push(`dominant ${primaryColor} color palette`);
  if (includeText && textStyle) parts.push(`featuring ${textStyle} text overlay`);
  else if (includeText) parts.push('with text overlay');

  if (parts.length > 0) prompt += 'Style requirements: ' + parts.join(', ') + '. ';
  prompt += 'CRITICAL: Must be exactly 16:9 aspect ratio, widescreen format, horizontal layout, YouTube thumbnail proportions (1920x1080). High quality, professional, eye-catching, clean composition optimized for YouTube thumbnail viewing.';
  return prompt;
}

export class ThumbnailGeneratorService {
  private imageGenerator = new ImageGenerator();
  private promptEnhancer = new PromptEnhancer();
  private imageStorage: ImageStorage;

  constructor(outputDir: string) {
    this.imageStorage = new ImageStorage(outputDir);
  }

  setOutputDir(dir: string): void {
    this.imageStorage.setOutputDir(dir);
  }

  async generate(options: ThumbnailGenerationOptions & { imagePath?: string }): Promise<{
    success: boolean
    imagePaths: string[]
    finalPrompt: string
    enhanced: boolean
    error?: string
    entry?: ThumbnailHistoryEntry
  }> {
    try {
      const isImageToImage = !!options.imagePath;
      const imageCount = Math.max(1, Math.min(4, options.imageCount || 4));

      let structuredPrompt = generateEnhancedPrompt({
        originalPrompt: options.prompt,
        category: options.category,
        mood: options.mood,
        theme: options.theme,
        primaryColor: options.primaryColor,
        includeText: options.includeText,
        textStyle: options.textStyle,
        thumbnailStyle: options.thumbnailStyle,
        customPrompt: options.customPrompt,
      }, isImageToImage);

      let enhanced = false;
      if (options.enhancePrompt && structuredPrompt) {
        const enhancedPrompt = await this.promptEnhancer.enhance(structuredPrompt);
        if (enhancedPrompt !== structuredPrompt) {
          structuredPrompt = enhancedPrompt;
          enhanced = true;
        }
      }

      let result: { buffers: Buffer[] };
      if (isImageToImage && options.imagePath) {
        result = await this.imageGenerator.generateImagesFromImage(
          options.imagePath, structuredPrompt, imageCount,
          async (buffer) => { await this.imageStorage.saveImage(buffer); }
        );
      } else {
        result = await this.imageGenerator.generateImages(structuredPrompt, imageCount);
      }

      const imagePaths = await Promise.all(
        result.buffers.map((buf) => this.imageStorage.saveImage(buf))
      );

      const entry: ThumbnailHistoryEntry = {
        id: uuidv4(),
        type: isImageToImage ? 'image-to-image' : 'text-to-image',
        originalPrompt: options.prompt,
        finalPrompt: structuredPrompt,
        enhancedPrompt: enhanced,
        category: options.category,
        mood: options.mood,
        theme: options.theme,
        primaryColor: options.primaryColor,
        includeText: options.includeText,
        textStyle: options.textStyle,
        thumbnailStyle: options.thumbnailStyle,
        customPrompt: options.customPrompt,
        inputImagePath: options.imagePath,
        inputImageInfo: options.inputImageInfo,
        imagesGenerated: imagePaths.length,
        imagePaths,
        createdAt: Date.now(),
      };

      ThumbnailGeneratorDatabase.insert(entry);

      return { success: true, imagePaths, finalPrompt: structuredPrompt, enhanced, entry };
    } catch (error) {
      return { success: false, imagePaths: [], finalPrompt: '', enhanced: false, error: (error as Error).message };
    }
  }

  getHistory(limit = 20, offset = 0): ThumbnailHistoryResult {
    return ThumbnailGeneratorDatabase.getAll(limit, offset);
  }

  deleteEntry(id: string): { success: boolean; error?: string } {
    try {
      const entry = ThumbnailGeneratorDatabase.getById(id);
      if (!entry) return { success: false, error: 'Entry not found' };
      this.imageStorage.deleteImages(entry.imagePaths);
      ThumbnailGeneratorDatabase.deleteById(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  clearHistory(): { success: boolean; error?: string } {
    try {
      ThumbnailGeneratorDatabase.deleteAll();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}
