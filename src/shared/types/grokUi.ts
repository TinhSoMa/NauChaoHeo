export const GROK_UI_IPC_CHANNELS = {
  GET_HEALTH: 'grokUi:getHealth',
  TEST_ASK: 'grokUi:testAsk',
  SHUTDOWN: 'grokUi:shutdown',
  CREATE_PROFILE: 'grokUi:createProfile',
} as const;

export interface GrokUiHealthSnapshot {
  checkedAt: number;
  pythonOk: boolean;
  modulesOk: boolean;
  runtimeMode?: 'embedded' | 'system';
  pythonPath?: string;
  pythonVersion?: string;
  modules?: Record<string, boolean>;
  error?: string;
}

export interface GrokUiProfileCreateResult {
  profileDir: string;
  profileName: string;
  profilePath: string;
}
