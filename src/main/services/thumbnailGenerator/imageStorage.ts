import * as fs from 'fs';
import * as path from 'path';
const { v4: uuidv4 } = require('uuid') as { v4: () => string };

const THUMBNAIL_SUBDIR = 'thumbnails';

export class ImageStorage {
  private baseDir: string;

  constructor(outputDir: string) {
    this.baseDir = outputDir;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  setOutputDir(dir: string): void {
    this.baseDir = dir;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getOutputDir(): string {
    return this.baseDir;
  }

  async saveImage(buffer: Buffer): Promise<string> {
    const dateStr = new Date().toISOString().slice(0, 10);
    const dayDir = path.join(this.baseDir, THUMBNAIL_SUBDIR, dateStr);
    if (!fs.existsSync(dayDir)) {
      fs.mkdirSync(dayDir, { recursive: true });
    }

    const fileName = `${uuidv4()}.png`;
    const filePath = path.join(dayDir, fileName);
    await fs.promises.writeFile(filePath, buffer);
    return filePath;
  }

  async deleteImage(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error('[ImageStorage] Failed to delete:', filePath, (error as Error).message);
    }
  }

  async deleteImages(filePaths: string[]): Promise<void> {
    await Promise.all(filePaths.map((fp) => this.deleteImage(fp)));
  }

  getImageDir(): string {
    return path.join(this.baseDir, THUMBNAIL_SUBDIR);
  }
}
