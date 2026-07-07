import * as fs from 'fs';

interface GenerateResult {
  buffers: Buffer[]
}

export class ImageGenerator {
  private model = 'gemini-2.5-flash-image-preview';

  async generateImages(prompt: string, count = 4, apiKey?: string): Promise<GenerateResult> {
    if (!apiKey) throw new Error('No Gemini API key configured');
    const { GoogleGenAI } = await import('@google/genai');

    const ai = new GoogleGenAI({ apiKey });
    const config: { responseModalities: string[] } = { responseModalities: ['IMAGE', 'TEXT'] };
    const imageBuffers: Buffer[] = [];
    const promises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      promises.push(
        (async () => {
          try {
            const response = await ai.models.generateContentStream({
              model: this.model,
              config,
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            for await (const chunk of response) {
              if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
                const data = chunk.candidates[0].content.parts[0].inlineData.data;
                if (data) imageBuffers.push(Buffer.from(data, 'base64'));
              }
            }
          } catch (err) {
            console.error(`[ImageGenerator] Error generating image ${i + 1}:`, (err as Error).message);
          }
        })()
      );
    }

    await Promise.all(promises);
    return { buffers: imageBuffers };
  }

  async generateImagesFromImage(
    imagePath: string,
    prompt: string,
    count = 4,
    apiKey?: string,
    onImageComplete?: (buffer: Buffer, index: number) => Promise<void>
  ): Promise<GenerateResult> {
    if (!apiKey) throw new Error('No Gemini API key configured');
    const { GoogleGenAI } = await import('@google/genai');

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = this.detectMimeType(imageBuffer);
    const ai = new GoogleGenAI({ apiKey });
    const config: { responseModalities: string[] } = { responseModalities: ['IMAGE', 'TEXT'] };

    const systemPrompt = `You are a thumbnail creator that modifies existing images. CRITICAL INSTRUCTIONS:
1. Use the provided reference image as the primary foundation - preserve ALL key visual elements
2. Keep the same characters, objects, faces, and overall composition from the original
3. Only apply the requested style modifications as overlays or enhancements
4. The original subject matter and recognizable elements must remain clearly visible
5. Think of this as "restyling" the existing image, not creating something new
6. Generate the image in 16:9 widescreen aspect ratio format suitable for thumbnails`;

    const enhancedPrompt = `${systemPrompt}\n\nModification request: ${prompt}\n\nIMPORTANT: Start with the provided reference image and apply only the requested modifications while keeping all original elements intact and recognizable. Create the final image in 16:9 widescreen thumbnail format.`;

    const imageBuffers: Buffer[] = [];
    const maxConcurrency = Math.min(count, 3);

    for (let batch = 0; batch < count; batch += maxConcurrency) {
      const batchSize = Math.min(maxConcurrency, count - batch);
      const batchPromises: Promise<void>[] = [];

      for (let j = 0; j < batchSize; j++) {
        const index = batch + j + 1;
        batchPromises.push(
          (async () => {
            try {
              const generationPromise = ai.models.generateContentStream({
                model: this.model,
                config,
                contents: [{
                  role: 'user',
                  parts: [
                    { text: enhancedPrompt },
                    { inlineData: { mimeType, data: base64Image } },
                  ],
                }],
              });

              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Image ${index} generation timeout after 60 seconds`)), 60000);
              });

              const response = await Promise.race([generationPromise, timeoutPromise]);
              for await (const chunk of response) {
                if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
                  const data = chunk.candidates[0].content.parts[0].inlineData.data;
                  if (data) {
                    const buf = Buffer.from(data, 'base64');
                    imageBuffers.push(buf);
                    if (onImageComplete) await onImageComplete(buf, index);
                  }
                }
              }
            } catch (err) {
              console.error(`[ImageGenerator] Error generating image ${index} from image:`, (err as Error).message);
            }
          })()
        );
      }
      await Promise.all(batchPromises);
    }

    return { buffers: imageBuffers };
  }

  private detectMimeType(buffer: Buffer): string {
    const signatures: [string, number[]][] = [
      ['image/jpeg', [0xFF, 0xD8, 0xFF]],
      ['image/png', [0x89, 0x50, 0x4E, 0x47]],
      ['image/gif', [0x47, 0x49, 0x46]],
      ['image/webp', [0x52, 0x49, 0x46, 0x46]],
    ];
    for (const [mimeType, signature] of signatures) {
      if (signature.every((byte, i) => buffer[i] === byte)) return mimeType;
    }
    return 'image/jpeg';
  }

}
