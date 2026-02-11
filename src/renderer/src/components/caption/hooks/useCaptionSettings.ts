import { useState } from 'react';
import { useProjectFeatureState } from '../../../hooks/useProjectFeatureState';
import {
  DEFAULT_INPUT_TYPE,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_VOICE,
  DEFAULT_RATE,
  DEFAULT_VOLUME,
  DEFAULT_SRT_SPEED,
  DEFAULT_SPLIT_BY_LINES,
  DEFAULT_LINES_PER_FILE,
  DEFAULT_NUMBER_OF_PARTS,
} from '../../../config/captionConfig';
import { Step } from '../CaptionTypes';


export function useCaptionSettings() {
   // State - Config
  const [inputType, setInputType] = useState<'srt' | 'draft'>(DEFAULT_INPUT_TYPE);
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [srtSpeed, setSrtSpeed] = useState(DEFAULT_SRT_SPEED);
  
  // State - Split Config
  const [splitByLines, setSplitByLines] = useState(DEFAULT_SPLIT_BY_LINES);
  const [linesPerFile, setLinesPerFile] = useState(DEFAULT_LINES_PER_FILE);
  const [numberOfParts, setNumberOfParts] = useState(DEFAULT_NUMBER_OF_PARTS);
  
  // State - Audio Dir (persist this too)
  const [audioDir, setAudioDir] = useState('');

  // We need to persist enabledSteps as well, although it's part of processing logic, 
  // it's a user preference setting.
  const [enabledSteps, setEnabledSteps] = useState<Set<Step>>(new Set([1, 2, 3, 4, 5, 6]));

  // ========== AUTO SAVE/LOAD VÀO PROJECT ==========
  useProjectFeatureState<{
    inputType?: 'srt' | 'draft';
    geminiModel?: string;
    voice?: string;
    rate?: string;
    volume?: string;
    srtSpeed?: number;
    splitByLines?: boolean;
    linesPerFile?: number;
    numberOfParts?: number;
    enabledSteps?: Step[];
    audioDir?: string;
  }>({
    feature: 'caption',
    fileName: 'caption-settings.json', // Changed filename slightly to avoid conflict if any
    serialize: () => ({
      inputType,
      geminiModel,
      voice,
      rate,
      volume,
      srtSpeed,
      splitByLines,
      linesPerFile,
      numberOfParts,
      enabledSteps: Array.from(enabledSteps.values()),
      audioDir
    }),
    deserialize: (saved) => {
      if (saved.inputType) setInputType(saved.inputType);
      if (saved.geminiModel) setGeminiModel(saved.geminiModel);
      if (saved.voice) setVoice(saved.voice);
      if (saved.rate) setRate(String(saved.rate));
      if (saved.volume) setVolume(String(saved.volume));
      if (typeof saved.srtSpeed === 'number') setSrtSpeed(saved.srtSpeed);
      if (typeof saved.splitByLines === 'boolean') setSplitByLines(saved.splitByLines);
      if (typeof saved.linesPerFile === 'number') setLinesPerFile(saved.linesPerFile);
      if (typeof saved.numberOfParts === 'number') setNumberOfParts(saved.numberOfParts);
      if (saved.enabledSteps) setEnabledSteps(new Set(saved.enabledSteps));
      if (saved.audioDir) setAudioDir(saved.audioDir);
    },
    deps: [
      inputType, geminiModel, voice, rate, volume,
      srtSpeed, splitByLines, linesPerFile, numberOfParts, enabledSteps, audioDir
    ],
  });

  return {
    inputType, setInputType,
    geminiModel, setGeminiModel,
    voice, setVoice,
    rate, setRate,
    volume, setVolume,
    srtSpeed, setSrtSpeed,
    splitByLines, setSplitByLines,
    linesPerFile, setLinesPerFile,
    numberOfParts, setNumberOfParts,
    audioDir, setAudioDir,
    enabledSteps, setEnabledSteps
  };
}
