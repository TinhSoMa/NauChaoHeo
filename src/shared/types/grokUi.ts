export const GROK_UI_IPC_CHANNELS = {
  GET_HEALTH: 'grokUi:getHealth',
  TEST_ASK: 'grokUi:testAsk',
  SHUTDOWN: 'grokUi:shutdown',
  CREATE_PROFILE: 'grokUi:createProfile',
  GET_PROFILE_STATUSES: 'grokUi:getProfileStatuses',
  RESET_PROFILE_STATUSES: 'grokUi:resetProfileStatuses',
  GET_PROFILES: 'grokUi:getProfiles',
  SAVE_PROFILES: 'grokUi:saveProfiles',
  SET_PROFILE_ENABLED: 'grokUi:setProfileEnabled',
  DELETE_PROFILE: 'grokUi:deleteProfile',
} as const;

export interface GrokUiProfileConfig {
  id: string;
  profileDir: string | null;
  profileName: string | null;
  anonymous: boolean;
  enabled: boolean;
}

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
  id: string;
  profileDir: string;
  profileName: string;
  profilePath: string;
}

export interface GrokUiProfileStatus {
  state: 'ok' | 'rate_limited' | 'error';
  lastErrorCode?: string;
  lastError?: string;
  updatedAt: number;
}

export interface GrokUiProfileStatusEntry {
  profile: GrokUiProfileConfig;
  status: GrokUiProfileStatus;
}
