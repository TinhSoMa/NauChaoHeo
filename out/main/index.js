"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const fs = require("fs");
const crypto = require("crypto");
const fs$1 = require("fs/promises");
const child_process = require("child_process");
const uuid = require("uuid");
const Database = require("better-sqlite3");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const crypto__namespace = /* @__PURE__ */ _interopNamespaceDefault(crypto);
const fs__namespace$1 = /* @__PURE__ */ _interopNamespaceDefault(fs$1);
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS = {
  FLASH_3_0: "gemini-3-flash-preview",
  FLASH_2_5: "gemini-2.5-flash",
  FLASH_2_0: "gemini-2.0-flash",
  FLASH_2_5_LITE: "gemini-2.5-flash-lite"
};
const GEMINI_IPC_CHANNELS = {
  // API Key Management
  GET_NEXT_API_KEY: "gemini:getNextApiKey",
  GET_ALL_AVAILABLE_KEYS: "gemini:getAllAvailableKeys",
  GET_STATS: "gemini:getStats",
  RECORD_SUCCESS: "gemini:recordSuccess",
  RECORD_RATE_LIMIT: "gemini:recordRateLimit",
  RECORD_EXHAUSTED: "gemini:recordExhausted",
  RECORD_ERROR: "gemini:recordError",
  RESET_ALL_STATUS: "gemini:resetAllStatus",
  RELOAD_CONFIG: "gemini:reloadConfig",
  // Gemini API calls
  CALL_GEMINI: "gemini:callApi",
  TRANSLATE_TEXT: "gemini:translateText",
  // Key Storage Management
  KEYS_IMPORT: "gemini:keys:import",
  KEYS_EXPORT: "gemini:keys:export",
  KEYS_ADD_ACCOUNT: "gemini:keys:addAccount",
  KEYS_REMOVE_ACCOUNT: "gemini:keys:removeAccount",
  KEYS_REMOVE_PROJECT: "gemini:keys:removeProject",
  KEYS_HAS_KEYS: "gemini:keys:hasKeys",
  KEYS_GET_LOCATION: "gemini:keys:getLocation",
  KEYS_GET_ALL: "gemini:keys:getAll",
  KEYS_GET_ALL_WITH_STATUS: "gemini:keys:getAllWithStatus"
};
const KEYS_FILE_NAME = "api-keys.encrypted";
const ENCRYPTION_SECRET = "NauChaoHeo-Gemini-Keys-v1";
function getKeysFilePath() {
  const userDataPath = electron.app.getPath("userData");
  return path__namespace.join(userDataPath, KEYS_FILE_NAME);
}
function getEncryptionKey() {
  const machineSpecific = electron.app.getPath("userData");
  const combined = ENCRYPTION_SECRET + machineSpecific;
  return crypto__namespace.createHash("sha256").update(combined).digest();
}
function encrypt(data) {
  try {
    const key = getEncryptionKey();
    const iv = crypto__namespace.randomBytes(16);
    const cipher = crypto__namespace.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(data, "utf8", "base64");
    encrypted += cipher.final("base64");
    return iv.toString("base64") + ":" + encrypted;
  } catch (error) {
    console.error("[KeyStorage] Lỗi mã hóa:", error);
    throw new Error("Không thể mã hóa dữ liệu");
  }
}
function decrypt(encryptedData) {
  try {
    const key = getEncryptionKey();
    const parts = encryptedData.split(":");
    if (parts.length !== 2) {
      throw new Error("Định dạng dữ liệu không hợp lệ");
    }
    const iv = Buffer.from(parts[0], "base64");
    const encrypted = parts[1];
    const decipher = crypto__namespace.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("[KeyStorage] Lỗi giải mã:", error);
    throw new Error("Không thể giải mã dữ liệu");
  }
}
function saveApiKeys(accounts) {
  try {
    const filePath = getKeysFilePath();
    const jsonData = JSON.stringify(accounts, null, 2);
    const encryptedData = encrypt(jsonData);
    const dir = path__namespace.dirname(filePath);
    if (!fs__namespace.existsSync(dir)) {
      fs__namespace.mkdirSync(dir, { recursive: true });
    }
    fs__namespace.writeFileSync(filePath, encryptedData, "utf8");
    console.log(`[KeyStorage] Đã lưu ${accounts.length} accounts vào ${filePath}`);
  } catch (error) {
    console.error("[KeyStorage] Lỗi lưu keys:", error);
    throw error;
  }
}
function loadApiKeys() {
  try {
    const filePath = getKeysFilePath();
    if (!fs__namespace.existsSync(filePath)) {
      console.log("[KeyStorage] Chưa có file keys, trả về danh sách rỗng");
      return [];
    }
    const encryptedData = fs__namespace.readFileSync(filePath, "utf8");
    const jsonData = decrypt(encryptedData);
    const accounts = JSON.parse(jsonData);
    console.log(`[KeyStorage] Đã load ${accounts.length} accounts từ file`);
    return accounts;
  } catch (error) {
    console.error("[KeyStorage] Lỗi đọc keys:", error);
    return [];
  }
}
function addAccount(email, projects) {
  const accounts = loadApiKeys();
  const existingIndex = accounts.findIndex((acc) => acc.email === email);
  if (existingIndex >= 0) {
    accounts[existingIndex].projects = [
      ...accounts[existingIndex].projects,
      ...projects
    ];
    console.log(`[KeyStorage] Đã thêm ${projects.length} projects vào account ${email}`);
  } else {
    const newAccount = { email, projects };
    accounts.push(newAccount);
    console.log(`[KeyStorage] Đã thêm account mới: ${email}`);
  }
  saveApiKeys(accounts);
  return accounts[existingIndex >= 0 ? existingIndex : accounts.length - 1];
}
function removeAccount(email) {
  const accounts = loadApiKeys();
  const initialLength = accounts.length;
  const filteredAccounts = accounts.filter((acc) => acc.email !== email);
  if (filteredAccounts.length < initialLength) {
    saveApiKeys(filteredAccounts);
    console.log(`[KeyStorage] Đã xóa account: ${email}`);
    return true;
  }
  console.log(`[KeyStorage] Không tìm thấy account: ${email}`);
  return false;
}
function removeProject(email, projectName) {
  const accounts = loadApiKeys();
  const account = accounts.find((acc) => acc.email === email);
  if (!account) {
    console.log(`[KeyStorage] Không tìm thấy account: ${email}`);
    return false;
  }
  const initialLength = account.projects.length;
  account.projects = account.projects.filter((p) => p.projectName !== projectName);
  if (account.projects.length < initialLength) {
    saveApiKeys(accounts);
    console.log(`[KeyStorage] Đã xóa project ${projectName} khỏi account ${email}`);
    return true;
  }
  return false;
}
function importFromJson(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!Array.isArray(data)) {
      return { success: false, count: 0, error: "Dữ liệu phải là mảng accounts" };
    }
    for (const account of data) {
      if (!account.email || !Array.isArray(account.projects)) {
        return { success: false, count: 0, error: "Format account không hợp lệ" };
      }
      for (const project of account.projects) {
        if (!project.projectName || !project.apiKey) {
          return { success: false, count: 0, error: "Format project không hợp lệ" };
        }
      }
    }
    saveApiKeys(data);
    const totalKeys = data.reduce((sum, acc) => sum + acc.projects.length, 0);
    console.log(`[KeyStorage] Import thành công: ${data.length} accounts, ${totalKeys} keys`);
    return { success: true, count: totalKeys };
  } catch (error) {
    console.error("[KeyStorage] Lỗi import:", error);
    return { success: false, count: 0, error: String(error) };
  }
}
function exportToJson() {
  const accounts = loadApiKeys();
  return JSON.stringify(accounts, null, 2);
}
function hasKeys() {
  const accounts = loadApiKeys();
  return accounts.some((acc) => acc.projects.length > 0);
}
function countTotalKeys$1() {
  const accounts = loadApiKeys();
  return accounts.reduce((sum, acc) => sum + acc.projects.length, 0);
}
function getKeysFileLocation() {
  return getKeysFilePath();
}
function getEmbeddedKeys() {
  return loadApiKeys();
}
function countTotalKeys() {
  return countTotalKeys$1();
}
function tryImportDevKeys() {
  if (countTotalKeys() > 0) {
    console.log("[ApiKeys] Đã có keys trong storage, bỏ qua auto-import");
    return;
  }
  const devKeysPath = "d:\\NauChaoHeo\\gemini_keys.json";
  if (fs__namespace.existsSync(devKeysPath)) {
    console.log(`[ApiKeys] Tìm thấy file keys dev tại: ${devKeysPath}`);
    try {
      const content = fs__namespace.readFileSync(devKeysPath, "utf-8");
      const result = importFromJson(content);
      if (result.success) {
        console.log(`[ApiKeys] Auto-import thành công: ${result.count} keys`);
      } else {
        console.error(`[ApiKeys] Auto-import thất bại: ${result.error}`);
      }
    } catch (error) {
      console.error("[ApiKeys] Lỗi đọc file dev keys:", error);
    }
  } else {
    console.log("[ApiKeys] Không tìm thấy file gemini_keys.json");
  }
}
const DEFAULT_SETTINGS$1 = {
  globalCooldownSeconds: 65,
  defaultRpmLimit: 15,
  maxRpdLimit: 1500,
  rotationStrategy: "horizontal_sweep",
  retryExhaustedAfterHours: 24,
  delayBetweenRequestsMs: 1e3
};
const DEFAULT_ROTATION_STATE = {
  currentProjectIndex: 0,
  currentAccountIndex: 0,
  totalRequestsSent: 0,
  rotationRound: 1,
  lastDailyReset: null
};
function getAppDataDir() {
  const userDataPath = electron.app.getPath("userData");
  if (!fs__namespace.existsSync(userDataPath)) {
    fs__namespace.mkdirSync(userDataPath, { recursive: true });
  }
  return userDataPath;
}
function getStateFilePath() {
  return path__namespace.join(getAppDataDir(), "api_state.json");
}
function createDefaultProjectStats() {
  return {
    totalRequestsToday: 0,
    successCount: 0,
    errorCount: 0,
    lastSuccessTimestamp: null,
    lastErrorMessage: null
  };
}
function createDefaultLimitTracking() {
  return {
    lastUsedTimestamp: null,
    minuteRequestCount: 0,
    rateLimitResetAt: null,
    dailyLimitResetAt: null
  };
}
function createDefaultProjectState(projectIndex) {
  return {
    projectIndex,
    status: "available",
    stats: createDefaultProjectStats(),
    limitTracking: createDefaultLimitTracking()
  };
}
function createDefaultAccountState(accountId, numProjects) {
  return {
    accountId,
    accountStatus: "active",
    projects: Array.from({ length: numProjects }, (_, i) => createDefaultProjectState(i))
  };
}
function loadApiState() {
  const statePath = getStateFilePath();
  if (fs__namespace.existsSync(statePath)) {
    try {
      const data = fs__namespace.readFileSync(statePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error("[ApiConfig] Lỗi đọc api_state.json:", error);
    }
  }
  return null;
}
function createFreshState() {
  const embeddedKeys = getEmbeddedKeys();
  const accountsState = embeddedKeys.map((acc, i) => {
    const accountId = `acc_${String(i + 1).padStart(2, "0")}`;
    return createDefaultAccountState(accountId, acc.projects.length);
  });
  return {
    settings: { ...DEFAULT_SETTINGS$1 },
    rotationState: { ...DEFAULT_ROTATION_STATE },
    accounts: accountsState
  };
}
function saveApiState(state) {
  const statePath = getStateFilePath();
  try {
    fs__namespace.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
    console.log("[ApiConfig] Đã lưu api_state.json thành công");
    return true;
  } catch (error) {
    console.error("[ApiConfig] Lỗi lưu api_state.json:", error);
    return false;
  }
}
function getMergedConfig() {
  const embeddedKeys = getEmbeddedKeys();
  let state = loadApiState();
  if (!state) {
    state = createFreshState();
    saveApiState(state);
  }
  const mergedAccounts = embeddedKeys.map((embeddedAcc, i) => {
    const accountId = `acc_${String(i + 1).padStart(2, "0")}`;
    let accState = state.accounts.find((s) => s.accountId === accountId);
    if (!accState) {
      accState = createDefaultAccountState(accountId, embeddedAcc.projects.length);
    }
    const mergedProjects = embeddedAcc.projects.map((embeddedProj, j) => {
      let projState = accState.projects.find((ps) => ps.projectIndex === j);
      if (!projState) {
        projState = createDefaultProjectState(j);
      }
      return {
        projectIndex: j,
        projectName: embeddedProj.projectName || `Project-${j + 1}`,
        apiKey: embeddedProj.apiKey || "",
        status: projState.status,
        stats: projState.stats || createDefaultProjectStats(),
        limitTracking: projState.limitTracking || createDefaultLimitTracking()
      };
    });
    return {
      accountId,
      email: embeddedAcc.email || "",
      accountStatus: accState.accountStatus,
      projects: mergedProjects
    };
  });
  return {
    settings: state.settings || { ...DEFAULT_SETTINGS$1 },
    rotationState: state.rotationState || { ...DEFAULT_ROTATION_STATE },
    accounts: mergedAccounts
  };
}
function saveStateFromConfig(config) {
  const state = {
    settings: config.settings,
    rotationState: config.rotationState,
    accounts: config.accounts.map((acc) => ({
      accountId: acc.accountId,
      accountStatus: acc.accountStatus,
      projects: acc.projects.map((proj, j) => ({
        projectIndex: j,
        status: proj.status,
        stats: proj.stats,
        limitTracking: proj.limitTracking
      }))
    }))
  };
  return saveApiState(state);
}
const STATUS_AVAILABLE = "available";
const STATUS_RATE_LIMITED = "rate_limited";
const STATUS_EXHAUSTED = "exhausted";
const STATUS_ERROR = "error";
class ApiKeyManager {
  constructor() {
    console.log("[ApiManager] Khởi tạo API Key Manager...");
    this.config = this.loadConfig();
    this.autoRecoverAll();
    this.checkDailyReset();
    console.log("[ApiManager] Đã khởi tạo xong");
  }
  /**
   * Load config từ embedded keys + AppData state
   */
  loadConfig() {
    try {
      return getMergedConfig();
    } catch (error) {
      console.error("[ApiManager] Lỗi load config:", error);
      return this.createDefaultConfig();
    }
  }
  /**
   * Tạo config mặc định
   */
  createDefaultConfig() {
    return {
      settings: {
        globalCooldownSeconds: 65,
        defaultRpmLimit: 15,
        maxRpdLimit: 1500,
        rotationStrategy: "horizontal_sweep",
        retryExhaustedAfterHours: 24,
        delayBetweenRequestsMs: 1e3
      },
      rotationState: {
        currentProjectIndex: 0,
        currentAccountIndex: 0,
        totalRequestsSent: 0,
        rotationRound: 1,
        lastDailyReset: null
      },
      accounts: []
    };
  }
  /**
   * Lưu config vào AppData (chỉ lưu state, không lưu keys)
   */
  saveConfig() {
    try {
      saveStateFromConfig(this.config);
    } catch (error) {
      console.error("[ApiManager] Lỗi lưu config:", error);
    }
  }
  /**
   * Lấy rotation state
   */
  getRotationState() {
    if (!this.config.rotationState) {
      this.config.rotationState = {
        currentProjectIndex: 0,
        currentAccountIndex: 0,
        totalRequestsSent: 0,
        rotationRound: 1,
        lastDailyReset: null
      };
    }
    return this.config.rotationState;
  }
  /**
   * Auto-recover tất cả projects bị rate_limited đã hết cooldown
   */
  autoRecoverAll() {
    const currentTime = /* @__PURE__ */ new Date();
    let recoveredCount = 0;
    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        if (project.status === STATUS_RATE_LIMITED) {
          const resetAt = project.limitTracking.rateLimitResetAt;
          if (resetAt) {
            try {
              const resetTime = new Date(resetAt);
              if (currentTime >= resetTime) {
                project.status = STATUS_AVAILABLE;
                project.limitTracking.rateLimitResetAt = null;
                project.limitTracking.minuteRequestCount = 0;
                recoveredCount++;
              }
            } catch {
            }
          }
        }
      }
    }
    if (recoveredCount > 0) {
      console.log(`[ApiManager] Đã auto-recover ${recoveredCount} projects từ rate_limited`);
      this.saveConfig();
    }
  }
  /**
   * Kiểm tra và reset stats hàng ngày (0h sáng)
   */
  checkDailyReset() {
    const currentDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const rotationState = this.getRotationState();
    const lastReset = rotationState.lastDailyReset;
    if (lastReset !== currentDate) {
      console.log(`[ApiManager] Đang reset daily stats (last: ${lastReset}, current: ${currentDate})`);
      for (const account of this.config.accounts) {
        for (const project of account.projects) {
          project.stats.totalRequestsToday = 0;
          project.stats.successCount = 0;
          project.stats.errorCount = 0;
          if (project.status === STATUS_EXHAUSTED) {
            project.status = STATUS_AVAILABLE;
            project.limitTracking.dailyLimitResetAt = null;
          }
        }
      }
      rotationState.lastDailyReset = currentDate;
      this.saveConfig();
    }
  }
  /**
   * Kiểm tra project có available không (bao gồm auto-recover)
   */
  isProjectAvailable(project) {
    const status = project.status || STATUS_AVAILABLE;
    if (status === STATUS_RATE_LIMITED) {
      const resetAt = project.limitTracking.rateLimitResetAt;
      if (resetAt) {
        try {
          const resetTime = new Date(resetAt);
          if (/* @__PURE__ */ new Date() >= resetTime) {
            project.status = STATUS_AVAILABLE;
            project.limitTracking.rateLimitResetAt = null;
            project.limitTracking.minuteRequestCount = 0;
            return true;
          }
        } catch {
        }
      }
      return false;
    }
    if (status === STATUS_EXHAUSTED) {
      return false;
    }
    if (status === "disabled") {
      return false;
    }
    if (status === STATUS_ERROR) {
      return false;
    }
    if (!project.apiKey) {
      return false;
    }
    return status === STATUS_AVAILABLE;
  }
  /**
   * Lấy API key tiếp theo theo thuật toán "Quét Ngang"
   * 
   * Logic:
   * 1. Lấy key tại (current_account_index, current_project_index)
   * 2. Tăng current_account_index
   * 3. Nếu đã hết accounts -> reset account_index, tăng project_index
   * 4. Nếu đã hết projects -> reset project_index (quay lại vòng mới)
   */
  getNextApiKey() {
    this.autoRecoverAll();
    const accounts = this.config.accounts;
    if (!accounts || accounts.length === 0) {
      return { apiKey: null, keyInfo: null };
    }
    const numAccounts = accounts.length;
    const numProjects = Math.max(...accounts.map((acc) => acc.projects.length), 1);
    const state = this.getRotationState();
    let currentAccIdx = state.currentAccountIndex || 0;
    let currentProjIdx = state.currentProjectIndex || 0;
    console.log(`[ApiManager] Bắt đầu tìm key từ acc_${currentAccIdx + 1}/project_${currentProjIdx + 1}`);
    const totalAttempts = numAccounts * numProjects;
    let attempts = 0;
    while (attempts < totalAttempts) {
      const accIdx = currentAccIdx % numAccounts;
      const projIdx = currentProjIdx % numProjects;
      const account = accounts[accIdx];
      const projects = account.projects;
      if (account.accountStatus === "active" && projIdx < projects.length) {
        const project = projects[projIdx];
        if (this.isProjectAvailable(project)) {
          const apiKey = project.apiKey;
          const keyInfo = {
            accountId: account.accountId,
            accountEmail: account.email || "",
            projectName: project.projectName,
            apiKey,
            name: `${account.accountId}/${project.projectName}`,
            accountIndex: accIdx,
            projectIndex: projIdx
          };
          let nextAccIdx = accIdx + 1;
          let nextProjIdx = projIdx;
          if (nextAccIdx >= numAccounts) {
            nextAccIdx = 0;
            nextProjIdx = (projIdx + 1) % numProjects;
            state.rotationRound = (state.rotationRound || 1) + 1;
            console.log(`[ApiManager] Đã hết accounts, chuyển sang project ${nextProjIdx + 1}`);
          }
          state.currentAccountIndex = nextAccIdx;
          state.currentProjectIndex = nextProjIdx;
          state.totalRequestsSent = (state.totalRequestsSent || 0) + 1;
          this.saveConfig();
          console.log(`[ApiManager] Đã lấy key: ${keyInfo.name}`);
          return { apiKey, keyInfo };
        }
      }
      currentAccIdx++;
      if (currentAccIdx >= numAccounts) {
        currentAccIdx = 0;
        currentProjIdx++;
        console.log(`[ApiManager] Đã hết accounts cho project ${currentProjIdx}, chuyển sang project ${currentProjIdx + 1}`);
      }
      attempts++;
    }
    state.currentAccountIndex = currentAccIdx % numAccounts;
    state.currentProjectIndex = currentProjIdx % numProjects;
    this.saveConfig();
    console.warn("[ApiManager] Không còn key available nào");
    return { apiKey: null, keyInfo: null };
  }
  /**
   * Lấy tất cả API keys đang available theo thứ tự "Quét Ngang"
   */
  getAllAvailableKeys() {
    this.autoRecoverAll();
    const maxProjects = 5;
    const keysByProject = /* @__PURE__ */ new Map();
    for (let i = 0; i < maxProjects; i++) {
      keysByProject.set(i, []);
    }
    for (const account of this.config.accounts) {
      if (account.accountStatus !== "active") {
        continue;
      }
      for (let projIdx = 0; projIdx < account.projects.length; projIdx++) {
        const project = account.projects[projIdx];
        if (this.isProjectAvailable(project)) {
          const keyInfo = {
            accountId: account.accountId,
            accountEmail: account.email || "",
            projectName: project.projectName,
            apiKey: project.apiKey,
            name: `${account.accountId}/${project.projectName}`,
            accountIndex: this.config.accounts.indexOf(account),
            projectIndex: projIdx
          };
          keysByProject.get(projIdx)?.push(keyInfo);
        }
      }
    }
    const available = [];
    for (let projIdx = 0; projIdx < maxProjects; projIdx++) {
      available.push(...keysByProject.get(projIdx) || []);
    }
    console.log(`[ApiManager] Có ${available.length} key(s) available`);
    return available;
  }
  /**
   * Reset trạng thái của tất cả keys từ rate_limited/exhausted -> available
   * Dùng khi chuyển model
   */
  resetAllStatusExceptDisabled() {
    console.log("[ApiManager] Đang reset tất cả trạng thái keys...");
    let resetCount = 0;
    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        const status = project.status;
        if (status === STATUS_RATE_LIMITED || status === STATUS_EXHAUSTED || status === STATUS_ERROR) {
          project.status = STATUS_AVAILABLE;
          project.limitTracking.rateLimitResetAt = null;
          project.limitTracking.dailyLimitResetAt = null;
          project.limitTracking.minuteRequestCount = 0;
          project.stats.lastErrorMessage = "";
          resetCount++;
          console.log(`[ApiManager] Reset project: ${project.projectName} (was: ${status})`);
        }
      }
    }
    this.saveConfig();
    console.log(`[ApiManager] Đã reset ${resetCount} project(s)`);
  }
  /**
   * Ghi nhận request thành công
   */
  recordSuccess(apiKey) {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      project.stats.totalRequestsToday++;
      project.stats.successCount++;
      project.stats.lastSuccessTimestamp = (/* @__PURE__ */ new Date()).toISOString();
      project.limitTracking.lastUsedTimestamp = (/* @__PURE__ */ new Date()).toISOString();
      project.limitTracking.minuteRequestCount++;
      this.saveConfig();
      console.log(`[ApiManager] Ghi nhận thành công cho key: ${apiKey.substring(0, 10)}...`);
    }
  }
  /**
   * Ghi nhận lỗi rate limit (429) - RPM
   */
  recordRateLimitError(apiKey) {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      const cooldown = this.config.settings.globalCooldownSeconds || 65;
      const resetTime = new Date(Date.now() + cooldown * 1e3);
      project.status = STATUS_RATE_LIMITED;
      project.stats.errorCount++;
      project.stats.lastErrorMessage = `429 Rate Limited at ${(/* @__PURE__ */ new Date()).toISOString()}`;
      project.limitTracking.rateLimitResetAt = resetTime.toISOString();
      project.limitTracking.minuteRequestCount = 0;
      console.warn(`[ApiManager] API key bị rate limit, sẽ reset lúc ${resetTime.toISOString()}`);
      this.saveConfig();
    }
  }
  /**
   * Ghi nhận lỗi hết quota ngày (RPD)
   */
  recordQuotaExhausted(apiKey) {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      const tomorrow = /* @__PURE__ */ new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      project.status = STATUS_EXHAUSTED;
      project.stats.errorCount++;
      project.stats.lastErrorMessage = `Daily quota exhausted at ${(/* @__PURE__ */ new Date()).toISOString()}`;
      project.limitTracking.dailyLimitResetAt = tomorrow.toISOString();
      console.warn(`[ApiManager] API key hết quota ngày, sẽ reset lúc ${tomorrow.toISOString()}`);
      this.saveConfig();
    }
  }
  /**
   * Ghi nhận lỗi khác (không phải rate limit)
   */
  recordError(apiKey, errorMessage) {
    const project = this.findProjectByKey(apiKey);
    if (project) {
      project.stats.errorCount++;
      project.stats.lastErrorMessage = errorMessage;
      if (errorMessage.toLowerCase().includes("invalid") || errorMessage.toLowerCase().includes("api key")) {
        project.status = STATUS_ERROR;
      }
      console.error(`[ApiManager] Ghi nhận lỗi cho key: ${errorMessage}`);
      this.saveConfig();
    }
  }
  /**
   * Tìm project theo API key
   */
  findProjectByKey(apiKey) {
    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        if (project.apiKey === apiKey) {
          return project;
        }
      }
    }
    return null;
  }
  /**
   * Lấy thống kê tổng quan
   */
  getStats() {
    const totalAccounts = this.config.accounts.length;
    let totalProjects = 0;
    let available = 0;
    let rateLimited = 0;
    let exhausted = 0;
    let error = 0;
    let emptyKeys = 0;
    let totalRequests = 0;
    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        totalProjects++;
        if (!project.apiKey) {
          emptyKeys++;
          continue;
        }
        if (this.isProjectAvailable(project)) {
          available++;
        } else if (project.status === STATUS_RATE_LIMITED) {
          rateLimited++;
        } else if (project.status === STATUS_EXHAUSTED) {
          exhausted++;
        } else {
          error++;
        }
        totalRequests += project.stats.totalRequestsToday || 0;
      }
    }
    const state = this.getRotationState();
    return {
      totalAccounts,
      totalProjects,
      available,
      rateLimited,
      exhausted,
      error,
      emptyKeys,
      totalRequestsToday: totalRequests,
      currentAccountIndex: state.currentAccountIndex || 0,
      currentProjectIndex: state.currentProjectIndex || 0,
      rotationRound: state.rotationRound || 1
    };
  }
  /**
   * Lấy delay giữa các request (milliseconds)
   */
  getDelayMs() {
    return this.config.settings.delayBetweenRequestsMs || 1e3;
  }
  /**
   * Reload config từ file
   */
  reload() {
    console.log("[ApiManager] Đang reload config...");
    this.config = this.loadConfig();
    this.autoRecoverAll();
    this.checkDailyReset();
    console.log("[ApiManager] Đã reload xong");
  }
  /**
   * Reset rotation state về đầu
   */
  resetRotationState() {
    const state = this.getRotationState();
    state.currentAccountIndex = 0;
    state.currentProjectIndex = 0;
    state.rotationRound = 1;
    this.saveConfig();
    console.log("[ApiManager] Đã reset rotation state");
  }
}
let managerInstance = null;
function getApiManager() {
  if (!managerInstance) {
    managerInstance = new ApiKeyManager();
  }
  return managerInstance;
}
async function callGeminiApi(prompt, apiKey, model = GEMINI_MODELS.FLASH_3_0) {
  try {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
    const promptText = typeof prompt === "string" ? prompt : JSON.stringify(prompt, null, 2);
    const payload = {
      contents: [
        {
          parts: [{ text: promptText }]
        }
      ]
    };
    console.log(`[GeminiService] Gọi Gemini API với model: ${model}`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (response.status === 429) {
      return { success: false, error: "RATE_LIMIT" };
    }
    if (response.status === 404) {
      return { success: false, error: `Model ${model} không tồn tại` };
    }
    if (!response.ok) {
      try {
        const errorDetail = await response.json();
        const errorMsg = errorDetail?.error?.message || "Lỗi không xác định";
        console.error(`[GeminiService] API Error ${response.status}: ${errorMsg}`);
        return { success: false, error: `API Error: ${errorMsg}` };
      } catch {
        console.error(`[GeminiService] API Error ${response.status}: ${response.statusText}`);
        return { success: false, error: `HTTP ${response.status}` };
      }
    }
    const result = await response.json();
    if (result.candidates && result.candidates.length > 0) {
      const candidate = result.candidates[0];
      if (candidate.content && candidate.content.parts) {
        const text = candidate.content.parts[0]?.text || "";
        return { success: true, data: text.trim() };
      }
    }
    return { success: false, error: "Response không có nội dung" };
  } catch (error) {
    console.error("[GeminiService] Lỗi gọi API:", error);
    return { success: false, error: String(error) };
  }
}
async function callGeminiWithRotation(prompt, model = GEMINI_MODELS.FLASH_3_0, maxRetries = 10) {
  const manager = getApiManager();
  const stats = manager.getStats();
  if (stats.totalProjects === 0) {
    return { success: false, error: "Không có API key nào trong hệ thống" };
  }
  let lastError = "";
  let rateLimitedCount = 0;
  const triedKeys = /* @__PURE__ */ new Set();
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { apiKey, keyInfo } = manager.getNextApiKey();
    if (!apiKey || !keyInfo) {
      console.warn(`[GeminiService] Không còn key available sau ${attempt} lần thử`);
      break;
    }
    if (triedKeys.has(apiKey)) {
      if (triedKeys.size >= stats.available) {
        console.log(`[GeminiService] Đã thử hết tất cả keys (${triedKeys.size} keys)`);
        break;
      }
      continue;
    }
    triedKeys.add(apiKey);
    console.log(`[GeminiService] Thử API key #${triedKeys.size} (${keyInfo.name})`);
    const response = await callGeminiApi(prompt, apiKey, model);
    if (response.success) {
      manager.recordSuccess(apiKey);
      console.log(`[GeminiService] Thành công với ${keyInfo.name}`);
      return { ...response, keyInfo };
    }
    if (response.error === "RATE_LIMIT") {
      console.warn(`[GeminiService] Rate limit với ${keyInfo.name}, thử key tiếp theo...`);
      manager.recordRateLimitError(apiKey);
      lastError = "RATE_LIMIT_ALL_KEYS";
      rateLimitedCount++;
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    console.error(`[GeminiService] Lỗi với ${keyInfo.name}: ${response.error}`);
    if (response.error?.toLowerCase().includes("exhausted") || response.error?.toLowerCase().includes("quota")) {
      manager.recordQuotaExhausted(apiKey);
    } else {
      manager.recordError(apiKey, response.error || "Unknown error");
    }
    lastError = response.error || "Unknown error";
  }
  if (rateLimitedCount > 0 && rateLimitedCount >= triedKeys.size) {
    console.warn(`[GeminiService] Tất cả ${rateLimitedCount} keys đã thử đều bị rate limit`);
    return { success: false, error: "RATE_LIMIT_ALL_KEYS" };
  }
  return { success: false, error: `Thất bại sau ${triedKeys.size} lần thử: ${lastError}` };
}
async function translateText(text, targetLanguage = "Vietnamese", model = GEMINI_MODELS.FLASH_3_0) {
  const prompt = {
    task: "translation",
    source_text: text,
    target_language: targetLanguage,
    instructions: {
      rules: [
        "Dịch tự nhiên, không dịch word-by-word",
        "Giữ nguyên format và cấu trúc câu",
        "Không thêm giải thích hoặc ghi chú"
      ]
    },
    response_format: "Chỉ trả về bản dịch, không có text khác"
  };
  return callGeminiWithRotation(prompt, model);
}
function registerGeminiHandlers() {
  console.log("[IPC] Đang đăng ký Gemini handlers...");
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.GET_NEXT_API_KEY,
    async () => {
      try {
        const manager = getApiManager();
        const { apiKey, keyInfo } = manager.getNextApiKey();
        return { success: true, data: { apiKey, keyInfo } };
      } catch (error) {
        console.error("[IPC] Lỗi getNextApiKey:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.GET_ALL_AVAILABLE_KEYS,
    async () => {
      try {
        const manager = getApiManager();
        const keys = manager.getAllAvailableKeys();
        return { success: true, data: keys };
      } catch (error) {
        console.error("[IPC] Lỗi getAllAvailableKeys:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.GET_STATS,
    async () => {
      try {
        const manager = getApiManager();
        const stats = manager.getStats();
        return { success: true, data: stats };
      } catch (error) {
        console.error("[IPC] Lỗi getStats:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.RECORD_SUCCESS,
    async (_event, apiKey) => {
      try {
        const manager = getApiManager();
        manager.recordSuccess(apiKey);
        return { success: true, data: true };
      } catch (error) {
        console.error("[IPC] Lỗi recordSuccess:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.RECORD_RATE_LIMIT,
    async (_event, apiKey) => {
      try {
        const manager = getApiManager();
        manager.recordRateLimitError(apiKey);
        return { success: true, data: true };
      } catch (error) {
        console.error("[IPC] Lỗi recordRateLimit:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.RECORD_EXHAUSTED,
    async (_event, apiKey) => {
      try {
        const manager = getApiManager();
        manager.recordQuotaExhausted(apiKey);
        return { success: true, data: true };
      } catch (error) {
        console.error("[IPC] Lỗi recordExhausted:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.RECORD_ERROR,
    async (_event, apiKey, errorMessage) => {
      try {
        const manager = getApiManager();
        manager.recordError(apiKey, errorMessage);
        return { success: true, data: true };
      } catch (error) {
        console.error("[IPC] Lỗi recordError:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.RESET_ALL_STATUS,
    async () => {
      try {
        const manager = getApiManager();
        manager.resetAllStatusExceptDisabled();
        return { success: true, data: true };
      } catch (error) {
        console.error("[IPC] Lỗi resetAllStatus:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.RELOAD_CONFIG,
    async () => {
      try {
        const manager = getApiManager();
        manager.reload();
        return { success: true, data: true };
      } catch (error) {
        console.error("[IPC] Lỗi reloadConfig:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.CALL_GEMINI,
    async (_event, prompt, model) => {
      try {
        const result = await callGeminiWithRotation(prompt, model || GEMINI_MODELS.FLASH_3_0);
        return { success: true, data: result };
      } catch (error) {
        console.error("[IPC] Lỗi callGemini:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.TRANSLATE_TEXT,
    async (_event, text, targetLanguage, model) => {
      try {
        const result = await translateText(
          text,
          targetLanguage || "Vietnamese",
          model || GEMINI_MODELS.FLASH_3_0
        );
        return { success: true, data: result };
      } catch (error) {
        console.error("[IPC] Lỗi Gemini.translateText:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_IMPORT,
    async (_event, jsonString) => {
      try {
        console.log("[IPC] Đang import API keys...");
        const result = importFromJson(jsonString);
        if (result.success) {
          const manager = getApiManager();
          manager.reload();
          console.log(`[IPC] Import thành công ${result.count} keys`);
          return { success: true, data: { count: result.count } };
        } else {
          return { success: false, error: result.error };
        }
      } catch (error) {
        console.error("[IPC] Lỗi import keys:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_EXPORT,
    async () => {
      try {
        const json = exportToJson();
        console.log("[IPC] Đã export API keys");
        return { success: true, data: json };
      } catch (error) {
        console.error("[IPC] Lỗi export keys:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_ADD_ACCOUNT,
    async (_event, email, projects) => {
      try {
        console.log(`[IPC] Thêm account: ${email} với ${projects.length} projects`);
        const account = addAccount(email, projects);
        const manager = getApiManager();
        manager.reload();
        return { success: true, data: account };
      } catch (error) {
        console.error("[IPC] Lỗi thêm account:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_REMOVE_ACCOUNT,
    async (_event, email) => {
      try {
        console.log(`[IPC] Xóa account: ${email}`);
        const removed = removeAccount(email);
        if (removed) {
          const manager = getApiManager();
          manager.reload();
        }
        return { success: true, data: removed };
      } catch (error) {
        console.error("[IPC] Lỗi xóa account:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_REMOVE_PROJECT,
    async (_event, email, projectName) => {
      try {
        console.log(`[IPC] Xóa project ${projectName} từ account ${email}`);
        const removed = removeProject(email, projectName);
        if (removed) {
          const manager = getApiManager();
          manager.reload();
        }
        return { success: true, data: removed };
      } catch (error) {
        console.error("[IPC] Lỗi xóa project:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_HAS_KEYS,
    async () => {
      try {
        const has = hasKeys();
        return { success: true, data: has };
      } catch (error) {
        console.error("[IPC] Lỗi kiểm tra keys:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_GET_LOCATION,
    async () => {
      try {
        const location = getKeysFileLocation();
        return { success: true, data: location };
      } catch (error) {
        console.error("[IPC] Lỗi lấy đường dẫn keys:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_GET_ALL,
    async () => {
      try {
        const accounts = loadApiKeys();
        const maskedAccounts = accounts.map((acc) => ({
          ...acc,
          projects: acc.projects.map((p) => ({
            ...p,
            apiKey: p.apiKey.substring(0, 8) + "..." + p.apiKey.substring(p.apiKey.length - 4)
          }))
        }));
        return { success: true, data: maskedAccounts };
      } catch (error) {
        console.error("[IPC] Lỗi lấy danh sách accounts:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    GEMINI_IPC_CHANNELS.KEYS_GET_ALL_WITH_STATUS,
    async () => {
      try {
        const manager = getApiManager();
        const stats = manager.getStats();
        const config = manager.config;
        if (!config || !config.accounts) {
          return { success: true, data: [] };
        }
        const accountsWithStatus = config.accounts.map((acc) => ({
          email: acc.email || acc.accountId,
          accountId: acc.accountId,
          accountStatus: acc.accountStatus || "active",
          projects: acc.projects.map((p) => ({
            projectName: p.projectName,
            status: p.status || "available",
            apiKey: p.apiKey.substring(0, 8) + "..." + p.apiKey.substring(p.apiKey.length - 4),
            totalRequestsToday: p.stats?.totalRequestsToday || 0,
            lastUsed: p.stats?.lastUsed || null,
            errorMessage: p.stats?.lastError || null
          }))
        }));
        return {
          success: true,
          data: accountsWithStatus
        };
      } catch (error) {
        console.error("[IPC] Lỗi lấy accounts với status:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  console.log("[IPC] Đã đăng ký xong Gemini handlers");
}
const CAPTION_IPC_CHANNELS = {
  // Caption
  PARSE_SRT: "caption:parseSrt",
  TRANSLATE: "caption:translate",
  TRANSLATE_PROGRESS: "caption:translateProgress",
  EXPORT_SRT: "caption:exportSrt",
  SPLIT: "caption:split",
  // TTS
  TTS_GENERATE: "tts:generate",
  TTS_PROGRESS: "tts:progress",
  TTS_GET_VOICES: "tts:getVoices",
  TTS_TRIM_SILENCE: "tts:trimSilence",
  // Audio Merge
  AUDIO_ANALYZE: "audio:analyze",
  AUDIO_MERGE: "audio:merge",
  AUDIO_MERGE_PROGRESS: "audio:mergeProgress"
};
const VIETNAMESE_VOICES = [
  { name: "vi-VN-HoaiMyNeural", displayName: "Hoài My (Nữ)", language: "vi-VN", gender: "Female" },
  { name: "vi-VN-NamMinhNeural", displayName: "Nam Minh (Nam)", language: "vi-VN", gender: "Male" }
];
const DEFAULT_VOICE = "vi-VN-HoaiMyNeural";
const DEFAULT_RATE = "+0%";
const DEFAULT_VOLUME = "+0%";
function srtTimeToMs(timeStr) {
  const normalized = timeStr.trim().replace(".", ",");
  const [time, ms] = normalized.split(",");
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return (hours * 3600 + minutes * 60 + seconds) * 1e3 + Number(ms);
}
async function parseSrtFile(filePath) {
  console.log(`[SrtParser] Đang parse file: ${path__namespace.basename(filePath)}`);
  try {
    await fs__namespace$1.access(filePath);
    const content = await fs__namespace$1.readFile(filePath, "utf-8");
    const entries = [];
    const blocks = content.trim().split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 3) continue;
      try {
        const index = parseInt(lines[0].trim(), 10);
        if (isNaN(index)) continue;
        const timeLine = lines[1].trim();
        const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
        if (!timeMatch) continue;
        const startTime = timeMatch[1].replace(".", ",");
        const endTime = timeMatch[2].replace(".", ",");
        const startMs = srtTimeToMs(startTime);
        const endMs = srtTimeToMs(endTime);
        const text = lines.slice(2).join(" ").trim();
        if (text) {
          entries.push({
            index,
            startTime,
            endTime,
            startMs,
            endMs,
            durationMs: endMs - startMs,
            text
          });
        }
      } catch (err) {
        console.warn(`[SrtParser] Lỗi parse block: ${lines[0]}`);
        continue;
      }
    }
    console.log(`[SrtParser] Parse thành công: ${entries.length} entries`);
    return {
      success: true,
      entries,
      totalEntries: entries.length,
      filePath
    };
  } catch (error) {
    const errorMsg = `Lỗi đọc file SRT: ${error}`;
    console.error(`[SrtParser] ${errorMsg}`);
    return {
      success: false,
      entries: [],
      totalEntries: 0,
      filePath,
      error: errorMsg
    };
  }
}
async function exportToSrt(entries, outputPath, useTranslated = true) {
  console.log(`[SrtParser] Đang export ${entries.length} entries ra: ${path__namespace.basename(outputPath)}`);
  try {
    const dir = path__namespace.dirname(outputPath);
    await fs__namespace$1.mkdir(dir, { recursive: true });
    const srtContent = entries.map((entry, idx) => {
      const text = useTranslated && entry.translatedText ? entry.translatedText : entry.text;
      return `${idx + 1}
${entry.startTime} --> ${entry.endTime}
${text}`;
    }).join("\n\n");
    await fs__namespace$1.writeFile(outputPath, srtContent + "\n", "utf-8");
    console.log(`[SrtParser] Export thành công: ${outputPath}`);
    return { success: true };
  } catch (error) {
    const errorMsg = `Lỗi export SRT: ${error}`;
    console.error(`[SrtParser] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
function msToSrtTime(ms) {
  const hours = Math.floor(ms / 36e5);
  const minutes = Math.floor(ms % 36e5 / 6e4);
  const seconds = Math.floor(ms % 6e4 / 1e3);
  const milliseconds = ms % 1e3;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}
function extractTextFromContent(content) {
  if (!content) return "";
  if (content.startsWith("{") && content.endsWith("}")) {
    try {
      const parsed = JSON.parse(content);
      return parsed.text || content;
    } catch {
      return content;
    }
  }
  return content;
}
async function parseDraftJson(filePath) {
  console.log(`[DraftParser] Đang parse: ${filePath}`);
  try {
    const fileContent = await fs__namespace$1.readFile(filePath, "utf-8");
    const data = JSON.parse(fileContent);
    const entries = [];
    if (data.extra_info?.subtitle_fragment_info_list) {
      const fragments = data.extra_info.subtitle_fragment_info_list;
      for (const fragment of fragments) {
        if (fragment.subtitle_cache_info) {
          try {
            const cacheInfo = JSON.parse(fragment.subtitle_cache_info);
            if (cacheInfo.sentence_list) {
              for (const sentence of cacheInfo.sentence_list) {
                const startMs = sentence.start_time || 0;
                const endMs = sentence.end_time || 0;
                const text = sentence.text || "";
                if (text) {
                  entries.push({
                    index: entries.length + 1,
                    startTime: msToSrtTime(startMs),
                    endTime: msToSrtTime(endMs),
                    startMs,
                    endMs,
                    durationMs: endMs - startMs,
                    text,
                    translatedText: sentence.translation_text || void 0
                  });
                }
              }
            }
          } catch {
            continue;
          }
        }
      }
    }
    if (entries.length === 0 && data.materials?.texts && data.tracks) {
      console.log("[DraftParser] Sử dụng phương pháp materials.texts + tracks");
      const textTracks = data.tracks.filter((t) => t.type === "text");
      for (const track of textTracks) {
        if (track.segments) {
          for (const segment of track.segments) {
            const materialId = segment.material_id;
            const startMs = segment.target_timerange?.start || 0;
            const durationMs = segment.target_timerange?.duration || 0;
            const endMs = startMs + durationMs;
            const textMaterial = data.materials.texts.find((t) => t.id === materialId);
            if (textMaterial) {
              const text = extractTextFromContent(textMaterial.content) || textMaterial.recognize_text || "";
              if (text) {
                entries.push({
                  index: entries.length + 1,
                  startTime: msToSrtTime(startMs),
                  endTime: msToSrtTime(endMs),
                  startMs,
                  endMs,
                  durationMs,
                  text
                });
              }
            }
          }
        }
      }
    }
    if (entries.length === 0 && data.materials?.texts) {
      console.log("[DraftParser] Sử dụng phương pháp materials.texts (không có timing)");
      for (const textItem of data.materials.texts) {
        const text = extractTextFromContent(textItem.content) || textItem.recognize_text || "";
        if (text) {
          entries.push({
            index: entries.length + 1,
            startTime: "00:00:00,000",
            endTime: "00:00:00,000",
            startMs: 0,
            endMs: 0,
            durationMs: 0,
            text
          });
        }
      }
    }
    entries.sort((a, b) => a.startMs - b.startMs);
    entries.forEach((entry, idx) => {
      entry.index = idx + 1;
    });
    console.log(`[DraftParser] Đã parse ${entries.length} entries`);
    return {
      success: true,
      entries,
      totalEntries: entries.length,
      filePath
    };
  } catch (error) {
    console.error("[DraftParser] Lỗi:", error);
    return {
      success: false,
      entries: [],
      totalEntries: 0,
      filePath,
      error: String(error)
    };
  }
}
function splitForTranslation(entries, linesPerBatch = 50) {
  console.log(`[TextSplitter] Chia ${entries.length} entries thành batches (${linesPerBatch} dòng/batch)`);
  const batches = [];
  const totalBatches = Math.ceil(entries.length / linesPerBatch);
  for (let i = 0; i < totalBatches; i++) {
    const startIndex = i * linesPerBatch;
    const endIndex = Math.min(startIndex + linesPerBatch, entries.length);
    const batchEntries = entries.slice(startIndex, endIndex);
    batches.push({
      batchIndex: i,
      startIndex,
      endIndex,
      entries: batchEntries,
      texts: batchEntries.map((e) => e.text)
    });
  }
  console.log(`[TextSplitter] Đã chia thành ${batches.length} batches`);
  return batches;
}
function mergeTranslatedTexts(entries, translatedTexts) {
  console.log(`[TextSplitter] Merge ${translatedTexts.length} translated texts`);
  return entries.map((entry, index) => ({
    ...entry,
    translatedText: translatedTexts[index] || entry.text
  }));
}
function createTranslationPrompt(texts, targetLanguage = "Vietnamese") {
  const numberedLines = texts.map((text, i) => `[${i + 1}] ${text}`).join("\n");
  return `Dịch các dòng subtitle sau sang tiếng ${targetLanguage}.
Quy tắc:
1. Dịch tự nhiên, phù hợp ngữ cảnh
2. Giữ nguyên số thứ tự [1], [2], ...
3. Không thêm giải thích
4. Mỗi dòng dịch tương ứng với dòng gốc

Nội dung cần dịch:
${numberedLines}

Kết quả (chỉ trả về các dòng đã dịch, giữ nguyên format [số]):`;
}
function parseTranslationResponse(response, expectedCount) {
  console.log(`[TextSplitter] Parse translation response, expected ${expectedCount} lines`);
  const results = [];
  const lines = response.trim().split("\n");
  const linePattern = /^\[?(\d+)\]?[.):]?\s*(.+)$/;
  for (const line of lines) {
    const match = line.trim().match(linePattern);
    if (match) {
      const index = parseInt(match[1], 10) - 1;
      const text = match[2].trim();
      if (index >= 0 && index < expectedCount) {
        results[index] = text;
      }
    }
  }
  for (let i = 0; i < expectedCount; i++) {
    if (!results[i]) {
      results[i] = "";
      console.warn(`[TextSplitter] Thiếu dịch cho dòng ${i + 1}`);
    }
  }
  console.log(`[TextSplitter] Parse được ${results.filter((r) => r).length}/${expectedCount} dòng`);
  return results;
}
async function splitText(options) {
  const { entries, splitByLines, value, outputDir } = options;
  console.log(`[TextSplitter] Split text: ${entries.length} entries, splitByLines=${splitByLines}, value=${value}`);
  try {
    if (!fs__namespace.existsSync(outputDir)) {
      fs__namespace.mkdirSync(outputDir, { recursive: true });
    }
    const files = [];
    let batches;
    if (splitByLines) {
      batches = [];
      for (let i = 0; i < entries.length; i += value) {
        batches.push(entries.slice(i, i + value));
      }
    } else {
      const partsCount = Math.max(1, Math.min(value, entries.length));
      const entriesPerPart = Math.ceil(entries.length / partsCount);
      batches = [];
      for (let i = 0; i < partsCount; i++) {
        const start = i * entriesPerPart;
        const end = Math.min(start + entriesPerPart, entries.length);
        if (start < entries.length) {
          batches.push(entries.slice(start, end));
        }
      }
    }
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const fileName = `part_${String(i + 1).padStart(3, "0")}.txt`;
      const filePath = path__namespace.join(outputDir, fileName);
      const content = batch.map((entry) => entry.text).join("\n");
      fs__namespace.writeFileSync(filePath, content, "utf-8");
      files.push(filePath);
      console.log(`[TextSplitter] Đã ghi file: ${filePath} (${batch.length} dòng)`);
    }
    console.log(`[TextSplitter] Đã chia thành ${files.length} files`);
    return {
      success: true,
      partsCount: files.length,
      files
    };
  } catch (error) {
    console.error("[TextSplitter] Lỗi split text:", error);
    return {
      success: false,
      partsCount: 0,
      files: [],
      error: String(error)
    };
  }
}
async function translateBatch(batch, model, targetLanguage) {
  console.log(`[CaptionTranslator] Dịch batch ${batch.batchIndex + 1} (${batch.texts.length} dòng)`);
  const prompt = createTranslationPrompt(batch.texts, targetLanguage);
  try {
    const response = await callGeminiWithRotation(prompt, model);
    if (!response.success || !response.data) {
      return {
        success: false,
        translatedTexts: [],
        error: response.error || "Không có response"
      };
    }
    const translatedTexts = parseTranslationResponse(response.data, batch.texts.length);
    const validCount = translatedTexts.filter((t) => t.trim()).length;
    if (validCount < batch.texts.length * 0.8) {
      console.warn(
        `[CaptionTranslator] Batch ${batch.batchIndex + 1}: Chỉ dịch được ${validCount}/${batch.texts.length}`
      );
    }
    return {
      success: true,
      translatedTexts
    };
  } catch (error) {
    console.error(`[CaptionTranslator] Lỗi dịch batch ${batch.batchIndex + 1}:`, error);
    return {
      success: false,
      translatedTexts: [],
      error: String(error)
    };
  }
}
async function translateAll(options, progressCallback) {
  const {
    entries,
    targetLanguage = "Vietnamese",
    model = GEMINI_MODELS.FLASH_3_0,
    linesPerBatch = 50
  } = options;
  console.log(`[CaptionTranslator] Bắt đầu dịch ${entries.length} entries`);
  console.log(`[CaptionTranslator] Model: ${model}, Target: ${targetLanguage}`);
  const batches = splitForTranslation(entries, linesPerBatch);
  const allTranslatedTexts = new Array(entries.length).fill("");
  const errors = [];
  let translatedCount = 0;
  let failedCount = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (progressCallback) {
      progressCallback({
        current: batch.startIndex,
        total: entries.length,
        batchIndex: i,
        totalBatches: batches.length,
        status: "translating",
        message: `Đang dịch batch ${i + 1}/${batches.length}...`
      });
    }
    let retryCount = 0;
    const maxRetries = 2;
    let batchResult = await translateBatch(batch, model, targetLanguage);
    while (!batchResult.success && retryCount < maxRetries) {
      retryCount++;
      console.log(`[CaptionTranslator] Retry ${retryCount}/${maxRetries} cho batch ${i + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 2e3));
      batchResult = await translateBatch(batch, model, targetLanguage);
    }
    if (batchResult.success) {
      for (let j = 0; j < batchResult.translatedTexts.length; j++) {
        const globalIndex = batch.startIndex + j;
        allTranslatedTexts[globalIndex] = batchResult.translatedTexts[j];
        if (batchResult.translatedTexts[j].trim()) {
          translatedCount++;
        } else {
          failedCount++;
        }
      }
    } else {
      errors.push(`Batch ${i + 1}: ${batchResult.error}`);
      failedCount += batch.texts.length;
    }
    if (i < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
  }
  const resultEntries = mergeTranslatedTexts(entries, allTranslatedTexts);
  if (progressCallback) {
    progressCallback({
      current: entries.length,
      total: entries.length,
      batchIndex: batches.length,
      totalBatches: batches.length,
      status: "completed",
      message: `Hoàn thành: ${translatedCount}/${entries.length} dòng`
    });
  }
  console.log(
    `[CaptionTranslator] Hoàn thành: ${translatedCount} dịch, ${failedCount} lỗi`
  );
  return {
    success: failedCount === 0,
    entries: resultEntries,
    totalLines: entries.length,
    translatedLines: translatedCount,
    failedLines: failedCount,
    errors: errors.length > 0 ? errors : void 0
  };
}
function registerCaptionHandlers() {
  console.log("[CaptionHandlers] Đăng ký handlers...");
  electron.ipcMain.handle(
    "dialog:openFile",
    async (_event, options) => {
      console.log("[CaptionHandlers] Mở dialog chọn file...");
      const result = await electron.dialog.showOpenDialog({
        properties: ["openFile"],
        filters: options?.filters || [{ name: "All Files", extensions: ["*"] }]
      });
      return result;
    }
  );
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.PARSE_SRT,
    async (_event, filePath) => {
      console.log(`[CaptionHandlers] Parse SRT: ${filePath}`);
      try {
        const result = await parseSrtFile(filePath);
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi parse SRT:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    "caption:parseDraft",
    async (_event, filePath) => {
      console.log(`[CaptionHandlers] Parse Draft JSON: ${filePath}`);
      try {
        const result = await parseDraftJson(filePath);
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi parse Draft:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.TRANSLATE,
    async (event, options) => {
      console.log(`[CaptionHandlers] Translate: ${options.entries.length} entries`);
      try {
        const progressCallback = (progress) => {
          const window = electron.BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send(CAPTION_IPC_CHANNELS.TRANSLATE_PROGRESS, progress);
          }
        };
        const result = await translateAll(options, progressCallback);
        return { success: result.success, data: result, error: result.errors?.join(", ") };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi translate:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.EXPORT_SRT,
    async (_event, entries, outputPath) => {
      console.log(`[CaptionHandlers] Export SRT: ${entries.length} entries -> ${outputPath}`);
      try {
        const result = await exportToSrt(entries, outputPath, true);
        if (result.success) {
          return { success: true, data: outputPath };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi export SRT:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.SPLIT,
    async (_event, options) => {
      console.log(`[CaptionHandlers] Split: ${options.entries.length} entries, splitByLines=${options.splitByLines}, value=${options.value}`);
      try {
        const result = await splitText(options);
        return { success: result.success, data: { partsCount: result.partsCount, files: result.files }, error: result.error };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi split:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  console.log("[CaptionHandlers] Đã đăng ký handlers thành công");
}
function getSafeFilename(index, text, ext = "wav") {
  const safeText = text.slice(0, 30).replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\s-]/g, "").replace(/\s+/g, "_").trim();
  return `${index.toString().padStart(3, "0")}_${safeText || "audio"}.${ext}`;
}
async function generateSingleAudio(text, outputPath, voice = DEFAULT_VOICE, rate = DEFAULT_RATE, volume = DEFAULT_VOLUME) {
  return new Promise((resolve) => {
    const args = [
      "--voice",
      voice,
      "--rate",
      rate,
      "--volume",
      volume,
      "--text",
      text,
      "--write-media",
      outputPath
    ];
    console.log(`[TTS] Tạo audio: ${path__namespace.basename(outputPath)}`);
    const proc = child_process.spawn("edge-tts", args, {
      windowsHide: true,
      shell: true
    });
    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    proc.on("close", async (code) => {
      if (code === 0) {
        try {
          const stats = await fs__namespace$1.stat(outputPath);
          if (stats.size > 0) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: "File created but empty" });
          }
        } catch {
          resolve({ success: false, error: "File not created" });
        }
      } else {
        resolve({ success: false, error: stderr || `Exit code: ${code}` });
      }
    });
    proc.on("error", (err) => {
      resolve({ success: false, error: `Spawn error: ${err.message}` });
    });
    setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: "Timeout" });
    }, 3e4);
  });
}
async function generateBatchAudio(entries, options, progressCallback) {
  const {
    voice = DEFAULT_VOICE,
    rate = DEFAULT_RATE,
    volume = DEFAULT_VOLUME,
    outputFormat = "wav",
    outputDir,
    maxConcurrent = 5
  } = options;
  if (!outputDir) {
    return {
      success: false,
      audioFiles: [],
      totalGenerated: 0,
      totalFailed: entries.length,
      outputDir: "",
      errors: ["outputDir is required"]
    };
  }
  console.log(`[TTS] Bắt đầu tạo ${entries.length} audio files`);
  console.log(`[TTS] Voice: ${voice}, Rate: ${rate}, Format: ${outputFormat}`);
  await fs__namespace$1.mkdir(outputDir, { recursive: true });
  const audioFiles = [];
  const errors = [];
  let completed = 0;
  for (let i = 0; i < entries.length; i += maxConcurrent) {
    const batch = entries.slice(i, i + maxConcurrent);
    const batchPromises = batch.map(async (entry, batchIdx) => {
      const text = entry.translatedText || entry.text;
      const filename = getSafeFilename(entry.index, text, outputFormat);
      const outputPath = path__namespace.join(outputDir, filename);
      try {
        const stats = await fs__namespace$1.stat(outputPath);
        if (stats.size > 0) {
          console.log(`[TTS] Skip (existed): ${filename}`);
          return {
            index: entry.index,
            path: outputPath,
            startMs: entry.startMs,
            durationMs: entry.durationMs,
            success: true
          };
        }
      } catch {
      }
      const result = await generateSingleAudio(text, outputPath, voice, rate, volume);
      completed++;
      if (progressCallback) {
        progressCallback({
          current: completed,
          total: entries.length,
          status: "generating",
          currentFile: filename,
          message: result.success ? `Đã tạo: ${filename}` : `Lỗi: ${filename}`
        });
      }
      if (result.success) {
        return {
          index: entry.index,
          path: outputPath,
          startMs: entry.startMs,
          durationMs: entry.durationMs,
          success: true
        };
      } else {
        errors.push(`${filename}: ${result.error}`);
        return {
          index: entry.index,
          path: outputPath,
          startMs: entry.startMs,
          durationMs: entry.durationMs,
          success: false,
          error: result.error
        };
      }
    });
    const batchResults = await Promise.all(batchPromises);
    audioFiles.push(...batchResults);
    if (i + maxConcurrent < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  audioFiles.sort((a, b) => a.startMs - b.startMs);
  const totalGenerated = audioFiles.filter((f) => f.success).length;
  const totalFailed = audioFiles.filter((f) => !f.success).length;
  console.log(`[TTS] Hoàn thành: ${totalGenerated} thành công, ${totalFailed} lỗi`);
  if (progressCallback) {
    progressCallback({
      current: entries.length,
      total: entries.length,
      status: "completed",
      currentFile: "",
      message: `Hoàn thành: ${totalGenerated}/${entries.length} files`
    });
  }
  return {
    success: totalFailed === 0,
    audioFiles,
    totalGenerated,
    totalFailed,
    outputDir,
    errors: errors.length > 0 ? errors : void 0
  };
}
async function getAudioDuration(audioPath) {
  return new Promise((resolve) => {
    const proc = child_process.spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath
    ], {
      windowsHide: true,
      shell: true
    });
    let stdout = "";
    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    proc.on("close", () => {
      const duration = parseFloat(stdout.trim());
      if (!isNaN(duration)) {
        resolve(Math.round(duration * 1e3));
      } else {
        resolve(0);
      }
    });
    proc.on("error", () => {
      resolve(0);
    });
  });
}
const BATCH_SIZE = 32;
async function analyzeAudioFiles(audioFiles, srtDuration) {
  console.log(`[AudioMerger] Phân tích ${audioFiles.length} audio files`);
  const segments = [];
  let maxOverflowRatio = 1;
  let overflowCount = 0;
  for (const file of audioFiles) {
    if (!file.success) continue;
    const actualDuration = await getAudioDuration(file.path);
    const overflow = actualDuration - file.durationMs;
    const overflowPercent = file.durationMs > 0 ? overflow / file.durationMs * 100 : 0;
    const segment = {
      index: file.index,
      audioPath: file.path,
      srtStartMs: file.startMs,
      srtEndMs: file.startMs + file.durationMs,
      srtDurationMs: file.durationMs,
      actualDurationMs: actualDuration,
      overflowMs: overflow,
      overflowPercent
    };
    segments.push(segment);
    if (overflow > 0) {
      overflowCount++;
      const ratio = actualDuration / file.durationMs;
      if (ratio > maxOverflowRatio) {
        maxOverflowRatio = ratio;
      }
    }
  }
  const recommendedScale = maxOverflowRatio > 1 ? Math.min(maxOverflowRatio * 1.05, 1.4) : 1;
  const analysis = {
    totalSegments: segments.length,
    overflowSegments: overflowCount,
    maxOverflowRatio,
    recommendedTimeScale: recommendedScale,
    originalDurationMs: srtDuration,
    adjustedDurationMs: Math.round(srtDuration * recommendedScale),
    segments
  };
  console.log(`[AudioMerger] Phân tích xong: ${overflowCount} segments vượt thời gian`);
  console.log(`[AudioMerger] Scale đề xuất: ${recommendedScale.toFixed(2)}x`);
  return analysis;
}
async function mergeSmallBatch(files, outputPath) {
  return new Promise((resolve) => {
    const args = ["-y"];
    const filterParts = [];
    files.forEach((file, idx) => {
      args.push("-i", file.path);
      filterParts.push(`[${idx}:a]adelay=${file.startMs}|${file.startMs}[a${idx}]`);
    });
    const mixInputs = files.map((_, idx) => `[a${idx}]`).join("");
    const filterComplex = filterParts.join(";") + `;${mixInputs}amix=inputs=${files.length}:duration=longest:dropout_transition=0:normalize=0[out]`;
    args.push("-filter_complex", filterComplex);
    args.push("-map", "[out]");
    if (outputPath.toLowerCase().endsWith(".wav")) {
      args.push("-c:a", "pcm_s16le");
    } else {
      args.push("-c:a", "libmp3lame", "-b:a", "192k");
    }
    args.push(outputPath);
    const proc = child_process.spawn("ffmpeg", args, {
      windowsHide: true,
      shell: true
    });
    proc.on("close", (code) => {
      resolve(code === 0);
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}
async function mergeAudioFiles(audioFiles, outputPath, timeScale = 1) {
  console.log(`[AudioMerger] Ghép ${audioFiles.length} files, scale: ${timeScale}x`);
  const validFiles = audioFiles.filter((f) => f.success);
  if (validFiles.length === 0) {
    return {
      success: false,
      outputPath,
      error: "Không có file audio hợp lệ để ghép"
    };
  }
  const timeline = validFiles.map((file) => ({
    path: file.path,
    startMs: Math.round(file.startMs * timeScale)
  }));
  timeline.sort((a, b) => a.startMs - b.startMs);
  await fs__namespace$1.mkdir(path__namespace.dirname(outputPath), { recursive: true });
  try {
    if (timeline.length === 1) {
      await fs__namespace$1.copyFile(timeline[0].path, outputPath);
      return { success: true, outputPath };
    }
    const tempFiles = [];
    const outputDir = path__namespace.dirname(outputPath);
    const baseName = path__namespace.basename(outputPath, path__namespace.extname(outputPath));
    const ext = path__namespace.extname(outputPath);
    for (let i = 0; i < timeline.length; i += BATCH_SIZE) {
      const batch = timeline.slice(i, i + BATCH_SIZE);
      const batchIdx = Math.floor(i / BATCH_SIZE);
      console.log(`[AudioMerger] Ghép batch ${batchIdx + 1}/${Math.ceil(timeline.length / BATCH_SIZE)}`);
      const tempPath = path__namespace.join(outputDir, `${baseName}_temp_${batchIdx}${ext}`);
      const success2 = await mergeSmallBatch(batch, tempPath);
      if (!success2) {
        for (const tf of tempFiles) {
          try {
            await fs__namespace$1.unlink(tf);
          } catch {
          }
        }
        return { success: false, outputPath, error: `Lỗi ghép batch ${batchIdx + 1}` };
      }
      tempFiles.push(tempPath);
    }
    if (tempFiles.length === 1) {
      await fs__namespace$1.rename(tempFiles[0], outputPath);
      return { success: true, outputPath };
    }
    console.log(`[AudioMerger] Ghép ${tempFiles.length} batch files...`);
    const finalTimeline = tempFiles.map((p, idx) => ({ path: p, startMs: 0 }));
    const success = await mergeSmallBatch(finalTimeline, outputPath);
    for (const tf of tempFiles) {
      try {
        await fs__namespace$1.unlink(tf);
      } catch {
      }
    }
    if (success) {
      console.log(`[AudioMerger] Ghép thành công: ${outputPath}`);
      return { success: true, outputPath };
    } else {
      return { success: false, outputPath, error: "Lỗi ghép final" };
    }
  } catch (error) {
    console.error(`[AudioMerger] Lỗi:`, error);
    return { success: false, outputPath, error: String(error) };
  }
}
async function trimSilence(inputPath) {
  return new Promise((resolve) => {
    const tempPath = inputPath.replace(/\.(wav|mp3)$/i, "_temp.$1");
    const args = [
      "-y",
      "-i",
      inputPath,
      "-af",
      "silenceremove=start_periods=1:start_threshold=-50dB"
    ];
    if (inputPath.toLowerCase().endsWith(".wav")) {
      args.push("-c:a", "pcm_s16le");
    } else {
      args.push("-c:a", "libmp3lame", "-b:a", "192k");
    }
    args.push(tempPath);
    const proc = child_process.spawn("ffmpeg", args, {
      windowsHide: true,
      shell: true
    });
    proc.on("close", async (code) => {
      if (code === 0) {
        try {
          await fs__namespace$1.unlink(inputPath);
          await fs__namespace$1.rename(tempPath, inputPath);
          resolve(true);
        } catch {
          resolve(false);
        }
      } else {
        try {
          await fs__namespace$1.unlink(tempPath);
        } catch {
        }
        resolve(false);
      }
    });
    proc.on("error", () => {
      resolve(false);
    });
  });
}
function registerTTSHandlers() {
  console.log("[TTSHandlers] Đăng ký handlers...");
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_GET_VOICES,
    async () => {
      console.log("[TTSHandlers] Get voices");
      return { success: true, data: VIETNAMESE_VOICES };
    }
  );
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_GENERATE,
    async (event, entries, options) => {
      console.log(`[TTSHandlers] Generate TTS: ${entries.length} entries`);
      try {
        const progressCallback = (progress) => {
          const window = electron.BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send(CAPTION_IPC_CHANNELS.TTS_PROGRESS, progress);
          }
        };
        const result = await generateBatchAudio(entries, options, progressCallback);
        return { success: result.success, data: result, error: result.errors?.join(", ") };
      } catch (error) {
        console.error("[TTSHandlers] Lỗi generate TTS:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.AUDIO_ANALYZE,
    async (_event, audioFiles, srtDuration) => {
      console.log(`[TTSHandlers] Analyze audio: ${audioFiles.length} files`);
      try {
        const analysis = await analyzeAudioFiles(audioFiles, srtDuration);
        return { success: true, data: analysis };
      } catch (error) {
        console.error("[TTSHandlers] Lỗi analyze audio:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.AUDIO_MERGE,
    async (event, audioFiles, outputPath, timeScale = 1) => {
      console.log(`[TTSHandlers] Merge audio: ${audioFiles.length} files -> ${outputPath}`);
      try {
        const result = await mergeAudioFiles(audioFiles, outputPath, timeScale);
        return { success: result.success, data: result, error: result.error };
      } catch (error) {
        console.error("[TTSHandlers] Lỗi merge audio:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    CAPTION_IPC_CHANNELS.TTS_TRIM_SILENCE,
    async (_event, audioPaths) => {
      console.log(`[TTSHandlers] Trim silence: ${audioPaths.length} files`);
      try {
        let trimmedCount = 0;
        let failedCount = 0;
        const errors = [];
        for (const audioPath of audioPaths) {
          const success = await trimSilence(audioPath);
          if (success) {
            trimmedCount++;
          } else {
            failedCount++;
            errors.push(`Không thể trim: ${audioPath}`);
          }
        }
        const result = {
          success: failedCount === 0,
          trimmedCount,
          failedCount,
          errors: errors.length > 0 ? errors : void 0
        };
        return { success: result.success, data: result, error: result.errors?.join(", ") };
      } catch (error) {
        console.error("[TTSHandlers] Lỗi trim silence:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  console.log("[TTSHandlers] Đã đăng ký handlers thành công");
}
async function parseStoryFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".epub") {
      return await parseEpubFile(filePath);
    } else {
      return await parseTxtFile(filePath);
    }
  } catch (error) {
    console.error("Error parsing story file:", error);
    return { success: false, error: String(error) };
  }
}
const EPub = require("epub");
async function parseEpubFile(filePath) {
  return new Promise((resolve) => {
    const epub = new EPub(filePath);
    epub.on("error", (err) => {
      resolve({ success: false, error: String(err) });
    });
    epub.on("end", async () => {
      try {
        const chapters = [];
        const getChapterText = (id) => {
          return new Promise((res, rej) => {
            epub.getChapter(id, (err, text) => {
              if (err) rej(err);
              else res(text);
            });
          });
        };
        let pIndex = 1;
        for (const chapterRef of epub.flow) {
          if (!chapterRef.id) continue;
          try {
            const html = await getChapterText(chapterRef.id);
            let text = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
            text = text.replace(/\n\s*\n/g, "\n\n").trim();
            if (!text) continue;
            chapters.push({
              id: String(pIndex++),
              title: chapterRef.title || `Chapter ${pIndex}`,
              content: text
            });
          } catch (e) {
            console.error(`Failed to load chapter ${chapterRef.id}:`, e);
          }
        }
        resolve({ success: true, chapters });
      } catch (e) {
        resolve({ success: false, error: String(e) });
      }
    });
    epub.parse();
  });
}
async function parseTxtFile(filePath) {
  const fileContent = await fs$1.readFile(filePath, "utf-8");
  const chapters = [];
  const chapterRegex = /===\s*(.*?)\s*===/g;
  let match;
  const matches = [];
  while ((match = chapterRegex.exec(fileContent)) !== null) {
    matches.push({
      title: match[1].trim(),
      index: match.index,
      length: match[0].length
    });
  }
  if (matches.length === 0) {
    chapters.push({
      id: "1",
      title: "Toàn bộ nội dung",
      content: fileContent
    });
    return { success: true, chapters };
  }
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextMatch = matches[i + 1];
    const contentStart = currentMatch.index + currentMatch.length;
    const contentEnd = nextMatch ? nextMatch.index : fileContent.length;
    const content = fileContent.slice(contentStart, contentEnd).trim();
    chapters.push({
      id: String(i + 1),
      title: currentMatch.title,
      content
    });
  }
  return { success: true, chapters };
}
let db = null;
function getDatabase() {
  if (!db) {
    if (electron.app) {
      const userDataPath = electron.app.getPath("userData");
      const dbPath = path.join(userDataPath, "nauchaoheo.db");
      console.log("[Database] Path:", dbPath);
      db = new Database(dbPath);
    } else {
      throw new Error("Database not initialized and app is not ready");
    }
  }
  return db;
}
function initDatabase() {
  const userDataPath = electron.app.getPath("userData");
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  const dbPath = path.join(userDataPath, "nauchaoheo.db");
  console.log("[Database] Initializing at:", dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source_lang TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_chat_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'default',
      cookie TEXT NOT NULL,
      bl_label TEXT,
      f_sid TEXT,
      at_token TEXT,
      conv_id TEXT,
      resp_id TEXT,
      cand_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  console.log("[Database] Schema initialized (prompts, gemini_chat_config)");
}
class PromptService {
  static getAll() {
    const db2 = getDatabase();
    const rows = db2.prepare("SELECT * FROM prompts ORDER BY created_at DESC").all();
    return rows.map(this.mapRow);
  }
  static getById(id) {
    const db2 = getDatabase();
    const row = db2.prepare("SELECT * FROM prompts WHERE id = ?").get(id);
    if (!row) return null;
    return this.mapRow(row);
  }
  static create(data) {
    const db2 = getDatabase();
    const now = Date.now();
    const prompt = {
      id: uuid.v4(),
      ...data,
      isDefault: data.isDefault || false,
      createdAt: now,
      updatedAt: now
    };
    const transaction = db2.transaction(() => {
      if (prompt.isDefault) {
        db2.prepare(`
                UPDATE prompts 
                SET is_default = 0 
                WHERE source_lang = ? AND target_lang = ?
            `).run(prompt.sourceLang, prompt.targetLang);
      }
      db2.prepare(`
          INSERT INTO prompts (id, name, description, source_lang, target_lang, content, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
        prompt.id,
        prompt.name,
        prompt.description || null,
        prompt.sourceLang,
        prompt.targetLang,
        prompt.content,
        prompt.isDefault ? 1 : 0,
        prompt.createdAt,
        prompt.updatedAt
      );
    });
    transaction();
    return prompt;
  }
  static update(id, data) {
    const db2 = getDatabase();
    const existing = this.getById(id);
    if (!existing) throw new Error(`Prompt with id ${id} not found`);
    const updated = {
      ...existing,
      ...data,
      updatedAt: Date.now()
    };
    const transaction = db2.transaction(() => {
      if (updated.isDefault && !existing.isDefault) {
        db2.prepare(`
                  UPDATE prompts 
                  SET is_default = 0 
                  WHERE source_lang = ? AND target_lang = ?
              `).run(updated.sourceLang, updated.targetLang);
      }
      db2.prepare(`
            UPDATE prompts 
            SET name = ?, description = ?, source_lang = ?, target_lang = ?, content = ?, is_default = ?, updated_at = ?
            WHERE id = ?
          `).run(
        updated.name,
        updated.description || null,
        updated.sourceLang,
        updated.targetLang,
        updated.content,
        updated.isDefault ? 1 : 0,
        updated.updatedAt,
        id
      );
    });
    transaction();
    return updated;
  }
  static delete(id) {
    const db2 = getDatabase();
    const result = db2.prepare("DELETE FROM prompts WHERE id = ?").run(id);
    return result.changes > 0;
  }
  static setDefault(id) {
    const prompt = this.getById(id);
    if (!prompt) return false;
    const db2 = getDatabase();
    const transaction = db2.transaction(() => {
      db2.prepare(`
              UPDATE prompts 
              SET is_default = 0 
              WHERE source_lang = ? AND target_lang = ?
          `).run(prompt.sourceLang, prompt.targetLang);
      db2.prepare("UPDATE prompts SET is_default = 1 WHERE id = ?").run(id);
    });
    transaction();
    return true;
  }
  static mapRow(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sourceLang: row.source_lang,
      targetLang: row.target_lang,
      content: row.content,
      isDefault: Boolean(row.is_default),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
const F_SID = "7493167831294892309";
const BL_LABEL = "boq_assistant-bard-web-server_20260121.00_p1";
const HL_LANG = "vi";
class GeminiChatServiceClass {
  // Lay tat ca cau hinh
  getAll() {
    const db2 = getDatabase();
    try {
      const rows = db2.prepare("SELECT * FROM gemini_chat_config ORDER BY updated_at DESC").all();
      return rows.map(this.mapRow);
    } catch (e) {
      console.error("Error get all", e);
      return [];
    }
  }
  // Lay cau hinh dang active
  getActive() {
    const db2 = getDatabase();
    try {
      const row = db2.prepare("SELECT * FROM gemini_chat_config WHERE is_active = 1 LIMIT 1").get();
      return row ? this.mapRow(row) : null;
    } catch (e) {
      return null;
    }
  }
  // Lay cau hinh theo ID
  getById(id) {
    const db2 = getDatabase();
    try {
      const row = db2.prepare("SELECT * FROM gemini_chat_config WHERE id = ?").get(id);
      return row ? this.mapRow(row) : null;
    } catch (e) {
      return null;
    }
  }
  // Tao moi cau hinh
  create(data) {
    const db2 = getDatabase();
    const now = Date.now();
    const id = uuid.v4();
    try {
      db2.prepare("UPDATE gemini_chat_config SET is_active = 0").run();
      db2.prepare(`
        INSERT INTO gemini_chat_config (
            id, name, cookie, bl_label, f_sid, at_token, 
            conv_id, resp_id, cand_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
        id,
        data.name || "default",
        data.cookie,
        data.blLabel || "",
        data.fSid || "",
        data.atToken || "",
        data.convId || "",
        data.respId || "",
        data.candId || "",
        now,
        now
      );
    } catch (e) {
      console.error("Error creating", e);
      throw e;
    }
    console.log("[GeminiChatService] Da tao cau hinh moi:", id);
    return this.getById(id);
  }
  // Cap nhat cau hinh
  // Cap nhat cau hinh
  update(id, data) {
    const db2 = getDatabase();
    const existing = this.getById(id);
    if (!existing) {
      console.error("[GeminiChatService] Khong tim thay cau hinh:", id);
      return null;
    }
    const now = Date.now();
    const updates = ["updated_at = @updated_at"];
    const params = { updated_at: now, id };
    if (data.name !== void 0) {
      updates.push("name = @name");
      params.name = data.name;
    }
    if (data.cookie !== void 0) {
      updates.push("cookie = @cookie");
      params.cookie = data.cookie;
    }
    if (data.blLabel !== void 0) {
      updates.push("bl_label = @blLabel");
      params.blLabel = data.blLabel;
    }
    if (data.fSid !== void 0) {
      updates.push("f_sid = @fSid");
      params.fSid = data.fSid;
    }
    if (data.atToken !== void 0) {
      updates.push("at_token = @atToken");
      params.atToken = data.atToken;
    }
    if (data.convId !== void 0) {
      updates.push("conv_id = @convId");
      params.convId = data.convId;
    }
    if (data.respId !== void 0) {
      updates.push("resp_id = @respId");
      params.respId = data.respId;
    }
    if (data.candId !== void 0) {
      updates.push("cand_id = @candId");
      params.candId = data.candId;
    }
    if (data.isActive !== void 0) {
      if (data.isActive) {
        db2.prepare("UPDATE gemini_chat_config SET is_active = 0").run();
      }
      updates.push("is_active = @isActive");
      params.isActive = data.isActive ? 1 : 0;
    }
    const sql = `UPDATE gemini_chat_config SET ${updates.join(", ")} WHERE id = @id`;
    try {
      db2.prepare(sql).run(params);
    } catch (e) {
      console.error("[GeminiChatService] Update Failed:", e);
      throw e;
    }
    return this.getById(id);
  }
  // Xoa cau hinh
  delete(id) {
    const db2 = getDatabase();
    const result = db2.prepare("DELETE FROM gemini_chat_config WHERE id = ?").run(id);
    return result.changes > 0;
  }
  // Map row tu database sang object
  mapRow(row) {
    return {
      id: row.id,
      name: row.name,
      cookie: row.cookie,
      blLabel: row.bl_label,
      fSid: row.f_sid,
      atToken: row.at_token,
      convId: row.conv_id,
      respId: row.resp_id,
      candId: row.cand_id,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  static {
    this.reqIdCounter = 21477148;
  }
  async sendMessage(message, configId, context) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2e3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[GeminiChatService] Sending message (Attempt ${attempt}/${MAX_RETRIES})...`);
      const result = await this._sendMessageInternal(message, configId, context);
      if (result.success) {
        return result;
      }
      if (attempt < MAX_RETRIES) {
        console.log(`[GeminiChatService] Request failed, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error(`[GeminiChatService] All ${MAX_RETRIES} attempts failed.`);
        return result;
      }
    }
    return { success: false, error: "Unexpected error in retry loop" };
  }
  async _sendMessageInternal(message, configId, context) {
    const config = this.getById(configId);
    if (!config) {
      return { success: false, error: `Config not found: ${configId}` };
    }
    const { cookie, blLabel: configBlLabel, fSid: configFSid, atToken } = config;
    const blLabel = configBlLabel || BL_LABEL;
    const fSid = configFSid || F_SID;
    if (!configBlLabel || !configFSid) {
      console.log("[GeminiChatService] Using fallback values for blLabel/fSid");
    }
    const hl = HL_LANG;
    GeminiChatServiceClass.reqIdCounter += 100;
    const reqId = String(GeminiChatServiceClass.reqIdCounter);
    let contextArray = ["", "", ""];
    if (context) {
      contextArray = [context.conversationId, context.responseId, context.choiceId];
      console.log("[GeminiChatService] Using context:", contextArray);
    }
    const innerPayload = [
      [message],
      null,
      contextArray
    ];
    const fReq = JSON.stringify([null, JSON.stringify(innerPayload)]);
    const baseUrl = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
    const params = new URLSearchParams({
      "bl": blLabel,
      "_reqid": reqId,
      "rt": "c",
      "f.sid": fSid,
      "hl": hl
    });
    const url = `${baseUrl}?${params.toString()}`;
    const body = new URLSearchParams({
      "f.req": fReq,
      "at": atToken
    });
    try {
      console.log("[GeminiChatService] Fetching:", url);
      console.log("[GeminiChatService] >>> fetch START");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Host": "gemini.google.com",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Origin": "https://gemini.google.com",
          "Referer": "https://gemini.google.com/",
          "Cookie": cookie
        },
        body: body.toString()
      });
      console.log("[GeminiChatService] >>> fetch END, status:", response.status);
      if (!response.ok) {
        const txt = await response.text();
        console.error("[GeminiChatService] Gemini Error:", response.status, txt.substring(0, 200));
        return { success: false, error: `HTTP ${response.status}` };
      }
      console.log("[GeminiChatService] >>> Reading response text...");
      const responseText = await response.text();
      console.log("[GeminiChatService] >>> Response text length:", responseText.length);
      if (responseText.length < 500) {
        console.warn("[GeminiChatService] >>> Small response (possible error):", responseText);
      }
      const lines = responseText.split("\n");
      let foundText = "";
      let newContext = { conversationId: "", responseId: "", choiceId: "" };
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          let jsonPart = trimmed;
          if (/^\d+$/.test(jsonPart)) continue;
          const dataObj = JSON.parse(jsonPart);
          if (Array.isArray(dataObj) && dataObj.length > 0) {
            const payloadItem = dataObj[0];
            if (Array.isArray(payloadItem) && payloadItem.length > 2 && payloadItem[2]) {
              if (typeof payloadItem[2] === "string") {
                const innerData = JSON.parse(payloadItem[2]);
                if (Array.isArray(innerData) && innerData.length >= 5) {
                  if (innerData[1]) {
                    const idString = String(innerData[1]);
                    if (idString.includes(",")) {
                      const parts = idString.split(",");
                      newContext.conversationId = parts[0] || "";
                      newContext.responseId = parts[1] || "";
                    } else {
                      newContext.conversationId = idString;
                    }
                  }
                  if (!newContext.responseId && innerData[11]) {
                    newContext.responseId = String(innerData[11]);
                  }
                  if (!newContext.responseId && innerData[3]) {
                    newContext.responseId = String(innerData[3]);
                  }
                  const candidates = innerData[4];
                  if (Array.isArray(candidates) && candidates.length > 0) {
                    const candidate = candidates[0];
                    if (candidate && candidate.length > 1 && candidate[1] && candidate[1].length > 0) {
                      const txt = candidate[1][0];
                      if (txt) {
                        foundText = txt;
                      }
                      if (candidate[0]) newContext.choiceId = String(candidate[0]);
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
        }
      }
      if (foundText) {
        if (!newContext.conversationId && context) newContext.conversationId = context.conversationId;
        if (!newContext.responseId && context) newContext.responseId = context.responseId;
        if (!newContext.choiceId && context) newContext.choiceId = context.choiceId;
        console.log(`[GeminiChatService] Received response (${foundText.length} chars)`);
        console.log("[GeminiChatService] Parsed context:", newContext);
        return {
          success: true,
          data: {
            text: foundText,
            context: newContext
          }
        };
      } else {
        console.error("[GeminiChatService] No text found in response!");
        return { success: false, error: "No text found in response" };
      }
    } catch (error) {
      console.error("[GeminiChatService] Fetch Error:", error);
      return { success: false, error: String(error) };
    }
  }
}
const GeminiChatService = new GeminiChatServiceClass();
class StoryService {
  /**
   * Translates a chapter using prepared prompt and Gemini API
   */
  static async translateChapter(options) {
    try {
      console.log("[StoryService] Starting translation...", options.method || "API");
      if (options.method === "WEB") {
        if (!options.webConfigId) {
          return { success: false, error: "Web Config ID is required for WEB method" };
        }
        let promptText = "";
        const preparedPrompt = options.prompt;
        if (typeof preparedPrompt === "string") {
          promptText = preparedPrompt;
        } else if (Array.isArray(preparedPrompt)) {
          const lastUserMsg = [...preparedPrompt].reverse().find((m) => m.role === "user");
          if (lastUserMsg) promptText = lastUserMsg.content;
        } else if (typeof preparedPrompt === "object") {
          promptText = JSON.stringify(preparedPrompt);
          if (Array.isArray(preparedPrompt)) {
            const lastMsg = preparedPrompt[preparedPrompt.length - 1];
            if (lastMsg && lastMsg.role === "user") promptText = lastMsg.content;
            else promptText = JSON.stringify(preparedPrompt);
          }
        }
        console.log("[StoryService] Extracted promptText length:", promptText.length);
        if (!promptText) console.warn("[StoryService] promptText is empty!");
        const result = await GeminiChatService.sendMessage(promptText, options.webConfigId, options.context);
        if (result.success && result.data) {
          console.log("[StoryService] Translation completed.");
          return {
            success: true,
            data: result.data.text,
            context: result.data.context
            // Return new context
          };
        } else {
          return { success: false, error: result.error || "Gemini Web Error" };
        }
      } else {
        const result = await callGeminiWithRotation(
          options.prompt,
          GEMINI_MODELS.FLASH_3_0
        );
        if (result.success) {
          return { success: true, data: result.data };
        } else {
          return { success: false, error: result.error };
        }
      }
    } catch (error) {
      console.error("[StoryService] Error translating chapter:", error);
      return { success: false, error: String(error) };
    }
  }
  /**
   * Prepares the translation prompt by fetching the appropriate prompt from the database
   * and injecting the chapter content.
   */
  static async prepareTranslationPrompt(chapterContent, sourceLang, targetLang) {
    try {
      const prompts = PromptService.getAll();
      const matchingPrompt = prompts.find(
        (p) => p.sourceLang === sourceLang && p.targetLang === targetLang && p.isDefault
      ) || prompts.find(
        (p) => p.sourceLang === sourceLang && p.targetLang === targetLang
      );
      if (!matchingPrompt) {
        return {
          success: false,
          error: `No translation prompt found for ${sourceLang} -> ${targetLang}`
        };
      }
      let promptData;
      try {
        promptData = JSON.parse(matchingPrompt.content);
      } catch (e) {
        return { success: false, error: "Invalid prompt content format (not valid JSON)" };
      }
      const injectContent = (obj) => {
        if (typeof obj === "string") {
          if (obj === "{{text}}" || obj === "{{TEXT_TRUYEN_TRUNG_QUOC}}" || obj === "{{input}}") {
            return chapterContent.split(/\r?\n/).filter((line) => line.trim() !== "");
          }
          let newStr = obj;
          if (newStr.includes("{{text}}")) newStr = newStr.replace("{{text}}", chapterContent);
          if (newStr.includes("{{TEXT_TRUYEN_TRUNG_QUOC}}")) newStr = newStr.replace("{{TEXT_TRUYEN_TRUNG_QUOC}}", chapterContent);
          if (newStr.includes("{{input}}")) newStr = newStr.replace("{{input}}", chapterContent);
          return newStr;
        }
        if (Array.isArray(obj)) {
          return obj.map((item) => injectContent(item));
        }
        if (typeof obj === "object" && obj !== null) {
          const result = {};
          for (const key in obj) {
            result[key] = injectContent(obj[key]);
          }
          return result;
        }
        return obj;
      };
      if (Array.isArray(promptData)) {
        let contentInjected = false;
        const preparedMessages = promptData.map((msg) => {
          if (msg.role === "user" && typeof msg.content === "string") {
            const originalContent = msg.content;
            const newContent = injectContent(msg.content);
            if (originalContent !== newContent) {
              contentInjected = true;
            }
            return { ...msg, content: newContent };
          }
          return msg;
        });
        if (!contentInjected) {
          let lastUserMsgIndex = -1;
          for (let i = preparedMessages.length - 1; i >= 0; i--) {
            if (preparedMessages[i].role === "user") {
              lastUserMsgIndex = i;
              break;
            }
          }
          if (lastUserMsgIndex !== -1) {
            preparedMessages[lastUserMsgIndex].content += "\n\n" + chapterContent;
          } else {
            preparedMessages.push({ role: "user", content: chapterContent });
          }
        }
        return { success: true, prompt: preparedMessages };
      } else if (typeof promptData === "object" && promptData !== null) {
        const preparedPrompt = injectContent(promptData);
        return { success: true, prompt: preparedPrompt };
      }
      return { success: false, error: "Prompt content must be a JSON array or object" };
    } catch (error) {
      console.error("Error preparing translation prompt:", error);
      return { success: false, error: String(error) };
    }
  }
  static async createEbook(options) {
    try {
      const nodepub = require("nodepub");
      const path2 = require("path");
      const os = require("os");
      const fs2 = require("fs");
      const { chapters, title, author, outputDir, filename, cover } = options;
      const downloadDir = outputDir || path2.join(os.homedir(), "Downloads");
      const safeTitle = (filename || title).replace(/[^a-z0-9]/gi, "_").toLowerCase();
      const metadata = {
        id: safeTitle,
        title,
        author: author || "AI Translator",
        cover
      };
      const epub = nodepub.document(metadata);
      for (const chapter of chapters) {
        const htmlContent = chapter.content.replace(/\n/g, "<br/>").replace(/  /g, "&nbsp;&nbsp;");
        epub.addSection(chapter.title, htmlContent);
      }
      const finalPath = path2.join(downloadDir, `${safeTitle}.epub`);
      return new Promise(async (resolve) => {
        try {
          await epub.writeEPUB(downloadDir, safeTitle);
          resolve({ success: true, filePath: finalPath });
        } catch (e) {
          resolve({ success: false, error: String(e) });
        }
      });
    } catch (error) {
      console.error("[StoryService] Error creating ebook:", error);
      return { success: false, error: String(error) };
    }
  }
}
const STORY_IPC_CHANNELS = {
  PARSE: "story:parse",
  PREPARE_PROMPT: "story:preparePrompt",
  SAVE_PROMPT: "story:savePrompt",
  TRANSLATE_CHAPTER: "story:translateChapter",
  CREATE_EBOOK: "story:createEbook"
};
const PROMPT_IPC_CHANNELS = {
  GET_ALL: "prompt:getAll",
  GET_BY_ID: "prompt:getById",
  CREATE: "prompt:create",
  UPDATE: "prompt:update",
  DELETE: "prompt:delete",
  SET_DEFAULT: "prompt:setDefault"
};
function registerStoryHandlers() {
  console.log("[StoryHandlers] Đăng ký handlers...");
  electron.ipcMain.handle(
    STORY_IPC_CHANNELS.PARSE,
    async (_event, filePath) => {
      console.log(`[StoryHandlers] Parse story: ${filePath}`);
      return await parseStoryFile(filePath);
    }
  );
  electron.ipcMain.handle(
    STORY_IPC_CHANNELS.PREPARE_PROMPT,
    async (_event, { chapterContent, sourceLang, targetLang }) => {
      console.log(`[StoryHandlers] Prepare prompt logic: ${sourceLang} -> ${targetLang}`);
      return await StoryService.prepareTranslationPrompt(chapterContent, sourceLang, targetLang);
    }
  );
  electron.ipcMain.handle(
    STORY_IPC_CHANNELS.SAVE_PROMPT,
    async (_event, content) => {
      console.log("[StoryHandlers] Save prompt to file...");
      const { canceled, filePath } = await electron.dialog.showSaveDialog({
        title: "Lưu Prompt",
        defaultPath: "prompt.txt",
        filters: [{ name: "Text Files", extensions: ["txt"] }]
      });
      if (canceled || !filePath) {
        return { success: false, error: "User canceled" };
      }
      try {
        await fs__namespace$1.writeFile(filePath, content, "utf-8");
        return { success: true, filePath };
      } catch (error) {
        console.error("Error saving file:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    STORY_IPC_CHANNELS.TRANSLATE_CHAPTER,
    async (_event, payload) => {
      let options = payload;
      if (!payload.prompt && (Array.isArray(payload) || payload.role)) {
        options = { prompt: payload, method: "API" };
      }
      return await StoryService.translateChapter(options);
    }
  );
  electron.ipcMain.handle(
    STORY_IPC_CHANNELS.CREATE_EBOOK,
    async (_event, options) => {
      console.log("[StoryHandlers] Create ebook:", options.title);
      return await StoryService.createEbook(options);
    }
  );
  console.log("[StoryHandlers] Đã đăng ký handlers thành công");
}
function registerPromptHandlers() {
  console.log("[PromptHandlers] Đăng ký handlers...");
  electron.ipcMain.handle(PROMPT_IPC_CHANNELS.GET_ALL, async () => {
    return PromptService.getAll();
  });
  electron.ipcMain.handle(PROMPT_IPC_CHANNELS.GET_BY_ID, async (_event, id) => {
    return PromptService.getById(id);
  });
  electron.ipcMain.handle(PROMPT_IPC_CHANNELS.CREATE, async (_event, data) => {
    return PromptService.create(data);
  });
  electron.ipcMain.handle(PROMPT_IPC_CHANNELS.UPDATE, async (_event, { id, ...data }) => {
    return PromptService.update(id, data);
  });
  electron.ipcMain.handle(PROMPT_IPC_CHANNELS.DELETE, async (_event, id) => {
    return PromptService.delete(id);
  });
  electron.ipcMain.handle(PROMPT_IPC_CHANNELS.SET_DEFAULT, async (_event, id) => {
    return PromptService.setDefault(id);
  });
  console.log("[PromptHandlers] Đã đăng ký handlers thành công");
}
const DEFAULT_SETTINGS = {
  projectsBasePath: null,
  theme: "dark",
  language: "vi",
  recentProjectIds: [],
  lastActiveProjectId: null
};
class AppSettingsServiceClass {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.settingsPath = "";
  }
  /**
   * Initialize the service - must be called after app is ready
   */
  initialize() {
    const userDataPath = electron.app.getPath("userData");
    this.settingsPath = path__namespace.join(userDataPath, "appSettings.json");
    this.load();
    console.log("[AppSettings] Initialized at:", this.settingsPath);
  }
  /**
   * Load settings from file
   */
  load() {
    try {
      if (fs__namespace.existsSync(this.settingsPath)) {
        const content = fs__namespace.readFileSync(this.settingsPath, "utf-8");
        const loaded = JSON.parse(content);
        this.settings = { ...DEFAULT_SETTINGS, ...loaded };
        console.log("[AppSettings] Loaded settings successfully");
      } else {
        console.log("[AppSettings] No settings file found, using defaults");
        this.settings = { ...DEFAULT_SETTINGS };
      }
    } catch (error) {
      console.error("[AppSettings] Error loading settings:", error);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }
  /**
   * Save settings to file
   */
  save() {
    try {
      fs__namespace.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), "utf-8");
      console.log("[AppSettings] Saved settings");
    } catch (error) {
      console.error("[AppSettings] Error saving settings:", error);
    }
  }
  /**
   * Get all settings
   */
  getAll() {
    return { ...this.settings };
  }
  /**
   * Update settings (partial update)
   */
  update(partial) {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.getAll();
  }
  /**
   * Get projects base path (returns custom path + NauChapHeoContent or default)
   * Projects will be stored in: [selectedPath]/NauChapHeoContent/
   */
  getProjectsBasePath() {
    if (this.settings.projectsBasePath) {
      return path__namespace.join(this.settings.projectsBasePath, "NauChapHeoContent");
    }
    return path__namespace.join(electron.app.getPath("userData"), "projects");
  }
  /**
   * Set projects base path and create NauChapHeoContent folder
   */
  setProjectsBasePath(basePath) {
    this.settings.projectsBasePath = basePath;
    this.save();
    if (basePath) {
      const fullPath = path__namespace.join(basePath, "NauChapHeoContent");
      if (!fs__namespace.existsSync(fullPath)) {
        fs__namespace.mkdirSync(fullPath, { recursive: true });
        console.log("[AppSettings] Created NauChapHeoContent folder:", fullPath);
      }
    }
  }
  /**
   * Add project to recent list
   */
  addRecentProject(projectId) {
    this.settings.recentProjectIds = this.settings.recentProjectIds.filter((id) => id !== projectId);
    this.settings.recentProjectIds.unshift(projectId);
    this.settings.recentProjectIds = this.settings.recentProjectIds.slice(0, 5);
    this.settings.lastActiveProjectId = projectId;
    this.save();
  }
  /**
   * Get last active project ID
   */
  getLastActiveProjectId() {
    return this.settings.lastActiveProjectId;
  }
  /**
   * Get recent project IDs
   */
  getRecentProjectIds() {
    return [...this.settings.recentProjectIds];
  }
  /**
   * Clear last active project
   */
  clearLastActiveProject() {
    this.settings.lastActiveProjectId = null;
    this.save();
  }
  /**
   * Remove project from recent list (when deleted)
   */
  removeFromRecent(projectId) {
    this.settings.recentProjectIds = this.settings.recentProjectIds.filter((id) => id !== projectId);
    if (this.settings.lastActiveProjectId === projectId) {
      this.settings.lastActiveProjectId = null;
    }
    this.save();
  }
}
const AppSettingsService = new AppSettingsServiceClass();
const DEFAULT_PROJECT_SETTINGS = {
  sourceLang: "zh",
  targetLang: "vi",
  geminiModel: "gemini-3-flash-preview",
  autoSave: true
};
const PROJECT_IPC_CHANNELS = {
  // Project CRUD
  GET_ALL: "project:getAll",
  GET_BY_ID: "project:getById",
  CREATE: "project:create",
  UPDATE: "project:update",
  DELETE: "project:delete",
  // Translations
  SAVE_TRANSLATION: "project:saveTranslation",
  GET_TRANSLATIONS: "project:getTranslations",
  GET_TRANSLATION: "project:getTranslation",
  // History
  GET_HISTORY: "project:getHistory"
};
function getProjectsBasePath() {
  return AppSettingsService.getProjectsBasePath();
}
function ensureProjectsFolder() {
  const basePath = getProjectsBasePath();
  if (!fs__namespace.existsSync(basePath)) {
    fs__namespace.mkdirSync(basePath, { recursive: true });
  }
}
function ensureDir(dirPath) {
  if (!fs__namespace.existsSync(dirPath)) {
    fs__namespace.mkdirSync(dirPath, { recursive: true });
  }
}
function getProjectJsonPath(projectFolder) {
  return path__namespace.join(projectFolder, "project.json");
}
function getTranslationsDir(projectFolder) {
  return path__namespace.join(projectFolder, "translations");
}
function getHistoryPath(projectFolder) {
  return path__namespace.join(projectFolder, "history.json");
}
function readJsonFile(filePath) {
  try {
    if (fs__namespace.existsSync(filePath)) {
      const content = fs__namespace.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`[ProjectService] Error reading ${filePath}:`, error);
  }
  return null;
}
function writeJsonFile(filePath, data) {
  try {
    ensureDir(path__namespace.dirname(filePath));
    fs__namespace.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`[ProjectService] Error writing ${filePath}:`, error);
    throw error;
  }
}
class ProjectService {
  /**
   * Get all projects by scanning project folders
   */
  static getAll() {
    try {
      ensureProjectsFolder();
      const basePath = getProjectsBasePath();
      const entries = fs__namespace.readdirSync(basePath, { withFileTypes: true });
      const projects = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectFolder = path__namespace.join(basePath, entry.name);
          const projectJsonPath = getProjectJsonPath(projectFolder);
          const project = readJsonFile(projectJsonPath);
          if (project) {
            projects.push(project);
          }
        }
      }
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      return projects;
    } catch (error) {
      console.error("[ProjectService] Error getting all projects:", error);
      return [];
    }
  }
  /**
   * Get project by ID
   */
  static getById(id) {
    try {
      const basePath = getProjectsBasePath();
      const projectFolder = path__namespace.join(basePath, id);
      const projectJsonPath = getProjectJsonPath(projectFolder);
      return readJsonFile(projectJsonPath);
    } catch (error) {
      console.error(`[ProjectService] Error getting project ${id}:`, error);
      return null;
    }
  }
  /**
   * Create new project
   */
  static create(data) {
    ensureProjectsFolder();
    const now = Date.now();
    const sanitizedName = data.name.trim().replace(/[<>:"/\\|?*]/g, "_").substring(0, 100);
    const id = sanitizedName;
    const basePath = getProjectsBasePath();
    const projectFolder = path__namespace.join(basePath, sanitizedName);
    ensureDir(projectFolder);
    ensureDir(getTranslationsDir(projectFolder));
    const settings = {
      ...DEFAULT_PROJECT_SETTINGS,
      ...data.settings
    };
    const project = {
      id,
      name: data.name,
      sourceFilePath: data.sourceFilePath,
      projectFolderPath: projectFolder,
      settings,
      totalChapters: data.totalChapters || 0,
      translatedChapters: 0,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    writeJsonFile(getProjectJsonPath(projectFolder), project);
    writeJsonFile(getHistoryPath(projectFolder), []);
    this.logAction(id, "created", `Tạo dự án: ${project.name}`);
    console.log(`[ProjectService] Created project: ${project.name} (${id})`);
    return project;
  }
  /**
   * Update project
   */
  static update(id, data) {
    const existing = this.getById(id);
    if (!existing) return null;
    const now = Date.now();
    const updated = {
      ...existing,
      ...data,
      settings: data.settings ? { ...existing.settings, ...data.settings } : existing.settings,
      updatedAt: now
    };
    writeJsonFile(getProjectJsonPath(updated.projectFolderPath), updated);
    if (data.settings) {
      this.logAction(id, "settings_changed", "Cập nhật cài đặt dự án");
    }
    console.log(`[ProjectService] Updated project: ${id}`);
    return updated;
  }
  /**
   * Delete project
   */
  static delete(id) {
    const project = this.getById(id);
    if (!project) return false;
    if (fs__namespace.existsSync(project.projectFolderPath)) {
      fs__namespace.rmSync(project.projectFolderPath, { recursive: true, force: true });
    }
    console.log(`[ProjectService] Deleted project: ${id}`);
    return true;
  }
  // ============================================
  // TRANSLATIONS
  // ============================================
  /**
   * Save chapter translation to JSON file
   */
  static saveTranslation(data) {
    const project = this.getById(data.projectId);
    if (!project) {
      throw new Error(`Project not found: ${data.projectId}`);
    }
    const now = Date.now();
    const translationsDir = getTranslationsDir(project.projectFolderPath);
    ensureDir(translationsDir);
    const translationPath = path__namespace.join(translationsDir, `${data.chapterId}.json`);
    const existing = readJsonFile(translationPath);
    const translation = {
      projectId: data.projectId,
      chapterId: data.chapterId,
      chapterTitle: data.chapterTitle,
      originalContent: data.originalContent,
      translatedContent: data.translatedContent,
      translatedAt: now
    };
    writeJsonFile(translationPath, translation);
    if (!existing) {
      this.updateTranslatedCount(data.projectId);
      this.logAction(data.projectId, "translated", `Dịch chương: ${data.chapterTitle}`);
    }
    console.log(`[ProjectService] Saved translation for chapter: ${data.chapterTitle}`);
    return translation;
  }
  /**
   * Get all translations for a project
   */
  static getTranslations(projectId) {
    const project = this.getById(projectId);
    if (!project) return [];
    const translationsDir = getTranslationsDir(project.projectFolderPath);
    if (!fs__namespace.existsSync(translationsDir)) return [];
    const translations = [];
    const files = fs__namespace.readdirSync(translationsDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path__namespace.join(translationsDir, file);
        const translation = readJsonFile(filePath);
        if (translation) {
          translations.push(translation);
        }
      }
    }
    translations.sort((a, b) => a.translatedAt - b.translatedAt);
    return translations;
  }
  /**
   * Get single translation
   */
  static getTranslation(projectId, chapterId) {
    const project = this.getById(projectId);
    if (!project) return null;
    const translationPath = path__namespace.join(getTranslationsDir(project.projectFolderPath), `${chapterId}.json`);
    return readJsonFile(translationPath);
  }
  /**
   * Update translated count in project
   */
  static updateTranslatedCount(projectId) {
    const project = this.getById(projectId);
    if (!project) return;
    const translations = this.getTranslations(projectId);
    this.update(projectId, {
      translatedChapters: translations.length
    });
  }
  // ============================================
  // HISTORY
  // ============================================
  /**
   * Log action to history.json
   */
  static logAction(projectId, action, details) {
    try {
      const project = this.getById(projectId);
      if (!project) return;
      const historyPath = getHistoryPath(project.projectFolderPath);
      const history = readJsonFile(historyPath) || [];
      const newAction = {
        id: `${action}_${Date.now()}`,
        projectId,
        action,
        details,
        timestamp: Date.now()
      };
      history.push(newAction);
      const trimmed = history.slice(-100);
      writeJsonFile(historyPath, trimmed);
    } catch (error) {
      console.error(`[ProjectService] Error logging action:`, error);
    }
  }
  /**
   * Get project history
   */
  static getHistory(projectId, limit = 50) {
    const project = this.getById(projectId);
    if (!project) return [];
    const historyPath = getHistoryPath(project.projectFolderPath);
    const history = readJsonFile(historyPath) || [];
    return history.slice(-limit).reverse();
  }
}
function registerProjectHandlers() {
  console.log("[ProjectHandlers] Đăng ký handlers...");
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.GET_ALL, async () => {
    try {
      const projects = ProjectService.getAll();
      return { success: true, data: projects };
    } catch (error) {
      console.error("[ProjectHandlers] Error getting projects:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.GET_BY_ID, async (_, id) => {
    try {
      const project = ProjectService.getById(id);
      if (!project) {
        return { success: false, error: "Project not found" };
      }
      return { success: true, data: project };
    } catch (error) {
      console.error("[ProjectHandlers] Error getting project:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.CREATE, async (_, data) => {
    try {
      const project = ProjectService.create(data);
      return { success: true, data: project };
    } catch (error) {
      console.error("[ProjectHandlers] Error creating project:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.UPDATE, async (_, id, data) => {
    try {
      const project = ProjectService.update(id, data);
      if (!project) {
        return { success: false, error: "Project not found" };
      }
      return { success: true, data: project };
    } catch (error) {
      console.error("[ProjectHandlers] Error updating project:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.DELETE, async (_, id) => {
    try {
      const result = ProjectService.delete(id);
      return { success: true, data: result };
    } catch (error) {
      console.error("[ProjectHandlers] Error deleting project:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.SAVE_TRANSLATION, async (_, data) => {
    try {
      const translation = ProjectService.saveTranslation(data);
      return { success: true, data: translation };
    } catch (error) {
      console.error("[ProjectHandlers] Error saving translation:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.GET_TRANSLATIONS, async (_, projectId) => {
    try {
      const translations = ProjectService.getTranslations(projectId);
      return { success: true, data: translations };
    } catch (error) {
      console.error("[ProjectHandlers] Error getting translations:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.GET_TRANSLATION, async (_, projectId, chapterId) => {
    try {
      const translation = ProjectService.getTranslation(projectId, chapterId);
      return { success: true, data: translation };
    } catch (error) {
      console.error("[ProjectHandlers] Error getting translation:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.GET_HISTORY, async (_, projectId, limit) => {
    try {
      const history = ProjectService.getHistory(projectId, limit);
      return { success: true, data: history };
    } catch (error) {
      console.error("[ProjectHandlers] Error getting history:", error);
      return { success: false, error: String(error) };
    }
  });
  console.log("[ProjectHandlers] Đã đăng ký handlers thành công");
}
const APP_SETTINGS_IPC_CHANNELS = {
  GET_ALL: "appSettings:getAll",
  UPDATE: "appSettings:update",
  GET_PROJECTS_BASE_PATH: "appSettings:getProjectsBasePath",
  SET_PROJECTS_BASE_PATH: "appSettings:setProjectsBasePath",
  ADD_RECENT_PROJECT: "appSettings:addRecentProject",
  GET_RECENT_PROJECT_IDS: "appSettings:getRecentProjectIds",
  GET_LAST_ACTIVE_PROJECT_ID: "appSettings:getLastActiveProjectId",
  REMOVE_FROM_RECENT: "appSettings:removeFromRecent"
};
function registerAppSettingsHandlers() {
  console.log("[AppSettingsHandlers] Đăng ký handlers...");
  electron.ipcMain.handle("dialog:openDirectory", async () => {
    console.log("[AppSettingsHandlers] Mở dialog chọn thư mục...");
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return result;
  });
  electron.ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.GET_ALL, async () => {
    try {
      const settings = AppSettingsService.getAll();
      return { success: true, data: settings };
    } catch (error) {
      console.error("[AppSettingsHandlers] Error getting settings:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.UPDATE, async (_, partial) => {
    try {
      const settings = AppSettingsService.update(partial);
      return { success: true, data: settings };
    } catch (error) {
      console.error("[AppSettingsHandlers] Error updating settings:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.GET_PROJECTS_BASE_PATH, async () => {
    try {
      const basePath = AppSettingsService.getProjectsBasePath();
      return { success: true, data: basePath };
    } catch (error) {
      console.error("[AppSettingsHandlers] Error getting projects base path:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.SET_PROJECTS_BASE_PATH, async (_, basePath) => {
    try {
      AppSettingsService.setProjectsBasePath(basePath);
      return { success: true };
    } catch (error) {
      console.error("[AppSettingsHandlers] Error setting projects base path:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.ADD_RECENT_PROJECT, async (_, projectId) => {
    try {
      AppSettingsService.addRecentProject(projectId);
      return { success: true };
    } catch (error) {
      console.error("[AppSettingsHandlers] Error adding recent project:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.GET_RECENT_PROJECT_IDS, async () => {
    try {
      const ids = AppSettingsService.getRecentProjectIds();
      return { success: true, data: ids };
    } catch (error) {
      console.error("[AppSettingsHandlers] Error getting recent projects:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.GET_LAST_ACTIVE_PROJECT_ID, async () => {
    try {
      const id = AppSettingsService.getLastActiveProjectId();
      return { success: true, data: id };
    } catch (error) {
      console.error("[AppSettingsHandlers] Error getting last active project:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(APP_SETTINGS_IPC_CHANNELS.REMOVE_FROM_RECENT, async (_, projectId) => {
    try {
      AppSettingsService.removeFromRecent(projectId);
      return { success: true };
    } catch (error) {
      console.error("[AppSettingsHandlers] Error removing from recent:", error);
      return { success: false, error: String(error) };
    }
  });
  console.log("[AppSettingsHandlers] Đã đăng ký handlers thành công");
}
const CHANNELS = {
  GET_ALL: "geminiChat:getAll",
  GET_ACTIVE: "geminiChat:getActive",
  GET_BY_ID: "geminiChat:getById",
  CREATE: "geminiChat:create",
  UPDATE: "geminiChat:update",
  DELETE: "geminiChat:delete",
  SEND_MESSAGE: "geminiChat:sendMessage"
};
function registerGeminiChatHandlers() {
  console.log("[GeminiChatHandlers] Dang ky handlers...");
  electron.ipcMain.handle(CHANNELS.GET_ALL, async () => {
    try {
      const configs = GeminiChatService.getAll();
      return { success: true, data: configs };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi getAll:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.GET_ACTIVE, async () => {
    try {
      const config = GeminiChatService.getActive();
      return { success: true, data: config };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi getActive:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.GET_BY_ID, async (_, id) => {
    try {
      const config = GeminiChatService.getById(id);
      return { success: true, data: config };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi getById:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.CREATE, async (_, data) => {
    try {
      const config = GeminiChatService.create(data);
      return { success: true, data: config };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi create:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.UPDATE, async (_, id, data) => {
    try {
      const config = GeminiChatService.update(id, data);
      return { success: true, data: config };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi update:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.DELETE, async (_, id) => {
    try {
      const result = GeminiChatService.delete(id);
      return { success: true, data: result };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi delete:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.SEND_MESSAGE, async (_, message, configId, context) => {
    try {
      console.log("[GeminiChatHandlers] sendMessage, configId:", configId, "context:", context);
      const result = await GeminiChatService.sendMessage(message, configId, context);
      return result;
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi sendMessage:", error);
      return { success: false, error: String(error) };
    }
  });
  console.log("[GeminiChatHandlers] Da dang ky handlers thanh cong");
}
function registerAllHandlers() {
  console.log("[IPC] Đang đăng ký tất cả handlers...");
  registerGeminiHandlers();
  registerCaptionHandlers();
  registerTTSHandlers();
  registerStoryHandlers();
  registerPromptHandlers();
  registerProjectHandlers();
  registerAppSettingsHandlers();
  registerGeminiChatHandlers();
  console.log("[IPC] Da dang ky xong tat ca handlers");
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    // Ẩn cho đến khi sẵn sàng
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.veo3promptbuilder");
  initDatabase();
  AppSettingsService.initialize();
  registerAllHandlers();
  tryImportDevKeys();
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
