import type { StoryReadingTheme, StoryReadingThemePalette } from '../types';

export const STORY_READING_THEME_OPTIONS: Array<{ value: StoryReadingTheme; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' },
  { value: 'warm', label: 'Warm' }
];

export const STORY_READING_THEME_PALETTES: Record<StoryReadingTheme, StoryReadingThemePalette> = {
  light: {
    panelBackground: '#ffffff',
    contentBackground: '#fafafa',
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    borderColor: '#e2e8f0',
    controlBackground: '#f1f5f9',
    controlText: '#0f172a',
    controlBorder: '#cbd5e1'
  },
  sepia: {
    panelBackground: '#f6efdf',
    contentBackground: '#f4ecd8',
    textPrimary: '#3e3a31',
    textSecondary: '#6e6758',
    borderColor: '#d8ccb2',
    controlBackground: '#ece2cb',
    controlText: '#3e3a31',
    controlBorder: '#c9b99c'
  },
  dark: {
    panelBackground: '#1b1c1f',
    contentBackground: '#131417',
    textPrimary: '#e5e7eb',
    textSecondary: '#9ca3af',
    borderColor: '#2f3138',
    controlBackground: '#24262d',
    controlText: '#e5e7eb',
    controlBorder: '#3b3f4a'
  },
  warm: {
    panelBackground: '#fff4e8',
    contentBackground: '#fef3e6',
    textPrimary: '#2f2516',
    textSecondary: '#776854',
    borderColor: '#e4cdb3',
    controlBackground: '#f4e5d2',
    controlText: '#2f2516',
    controlBorder: '#d3b796'
  }
};

export function resolveStoryReadingThemePalette(theme: StoryReadingTheme): StoryReadingThemePalette {
  return STORY_READING_THEME_PALETTES[theme] || STORY_READING_THEME_PALETTES.light;
}
