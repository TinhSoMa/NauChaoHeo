"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const fs = require("fs");
const crypto = require("crypto");
const fs$1 = require("fs/promises");
const child_process = require("child_process");
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
  KEYS_GET_ALL: "gemini:keys:getAll"
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
function getKeysFileLocation() {
  return getKeysFilePath();
}
function getEmbeddedKeys() {
  return loadApiKeys();
}
const DEFAULT_SETTINGS = {
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
    settings: { ...DEFAULT_SETTINGS },
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
    settings: state.settings || { ...DEFAULT_SETTINGS },
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
    const numProjects = 5;
    const state = this.getRotationState();
    let currentAccIdx = state.currentAccountIndex || 0;
    let currentProjIdx = state.currentProjectIndex || 0;
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
      }
      attempts++;
    }
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
    for (const account of this.config.accounts) {
      for (const project of account.projects) {
        const status = project.status;
        if (status === STATUS_RATE_LIMITED || status === STATUS_EXHAUSTED) {
          project.status = STATUS_AVAILABLE;
          project.limitTracking.rateLimitResetAt = null;
          project.limitTracking.dailyLimitResetAt = null;
          project.limitTracking.minuteRequestCount = 0;
        }
      }
    }
    this.saveConfig();
    console.log("[ApiManager] Đã reset xong");
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
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS = {
  FLASH_2_5: "gemini-2.5-flash",
  FLASH_2_0: "gemini-2.0-flash",
  FLASH_1_5: "gemini-1.5-flash",
  PRO_1_5: "gemini-1.5-pro"
};
async function callGeminiApi(prompt, apiKey, model = GEMINI_MODELS.FLASH_2_5) {
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
async function callGeminiWithRotation(prompt, model = GEMINI_MODELS.FLASH_2_5, maxRetries = 10) {
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
async function translateText(text, targetLanguage = "Vietnamese", model = GEMINI_MODELS.FLASH_2_5) {
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
        const result = await callGeminiWithRotation(prompt, model || GEMINI_MODELS.FLASH_2_5);
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
          model || GEMINI_MODELS.FLASH_2_5
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
  console.log("[IPC] Đã đăng ký xong Gemini handlers");
}
const CAPTION_IPC_CHANNELS = {
  // Caption
  PARSE_SRT: "caption:parseSrt",
  TRANSLATE: "caption:translate",
  TRANSLATE_PROGRESS: "caption:translateProgress",
  EXPORT_SRT: "caption:exportSrt",
  // TTS
  TTS_GENERATE: "tts:generate",
  TTS_PROGRESS: "tts:progress",
  TTS_GET_VOICES: "tts:getVoices",
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
    model = GEMINI_MODELS.FLASH_2_5,
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
  console.log("[TTSHandlers] Đã đăng ký handlers thành công");
}
function registerAllHandlers() {
  console.log("[IPC] Đang đăng ký tất cả handlers...");
  registerGeminiHandlers();
  registerCaptionHandlers();
  registerTTSHandlers();
  console.log("[IPC] Đã đăng ký xong tất cả handlers");
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
  registerAllHandlers();
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
