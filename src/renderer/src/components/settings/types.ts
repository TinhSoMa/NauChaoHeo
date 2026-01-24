/**
 * Settings Types - Cac kieu du lieu dung chung cho Settings components
 */

import { LucideIcon } from 'lucide-react';

// Tab types
export type SettingsTab = 'overview' | 'output' | 'translation' | 'tts' | 'app' | 'apikeys' | 'geminichat';

// Theme & Language types
export type ThemeMode = 'light' | 'dark';
export type AppLanguage = 'vi' | 'en';

// Menu item interface
export interface SettingsMenuItem {
  id: SettingsTab;
  label: string;
  desc: string;
  icon: LucideIcon;
}

// Constants
export const THEME_OPTIONS = [
  { value: 'light' as ThemeMode, label: 'Sáng' },
  { value: 'dark' as ThemeMode, label: 'Tối' },
];

export const LANGUAGE_OPTIONS = [
  { value: 'vi' as AppLanguage, label: 'Tiếng Việt' },
  { value: 'en' as AppLanguage, label: 'English' },
];

export const DEFAULT_APP_LANGUAGE: AppLanguage = 'vi';

// Gemini Chat Config interface
export interface GeminiChatConfig {
  id?: string;
  cookie: string;
  blLabel: string;
  fSid: string;
  atToken: string;
  convId: string;
  respId: string;
  candId: string;
  createdAt?: number;
  updatedAt?: number;
}

// Common props for settings sub-components
export interface SettingsDetailProps {
  onBack: () => void;
}
