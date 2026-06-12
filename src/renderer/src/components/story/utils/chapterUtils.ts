/**
 * Extract title from translated chapter content
 * Returns the first non-empty line or fallback
 */
export const extractTranslatedTitle = (text: string, fallbackId: string): string => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || `Chương ${fallbackId}`;
};
