"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const utils = require("@electron-toolkit/utils");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const fs$1 = require("fs/promises");
const child_process = require("child_process");
const uuid = require("uuid");
const Database = require("better-sqlite3");
const impit = require("impit");
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
class SessionContextManager {
  constructor() {
    this.currentContext = null;
  }
  /**
   * Get the current active session context
   */
  getCurrentContext() {
    return this.currentContext ? { ...this.currentContext } : null;
  }
  /**
   * Update session context with new values
   */
  updateContext(newContext) {
    if (!this.currentContext) {
      this.currentContext = {
        conversationId: "",
        responseId: "",
        choiceId: ""
      };
    }
    this.currentContext = {
      ...this.currentContext,
      ...newContext
    };
    console.log("[SessionContextManager] Context updated:", this.currentContext);
  }
  /**
   * Set complete context (replaces current)
   */
  setContext(context) {
    this.currentContext = context ? { ...context } : null;
    console.log("[SessionContextManager] Context set:", this.currentContext);
  }
  /**
   * Reset/clear the session context (start new conversation)
   */
  resetSession() {
    this.currentContext = null;
    console.log("[SessionContextManager] Session reset");
  }
  /**
   * Parse session context from Gemini API response (Fetch mode)
   * Extracts conversationId, responseId, choiceId from response array structure
   */
  parseFromFetchResponse(responseText) {
    const newContext = {
      conversationId: "",
      responseId: "",
      choiceId: ""
    };
    try {
      const lines = responseText.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith(")]}'")) continue;
        if (/^\d+$/.test(trimmed)) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (!Array.isArray(parsed) || parsed.length === 0) continue;
          for (const payloadItem of parsed) {
            if (!Array.isArray(payloadItem) || payloadItem.length < 3) continue;
            if (payloadItem[0] !== "wrb.fr") continue;
            if (typeof payloadItem[2] !== "string") continue;
            const innerData = JSON.parse(payloadItem[2]);
            if (!Array.isArray(innerData)) continue;
            if (Array.isArray(innerData[1])) {
              if (innerData[1][0] && !newContext.conversationId) {
                newContext.conversationId = String(innerData[1][0]);
              }
              if (innerData[1][1] && !newContext.responseId) {
                newContext.responseId = String(innerData[1][1]);
              }
            }
            if (Array.isArray(innerData[4]) && innerData[4].length > 0) {
              const candidate = innerData[4][0];
              if (Array.isArray(candidate) && candidate[0] && !newContext.choiceId) {
                newContext.choiceId = String(candidate[0]);
              }
            }
          }
        } catch {
          continue;
        }
      }
      const contextSummary = {
        conversationId: newContext.conversationId ? `${String(newContext.conversationId).slice(0, 24)}...` : "",
        responseIdLength: newContext.responseId ? String(newContext.responseId).length : 0,
        choiceId: newContext.choiceId ? `${String(newContext.choiceId).slice(0, 24)}...` : ""
      };
    } catch (error) {
      console.error("[SessionContextManager] Failed to parse fetch response:", error);
    }
    return newContext;
  }
  /**
   * Parse session context from Gemini API streaming response
   * Extracts conversationId, responseId, choiceId from stream chunks
   */
  parseFromStreamResponse(responseText) {
    const newContext = {
      conversationId: "",
      responseId: "",
      choiceId: ""
    };
    try {
      const lines = responseText.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        const cleanedLine = line.replace(/^\)\]\}'\n?/, "").trim();
        if (!cleanedLine || cleanedLine.length < 2) continue;
        try {
          const parsed = JSON.parse(cleanedLine);
          if (!Array.isArray(parsed) || parsed.length === 0) continue;
          for (const payloadItem of parsed) {
            if (!Array.isArray(payloadItem) || payloadItem.length < 3) continue;
            if (payloadItem[0] !== "wrb.fr") continue;
            if (typeof payloadItem[2] !== "string") continue;
            const innerData = JSON.parse(payloadItem[2]);
            if (!Array.isArray(innerData)) continue;
            if (Array.isArray(innerData[1])) {
              if (innerData[1][0] && !newContext.conversationId) {
                newContext.conversationId = String(innerData[1][0]);
              }
              if (innerData[1][1] && !newContext.responseId) {
                newContext.responseId = String(innerData[1][1]);
              }
            }
            if (Array.isArray(innerData[4]) && innerData[4].length > 0) {
              const candidate = innerData[4][0];
              if (Array.isArray(candidate) && candidate[0] && !newContext.choiceId) {
                newContext.choiceId = String(candidate[0]);
              }
            }
          }
        } catch (parseError) {
          continue;
        }
      }
      console.log("[SessionContextManager] Parsed context from stream response:", newContext);
    } catch (error) {
      console.error("[SessionContextManager] Failed to parse stream response:", error);
    }
    return newContext;
  }
  /**
   * Check if we have a valid active session
   */
  hasActiveSession() {
    return this.currentContext !== null && this.currentContext.conversationId !== "";
  }
  /**
   * Format context for request payload
   */
  formatForRequest() {
    if (!this.currentContext) {
      return ["", "", ""];
    }
    return [
      this.currentContext.conversationId,
      this.currentContext.responseId,
      this.currentContext.choiceId
    ];
  }
}
let instance$2 = null;
function getSessionContextManager() {
  if (!instance$2) {
    instance$2 = new SessionContextManager();
  }
  return instance$2;
}
class ConfigurationService {
  // Cache for 5 seconds
  constructor(database) {
    this.cachedConfig = null;
    this.cacheTimestamp = 0;
    this.CACHE_TTL_MS = 5e3;
    this.db = database;
  }
  /**
   * Validate cookie configuration
   */
  validateConfig(config) {
    const errors = [];
    if (!config.cookie || !config.cookie.trim()) {
      errors.push("Cookie is required");
    } else {
      if (!config.cookie.includes("__Secure-1PSID")) {
        errors.push("Cookie must contain __Secure-1PSID");
      }
      if (!config.cookie.includes("__Secure-3PSID")) {
        errors.push("Cookie must contain __Secure-3PSID");
      }
    }
    if (!config.blLabel || !config.blLabel.trim()) {
      errors.push("BL_LABEL is required");
    }
    if (!config.fSid || !config.fSid.trim()) {
      errors.push("F_SID is required");
    }
    if (!config.atToken || !config.atToken.trim()) {
      errors.push("AT_TOKEN is required");
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }
  /**
   * Get active cookie configuration (with caching)
   */
  getActiveConfig() {
    const now = Date.now();
    if (this.cachedConfig && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
      return { ...this.cachedConfig };
    }
    try {
      const row = this.db.prepare("SELECT * FROM gemini_cookie WHERE id = 1").get();
      if (row) {
        const config = {
          cookie: row.cookie,
          blLabel: row.bl_label,
          fSid: row.f_sid,
          atToken: row.at_token,
          reqId: row.req_id,
          updatedAt: row.updated_at
        };
        this.cachedConfig = config;
        this.cacheTimestamp = now;
        return { ...config };
      }
      return null;
    } catch (error) {
      console.error("[ConfigurationService] Error fetching config:", error);
      return null;
    }
  }
  /**
   * Save or update cookie configuration
   */
  saveConfig(config) {
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join(", ")}`
      };
    }
    try {
      const now = Date.now();
      const existing = this.db.prepare("SELECT id FROM gemini_cookie WHERE id = 1").get();
      if (existing) {
        this.db.prepare(
          `UPDATE gemini_cookie 
             SET cookie = ?, bl_label = ?, f_sid = ?, at_token = ?, req_id = ?, updated_at = ?
             WHERE id = 1`
        ).run(
          config.cookie,
          config.blLabel,
          config.fSid,
          config.atToken,
          config.reqId || null,
          now
        );
      } else {
        this.db.prepare(
          `INSERT INTO gemini_cookie (id, cookie, bl_label, f_sid, at_token, req_id, updated_at)
             VALUES (1, ?, ?, ?, ?, ?, ?)`
        ).run(
          config.cookie,
          config.blLabel,
          config.fSid,
          config.atToken,
          config.reqId || null,
          now
        );
      }
      this.invalidateCache();
      console.log("[ConfigurationService] Config saved successfully");
      return { success: true };
    } catch (error) {
      console.error("[ConfigurationService] Error saving config:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Update only the reqId field (for incrementing request counter)
   */
  updateReqId(reqId) {
    try {
      this.db.prepare("UPDATE gemini_cookie SET req_id = ?, updated_at = ? WHERE id = 1").run(reqId, Date.now());
      this.invalidateCache();
      return { success: true };
    } catch (error) {
      console.error("[ConfigurationService] Error updating reqId:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }
  /**
   * Check if a valid configuration exists
   */
  hasValidConfig() {
    const config = this.getActiveConfig();
    if (!config) return false;
    const validation = this.validateConfig(config);
    return validation.valid;
  }
  /**
   * Invalidate the cache (force refresh on next access)
   */
  invalidateCache() {
    this.cachedConfig = null;
    this.cacheTimestamp = 0;
  }
  /**
   * Get configuration age in milliseconds
   */
  getConfigAge() {
    const config = this.getActiveConfig();
    if (!config) return null;
    return Date.now() - config.updatedAt;
  }
}
let instance$1 = null;
function getConfigurationService(database) {
  if (!instance$1) {
    instance$1 = new ConfigurationService(database);
  }
  return instance$1;
}
const DEFAULT_SETTINGS = {
  theme: "dark",
  language: "vi",
  projectsBasePath: null,
  recentProjectIds: [],
  lastActiveProjectId: null,
  useProxy: true,
  // Mặc định bật proxy
  createChatOnWeb: false,
  useStoredContextOnFirstSend: false,
  translationPromptId: null,
  // Tự động tìm prompt dịch
  summaryPromptId: null
  // Tự động tìm prompt tóm tắt
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
  getProjectsBasePath() {
    return this.settings.projectsBasePath ?? null;
  }
  setProjectsBasePath(basePath) {
    this.settings.projectsBasePath = basePath ?? null;
    this.save();
  }
  /**
   * Update settings (partial update)
   */
  update(partial) {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.getAll();
  }
  addRecentProject(projectId) {
    if (!projectId) return;
    const filtered = this.settings.recentProjectIds.filter((id) => id !== projectId);
    this.settings.recentProjectIds = [projectId, ...filtered].slice(0, 10);
    this.settings.lastActiveProjectId = projectId;
    this.save();
  }
  getRecentProjectIds() {
    return [...this.settings.recentProjectIds];
  }
  getLastActiveProjectId() {
    return this.settings.lastActiveProjectId ?? null;
  }
  setLastActiveProjectId(projectId) {
    this.settings.lastActiveProjectId = projectId ?? null;
    if (projectId) {
      this.addRecentProject(projectId);
    } else {
      this.save();
    }
  }
  removeFromRecent(projectId) {
    this.settings.recentProjectIds = this.settings.recentProjectIds.filter((id) => id !== projectId);
    if (this.settings.lastActiveProjectId === projectId) {
      this.settings.lastActiveProjectId = null;
    }
    this.save();
  }
  /**
   * Remove project from recent list (when deleted) - REMOVED
   */
  // removeFromRecent(projectId: string): void {
  //   this.settings.recentProjectIds = this.settings.recentProjectIds.filter(id => id !== projectId);
  //   if (this.settings.lastActiveProjectId === projectId) {
  //     this.settings.lastActiveProjectId = null;
  //   }
  //   this.save();
  // }
}
const AppSettingsService = new AppSettingsServiceClass();
async function callGeminiApi(prompt, apiKey, model = GEMINI_MODELS.FLASH_3_0, useProxy = true) {
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
    console.log(`[GeminiService] Gọi Gemini API với model: ${model}${useProxy ? " (via proxy)" : ""}`);
    if (useProxy) {
      const { makeRequestWithProxy } = await Promise.resolve().then(() => require("./chunks/apiClient-CIn7ArmW.js"));
      const result = await makeRequestWithProxy(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: payload,
        timeout: 3e4,
        // 30s cho translation
        useProxy: true
      });
      if (!result.success) {
        if (result.error?.includes("429")) {
          return { success: false, error: "RATE_LIMIT" };
        }
        return { success: false, error: result.error };
      }
      const responseData = result.data;
      if (responseData.candidates && responseData.candidates.length > 0) {
        const candidate = responseData.candidates[0];
        if (candidate.content && candidate.content.parts) {
          const text = candidate.content.parts[0]?.text || "";
          return { success: true, data: text.trim() };
        }
      }
      return { success: false, error: "Response không có nội dung" };
    } else {
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
    }
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
  let useProxySetting = true;
  try {
    const settings = AppSettingsService.getAll();
    useProxySetting = settings.useProxy;
    console.log(`[GeminiService] Proxy setting: ${useProxySetting ? "enabled" : "disabled"}`);
  } catch (error) {
    console.warn("[GeminiService] Could not load proxy setting, using default (enabled)");
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
    const response = await callGeminiApi(prompt, apiKey, model, useProxySetting);
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
function srtTimeToAss(srtTime) {
  const normalized = srtTime.replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parts[1];
    const sParts = parts[2].split(".");
    const s = sParts[0];
    const ms = sParts[1] || "000";
    const cs = ms.substring(0, 2);
    return `${h}:${m}:${s}.${cs}`;
  }
  return srtTime;
}
function hexToAssColor(hexColor) {
  const clean = hexColor.replace("#", "");
  if (clean.length === 6) {
    const r = clean.substring(0, 2);
    const g = clean.substring(2, 4);
    const b = clean.substring(4, 6);
    return `&H00${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
  }
  return "&H00FFFFFF";
}
async function getAssDuration(assPath) {
  try {
    const content = await fs__namespace$1.readFile(assPath, "utf-8");
    const lines = content.split("\n");
    let maxTime = 0;
    for (const line of lines) {
      if (line.trim().startsWith("Dialogue:")) {
        const parts = line.split(",");
        if (parts.length >= 3) {
          const endTimeStr = parts[2].trim();
          const timeParts = endTimeStr.replace(".", ":").split(":");
          if (timeParts.length >= 3) {
            const h = parseInt(timeParts[0], 10);
            const m = parseInt(timeParts[1], 10);
            const s = parseInt(timeParts[2], 10);
            const totalSeconds = h * 3600 + m * 60 + s;
            maxTime = Math.max(maxTime, totalSeconds);
          }
        }
      }
    }
    if (maxTime > 0) {
      return maxTime + 2;
    }
    return null;
  } catch (error) {
    console.error("[ASSConverter] Lỗi đọc duration:", error);
    return null;
  }
}
async function convertSrtToAss(options) {
  const { srtPath, assPath, videoResolution, style, position } = options;
  console.log(`[ASSConverter] Bắt đầu convert: ${path__namespace.basename(srtPath)}`);
  try {
    const srtResult = await parseSrtFile(srtPath);
    if (!srtResult.success || srtResult.entries.length === 0) {
      return {
        success: false,
        error: srtResult.error || "Không có subtitle entries nào"
      };
    }
    const entries = srtResult.entries;
    const w = videoResolution?.width || 1920;
    const h = videoResolution?.height || 1080;
    const assColor = hexToAssColor(style.fontColor);
    let content = `[Script Info]
Title: Converted by NauChaoHeo
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
ScaledBorderAndShadow: no

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontName},${style.fontSize},${assColor},&H000000FF,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,1,2,${style.shadow},${style.alignment},10,10,${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    for (const entry of entries) {
      const startAss = srtTimeToAss(entry.startTime);
      const endAss = srtTimeToAss(entry.endTime);
      let text = (entry.translatedText || entry.text).replace(/\n/g, "\\N");
      if (position) {
        text = `{\\pos(${position.x},${position.y})}${text}`;
      }
      content += `Dialogue: 0,${startAss},${endAss},Default,,0,0,0,,${text}
`;
    }
    const dir = path__namespace.dirname(assPath);
    await fs__namespace$1.mkdir(dir, { recursive: true });
    await fs__namespace$1.writeFile(assPath, content, "utf-8");
    console.log(`[ASSConverter] Convert thành công: ${entries.length} entries -> ${path__namespace.basename(assPath)}`);
    return {
      success: true,
      assPath,
      entriesCount: entries.length
    };
  } catch (error) {
    const errorMsg = `Lỗi convert SRT sang ASS: ${error}`;
    console.error(`[ASSConverter] ${errorMsg}`);
    return {
      success: false,
      error: errorMsg
    };
  }
}
function getFFmpegPath() {
  const isPackaged = electron.app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
  } else {
    return path.join(electron.app.getAppPath(), "resources", "ffmpeg", "win32", "ffmpeg.exe");
  }
}
function getFFprobePath() {
  const isPackaged = electron.app.isPackaged;
  if (isPackaged) {
    return path.join(process.resourcesPath, "ffmpeg", "ffprobe.exe");
  } else {
    return path.join(electron.app.getAppPath(), "resources", "ffmpeg", "win32", "ffprobe.exe");
  }
}
function isFFmpegAvailable() {
  const ffmpegPath = getFFmpegPath();
  const ffprobePath = getFFprobePath();
  const ffmpegExists = fs.existsSync(ffmpegPath);
  const ffprobeExists = fs.existsSync(ffprobePath);
  if (!ffmpegExists) {
    console.warn(`[FFmpeg] Không tìm thấy ffmpeg tại: ${ffmpegPath}`);
  }
  if (!ffprobeExists) {
    console.warn(`[FFmpeg] Không tìm thấy ffprobe tại: ${ffprobePath}`);
  }
  return ffmpegExists && ffprobeExists;
}
async function getVideoMetadata(videoPath) {
  if (!fs.existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }
  const ffprobePath = getFFprobePath();
  if (!fs.existsSync(ffprobePath)) {
    return { success: false, error: `ffprobe không tìm thấy: ${ffprobePath}` };
  }
  return new Promise((resolve) => {
    const args = [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      videoPath
    ];
    const process2 = child_process.spawn(ffprobePath, args);
    let stdout = "";
    let stderr = "";
    process2.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    process2.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    process2.on("close", (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `ffprobe exit code: ${code}` });
        return;
      }
      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams?.find((s) => s.codec_type === "video");
        if (!videoStream) {
          resolve({ success: false, error: "Không tìm thấy video stream" });
          return;
        }
        const fpsStr = videoStream.r_frame_rate || "30/1";
        const fpsParts = fpsStr.split("/");
        const fps = fpsParts.length === 2 ? parseInt(fpsParts[0]) / parseInt(fpsParts[1]) : 30;
        const metadata = {
          width: videoStream.width || 1920,
          height: videoStream.height || 1080,
          duration: parseFloat(info.format?.duration || "0"),
          frameCount: parseInt(videoStream.nb_frames || "0") || Math.floor(parseFloat(info.format?.duration || "0") * fps),
          fps: Math.round(fps * 100) / 100
        };
        console.log(`[VideoRenderer] Metadata: ${metadata.width}x${metadata.height}, ${metadata.duration}s, ${metadata.fps}fps`);
        resolve({ success: true, metadata });
      } catch (error) {
        resolve({ success: false, error: `Lỗi parse metadata: ${error}` });
      }
    });
    process2.on("error", (error) => {
      resolve({ success: false, error: `Lỗi ffprobe: ${error.message}` });
    });
  });
}
async function extractVideoFrame(videoPath, frameNumber) {
  if (!fs.existsSync(videoPath)) {
    return { success: false, error: `File không tồn tại: ${videoPath}` };
  }
  const ffmpegPath = getFFmpegPath();
  if (!fs.existsSync(ffmpegPath)) {
    return { success: false, error: `ffmpeg không tìm thấy: ${ffmpegPath}` };
  }
  const metadataResult = await getVideoMetadata(videoPath);
  if (!metadataResult.success || !metadataResult.metadata) {
    return { success: false, error: metadataResult.error || "Không lấy được metadata" };
  }
  const { duration, width, height, fps } = metadataResult.metadata;
  let seekTime;
  if (frameNumber !== void 0) {
    seekTime = frameNumber / fps;
  } else {
    seekTime = duration * (0.1 + Math.random() * 0.8);
  }
  return new Promise((resolve) => {
    const args = [
      "-ss",
      seekTime.toFixed(2),
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "-"
    ];
    const process2 = child_process.spawn(ffmpegPath, args);
    const chunks = [];
    process2.stdout.on("data", (data) => {
      chunks.push(data);
    });
    process2.on("close", (code) => {
      if (code !== 0 || chunks.length === 0) {
        resolve({ success: false, error: "Không thể extract frame" });
        return;
      }
      const frameBuffer = Buffer.concat(chunks);
      const frameData = frameBuffer.toString("base64");
      console.log(`[VideoRenderer] Extracted frame at ${seekTime.toFixed(2)}s, size: ${frameBuffer.length} bytes`);
      resolve({
        success: true,
        frameData,
        width,
        height
      });
    });
    process2.on("error", (error) => {
      resolve({ success: false, error: `Lỗi ffmpeg: ${error.message}` });
    });
  });
}
async function renderAssToVideo(options, progressCallback) {
  const { assPath, outputPath, width, height, useGpu } = options;
  console.log(`[VideoRenderer] Bắt đầu render: ${path__namespace.basename(assPath)}`);
  if (!isFFmpegAvailable()) {
    return { success: false, error: "FFmpeg không được cài đặt" };
  }
  if (!fs.existsSync(assPath)) {
    return { success: false, error: `File ASS không tồn tại: ${assPath}` };
  }
  const duration = await getAssDuration(assPath) || 60;
  const fps = 30;
  const totalFrames = Math.floor(duration * fps);
  console.log(`[VideoRenderer] Duration: ${duration}s, Total frames: ${totalFrames}`);
  const outputDir = path__namespace.dirname(outputPath);
  await fs__namespace$1.mkdir(outputDir, { recursive: true });
  const assFilter = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const { app } = await import("electron");
  const isPackaged = app.isPackaged;
  const fontsDir = isPackaged ? path__namespace.join(process.resourcesPath, "fonts") : path__namespace.join(app.getAppPath(), "resources", "fonts");
  const fontsDirEscaped = fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:");
  const assFilterFull = fs.existsSync(fontsDir) ? `ass='${assFilter}':fontsdir='${fontsDirEscaped}'` : `ass='${assFilter}'`;
  console.log(`[VideoRenderer] Fonts dir: ${fontsDir} (exists: ${fs.existsSync(fontsDir)})`);
  let videoCodec;
  let codecParams;
  if (useGpu) {
    videoCodec = "h264_qsv";
    codecParams = ["-preset", "medium", "-global_quality", "23"];
  } else {
    videoCodec = "libx264";
    codecParams = ["-preset", "medium", "-crf", "23"];
  }
  const ffmpegPath = getFFmpegPath();
  const args = [
    "-f",
    "lavfi",
    "-i",
    `color=black:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-vf",
    assFilterFull,
    "-c:v",
    videoCodec,
    ...codecParams,
    "-pix_fmt",
    "yuv420p",
    "-y",
    outputPath
  ];
  console.log(`[VideoRenderer] Command: ffmpeg ${args.join(" ")}`);
  return new Promise((resolve) => {
    const process2 = child_process.spawn(ffmpegPath, args);
    let stderr = "";
    process2.stderr.on("data", (data) => {
      const line = data.toString();
      stderr += line;
      const frameMatch = line.match(/frame=\s*(\d+)/);
      if (frameMatch && progressCallback) {
        const currentFrame = parseInt(frameMatch[1], 10);
        const percent = Math.min(100, Math.round(currentFrame / totalFrames * 100));
        progressCallback({
          currentFrame,
          totalFrames,
          fps,
          percent,
          status: "rendering",
          message: `Đang render: ${percent}%`
        });
      }
    });
    process2.on("close", (code) => {
      if (code === 0) {
        console.log(`[VideoRenderer] Render thành công: ${outputPath}`);
        if (progressCallback) {
          progressCallback({
            currentFrame: totalFrames,
            totalFrames,
            fps,
            percent: 100,
            status: "completed",
            message: "Hoàn thành!"
          });
        }
        resolve({
          success: true,
          outputPath,
          duration
        });
      } else {
        console.error(`[VideoRenderer] Render thất bại, code: ${code}`);
        console.error(`[VideoRenderer] stderr: ${stderr}`);
        if (useGpu && (stderr.includes("qsv") || stderr.includes("encode") || stderr.includes("Error"))) {
          console.log("[VideoRenderer] GPU encoding thất bại, thử lại với CPU...");
          renderAssToVideo(
            { ...options, useGpu: false },
            progressCallback
          ).then(resolve);
          return;
        }
        if (progressCallback) {
          progressCallback({
            currentFrame: 0,
            totalFrames,
            fps: 0,
            percent: 0,
            status: "error",
            message: `Lỗi render: ${stderr.substring(0, 200)}`
          });
        }
        resolve({
          success: false,
          error: stderr || `FFmpeg exit code: ${code}`
        });
      }
    });
    process2.on("error", (error) => {
      console.error(`[VideoRenderer] Process error: ${error.message}`);
      resolve({
        success: false,
        error: `Lỗi FFmpeg: ${error.message}`
      });
    });
  });
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
    "dialog:showSaveDialog",
    async (_event, options) => {
      console.log("[CaptionHandlers] Mở dialog lưu file...");
      const result = await electron.dialog.showSaveDialog({
        title: options?.title,
        defaultPath: options?.defaultPath,
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
  electron.ipcMain.handle(
    "captionVideo:convertToAss",
    async (_event, options) => {
      console.log(`[CaptionHandlers] Convert SRT to ASS: ${options.srtPath}`);
      try {
        const result = await convertSrtToAss(options);
        if (result.success && result.assPath) {
          return {
            success: true,
            data: { assPath: result.assPath, entriesCount: result.entriesCount || 0 }
          };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi convert ASS:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    "captionVideo:renderVideo",
    async (event, options) => {
      console.log(`[CaptionHandlers] Render video: ${options.assPath} -> ${options.outputPath}`);
      try {
        const progressCallback = (progress) => {
          const window = electron.BrowserWindow.fromWebContents(event.sender);
          if (window) {
            window.webContents.send("captionVideo:renderProgress", progress);
          }
        };
        const result = await renderAssToVideo(options, progressCallback);
        if (result.success && result.outputPath) {
          return {
            success: true,
            data: { outputPath: result.outputPath, duration: result.duration || 0 }
          };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi render video:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    "captionVideo:getVideoMetadata",
    async (_event, videoPath) => {
      console.log(`[CaptionHandlers] Get video metadata: ${videoPath}`);
      try {
        const result = await getVideoMetadata(videoPath);
        if (result.success && result.metadata) {
          return { success: true, data: result.metadata };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi get metadata:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    "captionVideo:extractFrame",
    async (_event, videoPath, frameNumber) => {
      console.log(`[CaptionHandlers] Extract frame: ${videoPath}, frame=${frameNumber || "random"}`);
      try {
        const result = await extractVideoFrame(videoPath, frameNumber);
        if (result.success && result.frameData) {
          return {
            success: true,
            data: {
              frameData: result.frameData,
              width: result.width || 0,
              height: result.height || 0
            }
          };
        }
        return { success: false, error: result.error };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi extract frame:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    "caption:saveJson",
    async (_event, options) => {
      console.log(`[CaptionHandlers] Lưu JSON: ${options.filePath}`);
      try {
        const fs2 = await import("fs/promises");
        const path2 = await import("path");
        const dir = path2.dirname(options.filePath);
        await fs2.mkdir(dir, { recursive: true });
        await fs2.writeFile(
          options.filePath,
          JSON.stringify(options.data, null, 2),
          "utf-8"
        );
        return { success: true, data: options.filePath };
      } catch (error) {
        console.error("[CaptionHandlers] Lỗi lưu JSON:", error);
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
  db.pragma("foreign_keys = ON");
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
    CREATE TABLE IF NOT EXISTS gemini_cookie (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie TEXT NOT NULL,
      bl_label TEXT NOT NULL,
      f_sid TEXT NOT NULL,
      at_token TEXT NOT NULL,
      req_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    const tableInfo = db.pragma("table_info(gemini_chat_config)");
    const columnNames = tableInfo.map((col) => col.name);
    if (!columnNames.includes("req_id")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN req_id TEXT");
      console.log("[Database] Added missing column: req_id");
    }
    if (!columnNames.includes("proxy_id")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN proxy_id TEXT");
      console.log("[Database] Added missing column: proxy_id");
    }
    if (!columnNames.includes("user_agent")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN user_agent TEXT");
      console.log("[Database] Added missing column: user_agent");
    }
    if (!columnNames.includes("accept_language")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN accept_language TEXT");
      console.log("[Database] Added missing column: accept_language");
    }
    if (!columnNames.includes("platform")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN platform TEXT");
      console.log("[Database] Added missing column: platform");
    }
  } catch (e) {
    console.error("[Database] Migration error:", e);
  }
  try {
    const cookieData = db.prepare("SELECT * FROM gemini_cookie WHERE id = 1").get();
    const configCount = db.prepare("SELECT COUNT(*) as count FROM gemini_chat_config").get();
    if (cookieData && configCount.count === 0) {
      console.log("[Database] Migrating data from gemini_cookie to gemini_chat_config...");
      const now = Date.now();
      const { v4: uuidv4 } = require("uuid");
      db.prepare(`
        INSERT INTO gemini_chat_config (
          id, name, cookie, bl_label, f_sid, at_token, req_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        uuidv4(),
        "Migrated Config",
        cookieData.cookie,
        cookieData.bl_label,
        cookieData.f_sid,
        cookieData.at_token,
        cookieData.req_id,
        now,
        now
      );
      console.log("[Database] Migration from gemini_cookie completed");
    }
  } catch (e) {
    console.log("[Database] No migration needed from gemini_cookie");
  }
  try {
    const contextCount = db.prepare("SELECT COUNT(*) as count FROM gemini_chat_context").get();
    if (contextCount.count === 0) {
      const rows = db.prepare("SELECT id, conv_id, resp_id, cand_id FROM gemini_chat_config").all();
      const insert = db.prepare(`
        INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const row of rows) {
        if (row.conv_id || row.resp_id || row.cand_id) {
          insert.run(row.id, row.conv_id || "", row.resp_id || "", row.cand_id || "", now);
        }
      }
      console.log("[Database] Backfilled gemini_chat_context from gemini_chat_config");
    }
  } catch (e) {
    console.error("[Database] Backfill gemini_chat_context failed:", e);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_chat_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'default',
      cookie TEXT NOT NULL,
      bl_label TEXT,
      f_sid TEXT,
      at_token TEXT,
      proxy_id TEXT,
      conv_id TEXT,
      resp_id TEXT,
      cand_id TEXT,
      req_id TEXT,
      user_agent TEXT,
      accept_language TEXT,
      platform TEXT,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_cookie (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie TEXT NOT NULL,
      bl_label TEXT NOT NULL,
      f_sid TEXT NOT NULL,
      at_token TEXT NOT NULL,
      req_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    const tableInfo = db.pragma("table_info(gemini_chat_config)");
    const columnNames = tableInfo.map((col) => col.name);
    if (!columnNames.includes("req_id")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN req_id TEXT");
      console.log("[Database] Added missing column: req_id");
    }
    if (!columnNames.includes("proxy_id")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN proxy_id TEXT");
      console.log("[Database] Added missing column: proxy_id");
    }
    if (!columnNames.includes("user_agent")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN user_agent TEXT");
      console.log("[Database] Added missing column: user_agent");
    }
    if (!columnNames.includes("accept_language")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN accept_language TEXT");
      console.log("[Database] Added missing column: accept_language");
    }
    if (!columnNames.includes("platform")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN platform TEXT");
      console.log("[Database] Added missing column: platform");
    }
  } catch (e) {
    console.error("[Database] Migration error:", e);
  }
  try {
    const cookieData = db.prepare("SELECT * FROM gemini_cookie WHERE id = 1").get();
    const configCount = db.prepare("SELECT COUNT(*) as count FROM gemini_chat_config").get();
    if (cookieData && configCount.count === 0) {
      console.log("[Database] Migrating data from gemini_cookie to gemini_chat_config...");
      const now = Date.now();
      const { v4: uuidv4 } = require("uuid");
      db.prepare(`
        INSERT INTO gemini_chat_config (
          id, name, cookie, bl_label, f_sid, at_token, req_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        uuidv4(),
        "Migrated Config",
        cookieData.cookie,
        cookieData.bl_label,
        cookieData.f_sid,
        cookieData.at_token,
        cookieData.req_id,
        now,
        now
      );
      console.log("[Database] Migration from gemini_cookie completed");
    }
  } catch (e) {
    console.log("[Database] No migration needed from gemini_cookie");
  }
  try {
    const contextCount = db.prepare("SELECT COUNT(*) as count FROM gemini_chat_context").get();
    if (contextCount.count === 0) {
      const rows = db.prepare("SELECT id, conv_id, resp_id, cand_id FROM gemini_chat_config").all();
      const insert = db.prepare(`
        INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const row of rows) {
        if (row.conv_id || row.resp_id || row.cand_id) {
          insert.run(row.id, row.conv_id || "", row.resp_id || "", row.cand_id || "", now);
        }
      }
      console.log("[Database] Backfilled gemini_chat_context from gemini_chat_config");
    }
  } catch (e) {
    console.error("[Database] Backfill gemini_chat_context failed:", e);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_chat_context (
      config_id TEXT PRIMARY KEY,
      conversation_id TEXT,
      response_id TEXT,
      choice_id TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (config_id) REFERENCES gemini_chat_config(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_cookie (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie TEXT NOT NULL,
      bl_label TEXT NOT NULL,
      f_sid TEXT NOT NULL,
      at_token TEXT NOT NULL,
      req_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    const tableInfo = db.pragma("table_info(gemini_chat_config)");
    const columnNames = tableInfo.map((col) => col.name);
    if (!columnNames.includes("req_id")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN req_id TEXT");
      console.log("[Database] Added missing column: req_id");
    }
    if (!columnNames.includes("proxy_id")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN proxy_id TEXT");
      console.log("[Database] Added missing column: proxy_id");
    }
    if (!columnNames.includes("user_agent")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN user_agent TEXT");
      console.log("[Database] Added missing column: user_agent");
    }
    if (!columnNames.includes("accept_language")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN accept_language TEXT");
      console.log("[Database] Added missing column: accept_language");
    }
    if (!columnNames.includes("platform")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN platform TEXT");
      console.log("[Database] Added missing column: platform");
    }
  } catch (e) {
    console.error("[Database] Migration error:", e);
  }
  try {
    const cookieData = db.prepare("SELECT * FROM gemini_cookie WHERE id = 1").get();
    const configCount = db.prepare("SELECT COUNT(*) as count FROM gemini_chat_config").get();
    if (cookieData && configCount.count === 0) {
      console.log("[Database] Migrating data from gemini_cookie to gemini_chat_config...");
      const now = Date.now();
      const { v4: uuidv4 } = require("uuid");
      db.prepare(`
        INSERT INTO gemini_chat_config (
          id, name, cookie, bl_label, f_sid, at_token, req_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        uuidv4(),
        "Migrated Config",
        cookieData.cookie,
        cookieData.bl_label,
        cookieData.f_sid,
        cookieData.at_token,
        cookieData.req_id,
        now,
        now
      );
      console.log("[Database] Migration from gemini_cookie completed");
    }
  } catch (e) {
    console.log("[Database] No migration needed from gemini_cookie");
  }
  try {
    const contextCount = db.prepare("SELECT COUNT(*) as count FROM gemini_chat_context").get();
    if (contextCount.count === 0) {
      const rows = db.prepare("SELECT id, conv_id, resp_id, cand_id FROM gemini_chat_config").all();
      const insert = db.prepare(`
        INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const row of rows) {
        if (row.conv_id || row.resp_id || row.cand_id) {
          insert.run(row.id, row.conv_id || "", row.resp_id || "", row.cand_id || "", now);
        }
      }
      console.log("[Database] Backfilled gemini_chat_context from gemini_chat_config");
    }
  } catch (e) {
    console.error("[Database] Backfill gemini_chat_context failed:", e);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxies (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      type TEXT DEFAULT 'http' CHECK(type IN ('http', 'https', 'socks5')),
      enabled INTEGER DEFAULT 1,
      platform TEXT,
      country TEXT,
      city TEXT,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(host, port)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_cookie (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cookie TEXT NOT NULL,
      bl_label TEXT NOT NULL,
      f_sid TEXT NOT NULL,
      at_token TEXT NOT NULL,
      req_id TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    const tableInfo = db.pragma("table_info(gemini_chat_config)");
    const columnNames = tableInfo.map((col) => col.name);
    if (!columnNames.includes("req_id")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN req_id TEXT");
      console.log("[Database] Added missing column: req_id");
    }
    if (!columnNames.includes("proxy_id")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN proxy_id TEXT");
      console.log("[Database] Added missing column: proxy_id");
    }
    if (!columnNames.includes("user_agent")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN user_agent TEXT");
      console.log("[Database] Added missing column: user_agent");
    }
    if (!columnNames.includes("accept_language")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN accept_language TEXT");
      console.log("[Database] Added missing column: accept_language");
    }
    if (!columnNames.includes("platform")) {
      db.exec("ALTER TABLE gemini_chat_config ADD COLUMN platform TEXT");
      console.log("[Database] Added missing column: platform");
    }
  } catch (e) {
    console.error("[Database] Migration error:", e);
  }
  try {
    const cookieData = db.prepare("SELECT * FROM gemini_cookie WHERE id = 1").get();
    const configCount = db.prepare("SELECT COUNT(*) as count FROM gemini_chat_config").get();
    if (cookieData && configCount.count === 0) {
      console.log("[Database] Migrating data from gemini_cookie to gemini_chat_config...");
      const now = Date.now();
      const { v4: uuidv4 } = require("uuid");
      db.prepare(`
        INSERT INTO gemini_chat_config (
          id, name, cookie, bl_label, f_sid, at_token, req_id, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        uuidv4(),
        "Migrated Config",
        cookieData.cookie,
        cookieData.bl_label,
        cookieData.f_sid,
        cookieData.at_token,
        cookieData.req_id,
        now,
        now
      );
      console.log("[Database] Migration from gemini_cookie completed");
    }
  } catch (e) {
    console.log("[Database] No migration needed from gemini_cookie");
  }
  try {
    const contextCount = db.prepare("SELECT COUNT(*) as count FROM gemini_chat_context").get();
    if (contextCount.count === 0) {
      const rows = db.prepare("SELECT id, conv_id, resp_id, cand_id FROM gemini_chat_config").all();
      const insert = db.prepare(`
        INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const row of rows) {
        if (row.conv_id || row.resp_id || row.cand_id) {
          insert.run(row.id, row.conv_id || "", row.resp_id || "", row.cand_id || "", now);
        }
      }
      console.log("[Database] Backfilled gemini_chat_context from gemini_chat_config");
    }
  } catch (e) {
    console.error("[Database] Backfill gemini_chat_context failed:", e);
  }
  console.log("[Database] Schema initialized (prompts, gemini_chat_config, gemini_chat_context, gemini_cookie, proxies)");
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
class ProxyDatabase {
  /**
   * Get all proxies
   */
  static getAll() {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
      SELECT * FROM proxies ORDER BY created_at DESC
    `);
    const rows = stmt.all();
    return rows.map((row) => ({
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username || void 0,
      password: row.password || void 0,
      type: row.type,
      enabled: row.enabled === 1,
      platform: row.platform || void 0,
      country: row.country || void 0,
      city: row.city || void 0,
      successCount: row.success_count || 0,
      failedCount: row.failed_count || 0,
      lastUsedAt: row.last_used_at || void 0,
      createdAt: row.created_at
    }));
  }
  /**
   * Get proxy by ID
   */
  static getById(id) {
    const db2 = getDatabase();
    const stmt = db2.prepare(`SELECT * FROM proxies WHERE id = ?`);
    const row = stmt.get(id);
    if (!row) return null;
    return {
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username || void 0,
      password: row.password || void 0,
      type: row.type,
      enabled: row.enabled === 1,
      platform: row.platform || void 0,
      country: row.country || void 0,
      city: row.city || void 0,
      successCount: row.success_count || 0,
      failedCount: row.failed_count || 0,
      lastUsedAt: row.last_used_at || void 0,
      createdAt: row.created_at
    };
  }
  /**
   * Create new proxy
   */
  static create(proxy) {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
      INSERT INTO proxies (
        id, host, port, username, password, type, enabled,
        platform, country, city, success_count, failed_count,
        last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      proxy.id,
      proxy.host,
      proxy.port,
      proxy.username || null,
      proxy.password || null,
      proxy.type,
      proxy.enabled ? 1 : 0,
      proxy.platform || null,
      proxy.country || null,
      proxy.city || null,
      0,
      // success_count
      0,
      // failed_count
      proxy.lastUsedAt || null,
      proxy.createdAt
    );
    return {
      ...proxy,
      successCount: 0,
      failedCount: 0
    };
  }
  /**
   * Update proxy
   */
  static update(id, updates) {
    const db2 = getDatabase();
    const fields = [];
    const values = [];
    if (updates.host !== void 0) {
      fields.push("host = ?");
      values.push(updates.host);
    }
    if (updates.port !== void 0) {
      fields.push("port = ?");
      values.push(updates.port);
    }
    if (updates.username !== void 0) {
      fields.push("username = ?");
      values.push(updates.username || null);
    }
    if (updates.password !== void 0) {
      fields.push("password = ?");
      values.push(updates.password || null);
    }
    if (updates.type !== void 0) {
      fields.push("type = ?");
      values.push(updates.type);
    }
    if (updates.enabled !== void 0) {
      fields.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.platform !== void 0) {
      fields.push("platform = ?");
      values.push(updates.platform || null);
    }
    if (updates.country !== void 0) {
      fields.push("country = ?");
      values.push(updates.country || null);
    }
    if (updates.city !== void 0) {
      fields.push("city = ?");
      values.push(updates.city || null);
    }
    if (updates.successCount !== void 0) {
      fields.push("success_count = ?");
      values.push(updates.successCount);
    }
    if (updates.failedCount !== void 0) {
      fields.push("failed_count = ?");
      values.push(updates.failedCount);
    }
    if (updates.lastUsedAt !== void 0) {
      fields.push("last_used_at = ?");
      values.push(updates.lastUsedAt);
    }
    if (fields.length === 0) return false;
    values.push(id);
    const stmt = db2.prepare(`UPDATE proxies SET ${fields.join(", ")} WHERE id = ?`);
    const result = stmt.run(...values);
    return result.changes > 0;
  }
  /**
   * Delete proxy
   */
  static delete(id) {
    const db2 = getDatabase();
    const stmt = db2.prepare(`DELETE FROM proxies WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }
  /**
   * Check if proxy exists by host:port
   */
  static exists(host, port) {
    const db2 = getDatabase();
    const stmt = db2.prepare(`SELECT COUNT(*) as count FROM proxies WHERE host = ? AND port = ?`);
    const result = stmt.get(host, port);
    return result.count > 0;
  }
  /**
   * Increment success count
   */
  static incrementSuccess(id) {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
      UPDATE proxies 
      SET success_count = success_count + 1,
          failed_count = 0,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }
  /**
   * Increment success count without resetting failed count
   */
  static incrementSuccessNoReset(id) {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
      UPDATE proxies
      SET success_count = success_count + 1,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }
  /**
   * Increment failed count
   */
  static incrementFailed(id) {
    const db2 = getDatabase();
    const stmt = db2.prepare(`
      UPDATE proxies 
      SET failed_count = failed_count + 1,
          last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }
  /**
   * Delete all proxies
   */
  static deleteAll() {
    const db2 = getDatabase();
    db2.prepare(`DELETE FROM proxies`).run();
  }
}
class ProxyManager {
  constructor() {
    this.currentIndex = 0;
    this.maxFailedCount = 2;
    this.settings = {
      maxRetries: 3,
      timeout: 1e4,
      maxFailedCount: 2,
      enableRotation: true,
      fallbackToDirect: true
    };
    console.log("[ProxyManager] Initialized with database storage");
  }
  /**
   * Lấy proxy tiếp theo theo round-robin
   * @returns Proxy config hoặc null nếu không có proxy khả dụng
   */
  getNextProxy() {
    if (!this.settings.enableRotation) {
      return null;
    }
    const allProxies = ProxyDatabase.getAll();
    const availableProxies = allProxies.filter(
      (p) => p.enabled && (p.failedCount || 0) < this.maxFailedCount
    );
    if (availableProxies.length === 0) {
      console.warn("[ProxyManager] Không có proxy khả dụng");
      return null;
    }
    const proxy = availableProxies[this.currentIndex % availableProxies.length];
    this.currentIndex = (this.currentIndex + 1) % availableProxies.length;
    console.log(`[ProxyManager] Sử dụng proxy: ${proxy.host}:${proxy.port} (${proxy.type})`);
    return proxy;
  }
  /**
   * Đánh dấu proxy thành công
   */
  markProxySuccess(proxyId) {
    try {
      ProxyDatabase.incrementSuccess(proxyId);
      const proxy = ProxyDatabase.getById(proxyId);
      if (proxy) {
        console.log(`[ProxyManager] ✅ Proxy ${proxy.host}:${proxy.port} thành công (${proxy.successCount} success)`);
      }
    } catch (error) {
      console.error("[ProxyManager] Lỗi markProxySuccess:", error);
    }
  }
  /**
   * Đánh dấu proxy thất bại
   */
  markProxyFailed(proxyId, error) {
    try {
      ProxyDatabase.incrementFailed(proxyId);
      const proxy = ProxyDatabase.getById(proxyId);
      if (proxy) {
        console.warn(`[ProxyManager] ❌ Proxy ${proxy.host}:${proxy.port} thất bại (${proxy.failedCount || 0}/${this.maxFailedCount})`, error);
        if ((proxy.failedCount || 0) >= this.maxFailedCount) {
          ProxyDatabase.update(proxyId, { enabled: false });
          console.error(`[ProxyManager] 🚫 Đã disable proxy ${proxy.host}:${proxy.port} do lỗi quá nhiều lần`);
        }
      }
    } catch (error2) {
      console.error("[ProxyManager] Lỗi markProxyFailed:", error2);
    }
  }
  /**
   * Thêm proxy mới
   */
  addProxy(config) {
    const newProxy = {
      ...config,
      id: `proxy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      successCount: 0,
      failedCount: 0
    };
    const created = ProxyDatabase.create(newProxy);
    console.log(`[ProxyManager] ➕ Đã thêm proxy: ${created.host}:${created.port}`);
    return created;
  }
  /**
   * Xóa proxy
   */
  removeProxy(proxyId) {
    const proxy = ProxyDatabase.getById(proxyId);
    if (proxy) {
      const deleted = ProxyDatabase.delete(proxyId);
      if (deleted) {
        console.log(`[ProxyManager] ➖ Đã xóa proxy: ${proxy.host}:${proxy.port}`);
        return true;
      }
    }
    return false;
  }
  /**
   * Cập nhật proxy
   */
  updateProxy(proxyId, updates) {
    const updated = ProxyDatabase.update(proxyId, updates);
    if (updated) {
      const proxy = ProxyDatabase.getById(proxyId);
      if (proxy) {
        console.log(`[ProxyManager] 🔄 Đã cập nhật proxy: ${proxy.host}:${proxy.port}`);
      }
      return true;
    }
    return false;
  }
  /**
   * Lấy tất cả proxies
   */
  getAllProxies() {
    return ProxyDatabase.getAll();
  }
  /**
   * Lấy thống kê của tất cả proxies
   */
  getStats() {
    const proxies = ProxyDatabase.getAll();
    return proxies.map((proxy) => {
      const total = (proxy.successCount || 0) + (proxy.failedCount || 0);
      const successRate = total > 0 ? (proxy.successCount || 0) / total : 0;
      return {
        id: proxy.id,
        host: proxy.host,
        port: proxy.port,
        successCount: proxy.successCount || 0,
        failedCount: proxy.failedCount || 0,
        successRate: Math.round(successRate * 100),
        lastUsedAt: proxy.lastUsedAt,
        isHealthy: proxy.enabled && (proxy.failedCount || 0) < this.maxFailedCount
      };
    });
  }
  /**
   * Test proxy hoạt động không
   */
  async testProxy(proxyId) {
    const proxy = ProxyDatabase.getById(proxyId);
    if (!proxy) {
      return { success: false, error: "Proxy không tồn tại" };
    }
    try {
      const startTime = Date.now();
      const { default: fetch2 } = await import("node-fetch");
      const { HttpsProxyAgent } = await import("https-proxy-agent");
      const proxyUrl = proxy.username ? `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}` : `${proxy.type}://${proxy.host}:${proxy.port}`;
      const agent = new HttpsProxyAgent(proxyUrl);
      const response = await fetch2("https://httpbin.org/ip", {
        method: "GET",
        agent,
        timeout: this.settings.timeout
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const latency = Date.now() - startTime;
      const data = await response.json();
      console.log(`[ProxyManager] ✅ Test proxy thành công: ${proxy.host}:${proxy.port} (${latency}ms) - IP: ${data.origin}`);
      return { success: true, latency };
    } catch (error) {
      console.error(`[ProxyManager] ❌ Test proxy thất bại: ${proxy.host}:${proxy.port}`, error);
      return { success: false, error: String(error) };
    }
  }
  async createProxyAgent(proxy) {
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    const proxyScheme = proxy.type === "socks5" ? "socks5h" : proxy.type;
    const proxyUrl = proxy.username ? `${proxyScheme}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}` : `${proxyScheme}://${proxy.host}:${proxy.port}`;
    if (proxy.type === "socks5") {
      return new SocksProxyAgent(proxyUrl, { timeout: this.settings.timeout });
    }
    return new HttpsProxyAgent(proxyUrl, { timeout: this.settings.timeout });
  }
  async checkProxyConnectivity(proxyId, url = "https://generativelanguage.googleapis.com") {
    const proxy = ProxyDatabase.getById(proxyId);
    if (!proxy) {
      return { success: false, error: "Proxy không tồn tại" };
    }
    try {
      const startTime = Date.now();
      const { default: fetch2 } = await import("node-fetch");
      const agent = await this.createProxyAgent(proxy);
      const response = await fetch2(url, {
        method: "HEAD",
        agent,
        timeout: this.settings.timeout
      });
      const latency = Date.now() - startTime;
      const status = response.status;
      const success = status >= 200 && status < 500 && status !== 407;
      if (success) {
        ProxyDatabase.update(proxyId, { enabled: true });
        ProxyDatabase.incrementSuccessNoReset(proxyId);
        console.log(`[ProxyManager] ✅ Proxy ${proxy.host}:${proxy.port} check OK (${status})`);
      } else {
        ProxyDatabase.update(proxyId, { enabled: false });
        ProxyDatabase.incrementFailed(proxyId);
        console.warn(`[ProxyManager] ❌ Proxy ${proxy.host}:${proxy.port} check FAIL (${status})`);
      }
      return { success, latency, status };
    } catch (error) {
      ProxyDatabase.update(proxyId, { enabled: false });
      ProxyDatabase.incrementFailed(proxyId);
      console.warn(`[ProxyManager] ❌ Proxy ${proxy.host}:${proxy.port} check error`, error);
      return { success: false, error: String(error) };
    }
  }
  async checkAllProxies(url = "https://generativelanguage.googleapis.com") {
    const proxies = ProxyDatabase.getAll();
    let passed = 0;
    let failed = 0;
    for (const proxy of proxies) {
      const result = await this.checkProxyConnectivity(proxy.id, url);
      if (result.success) {
        passed += 1;
      } else {
        failed += 1;
      }
    }
    return { checked: proxies.length, passed, failed };
  }
  /**
   * Import proxies từ JSON string hoặc array
   */
  importProxies(data) {
    let proxiesToImport = [];
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        proxiesToImport = Array.isArray(parsed) ? parsed : parsed.proxies || [];
      } catch (e) {
        console.error("[ProxyManager] Lỗi parse JSON:", e);
        return { added: 0, skipped: 0 };
      }
    } else {
      proxiesToImport = data;
    }
    let added = 0;
    let skipped = 0;
    for (const proxy of proxiesToImport) {
      const exists = ProxyDatabase.exists(proxy.host, proxy.port);
      if (exists) {
        skipped++;
        continue;
      }
      this.addProxy(proxy);
      added++;
    }
    console.log(`[ProxyManager] Import hoàn thành: ${added} added, ${skipped} skipped`);
    return { added, skipped };
  }
  /**
   * Export proxies
   */
  exportProxies() {
    const proxies = ProxyDatabase.getAll();
    return JSON.stringify({
      proxies,
      settings: this.settings
    }, null, 2);
  }
  /**
   * Kiểm tra có nên fallback về direct connection không
   */
  shouldFallbackToDirect() {
    return this.settings.fallbackToDirect;
  }
  /**
   * Reset failed count của tất cả proxies
   */
  resetAllFailedCounts() {
    const proxies = ProxyDatabase.getAll();
    proxies.forEach((proxy) => {
      ProxyDatabase.update(proxy.id, { failedCount: 0, enabled: true });
    });
    console.log("[ProxyManager] 🔄 Đã reset failed count của tất cả proxies");
  }
}
let instance = null;
function getProxyManager() {
  if (!instance) {
    instance = new ProxyManager();
  }
  return instance;
}
const IMPIT_BROWSERS = [
  "chrome",
  "chrome100",
  "chrome101",
  "chrome104",
  "chrome107",
  "chrome110",
  "chrome116",
  "chrome124",
  "chrome125",
  "chrome131",
  "chrome136",
  "chrome142",
  "firefox",
  "firefox128",
  "firefox133",
  "firefox135",
  "firefox144"
];
const BROWSER_PROFILES = [
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    platform: "Windows",
    secChUa: `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
    secChUaPlatform: `"Windows"`
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
    platform: "Windows",
    secChUa: `"Not_A Brand";v="8", "Chromium";v="121", "Microsoft Edge";v="121"`,
    secChUaPlatform: `"Windows"`
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    platform: "macOS",
    secChUa: `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
    secChUaPlatform: `"macOS"`
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
    platform: "Windows",
    secChUa: "",
    // Firefox often empty or different
    secChUaPlatform: `"Windows"`
  }
];
function getRandomBrowserProfile() {
  return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}
function generateInitialReqId() {
  const prefix = Math.floor(Math.random() * (45 - 30) + 30);
  const suffix = Math.floor(Math.random() * 9e3 + 1e3);
  return String(prefix * 1e5 + suffix);
}
function buildRequestPayload(message, contextArray, createChatOnWeb) {
  const reqUuid = uuid.v4().toUpperCase();
  const reqStruct = [
    [message, 0, null, null, null, null, 0],
    ["vi"],
    [contextArray[0], contextArray[1], contextArray[2], null, null, null, null, null, null, ""],
    "!BwSlBFzNAAZeabWMfmlCAOK4lSpy-nY7ADQBEArZ1HXWr3pDagC9VZ5CWddxxlroONpL-a5eGEHXpYjZYEboidltqN627255ouWfutqSAgAAAEtSAAAAAmgBB34AQf7Z0X4QHk8aehxZTrwdWe2_4ynoojTI3Dop9DkAR1EzMlT4nLjH65NoKYTZj-WO50CGSm_ENmZpEvP--1D_FnyJmQOvlsPu3GfxD62pT5siALsF-4-Jm1LJY4I7jLertSMjtvs1_R710Z6lSHhM4PuGaaOUrRMj8-UOBqCgscsTETggz3x_ju7ACGPssxINDSYvXK5XenYexuBblk9vytrqyB1E7Ntp2kHlZanL2GAf_WCWa_Zaev2j2C23Oip1rZNMfLeSnBCAy_P5w2UR5lwYfVuKIXGhG8LWt-00k1K49MV6DiTItqYyH3OC5qOmokpnUyLMrnobu3z5H9FUxZMxNjbGsl0DmDiINJQnrO7vjppHyuMrLYECDdkptAlDsQRYOcJRuazOowdqTlUwz283lg7hNoX_D4QUUG5zt2TAsrXsbFWlacIN5SeNjqlHha9tXvXB77DbcR_CzwZbF8gju5SA8ruxleoUzapriHFEXs5Ipz1c2UvB5ph1_C3PYi4ER-Dl7ykEgBZooOJPEL_4QPq4gd20gvvYiwLVeM1BiwisfZT13sJ1vhbB1XIeakQKA1Ikalf7PoCZ5tjwxn9Zsz1rRJtSSX_wfvb-lrat3XPCyjA_a-JKE-DLhIHChbouYIlTlvMT25nmWE5jemyvCj_KdHRWg0XE3wQt8jD2zmrgl8JNRygbJy9Llmfv_FAAy4TRmddSQGjpNnnTvTioiO4ydPNXFfq_M78_DxeGl56mdVf15JBZ-tqReaDDr4ltrkO09MX_CUY1cZvIqt3_QrgakGGnjc3tVZzRl2gYZ5vJBQa_pHObKly8kEQLMAYnOzB943fHjijMkw1jW1Hg7gYDEIuBPiN8mLIkl73oDPeMJSwsn4PwNm5K6V6blTxQVNylGLGlp5E5mmV92Az-bY-LqLCqTIEs0Ajd-CimLvQPTEXuMsFliaCxXsLbxrdSdrPkYIPSVUQDj7bdCs9CXo2MjPIwjHVPCmI5Cb8WPs6hu1fbYHTxLthzRejxEFdmZ0RakYqKOZFetMpzA8QN0HJ7ZIR9eA8VM4r6CB0YO0FKZcQmAHNjBPHyAqXnNZNgrZDwknPWttn9QiZH51MIBe5Hk3-zzQUvJ5fPlJlkWkd4VPzCroOIBtk6aduceg2-YQt4N701ghkxfFZ-k-blbUeFvZGIgMfbWWeJRRdrRWrrWgdT0FXT_jhJV1XA5bwZcy1X-ykmlE2CAvb1BQMUdY9YE_mJMvowLakNeo0r7Q4FOoVyu-cVhrQl7iHDmHEspUGbpa91q-7KKL0AUYxLahYd8giy5o_45o-rD1y0asaFRBhh3R0j__zg2sa1i1AA2A",
    "7f64e8c4aa4819e0a1a684fd7e6f5f9b",
    null,
    [1],
    1,
    null,
    null,
    1,
    0,
    null,
    null,
    null,
    null,
    null,
    [[0]],
    0,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    1,
    null,
    null,
    [4],
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [1],
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    null,
    null,
    null,
    null,
    reqUuid,
    null,
    [],
    null,
    null,
    null,
    null,
    [Math.floor(Date.now() / 1e3), Math.floor(Date.now() % 1e3 * 1e6)],
    // DYNAMIC TIMESTAMP!
    null,
    2
  ];
  return JSON.stringify([null, JSON.stringify(reqStruct)]);
}
class GeminiChatServiceClass {
  constructor() {
    this.proxyAssignments = /* @__PURE__ */ new Map();
    this.proxyInUse = /* @__PURE__ */ new Set();
    this.proxyRotationIndex = 0;
    this.proxyMaxFailedCount = 3;
    this.tokenLocks = /* @__PURE__ */ new Map();
    this.firstSendByTokenKey = /* @__PURE__ */ new Set();
    this.lastCompletionTimeByTokenKey = /* @__PURE__ */ new Map();
    this.impitBrowserAssignments = /* @__PURE__ */ new Map();
    this.impitBrowsersInUse = /* @__PURE__ */ new Set();
    this.nextAvailableTimeByTokenKey = /* @__PURE__ */ new Map();
    this.lastUsedConfigId = null;
  }
  static getInstance() {
    if (!GeminiChatServiceClass.instance) {
      GeminiChatServiceClass.instance = new GeminiChatServiceClass();
    }
    return GeminiChatServiceClass.instance;
  }
  async withTokenLock(tokenKeyRaw, fn) {
    const tokenKey = (tokenKeyRaw || "").trim();
    const requestId = Math.random().toString(36).substring(7);
    console.log(`[GeminiChatService][${requestId}] Request queued for token: '${tokenKey.substring(0, 10)}...'`);
    const previousTask = this.tokenLocks.get(tokenKey) || Promise.resolve();
    let signalTaskDone;
    const myTaskPromise = new Promise((resolve) => {
      signalTaskDone = resolve;
    });
    this.tokenLocks.set(tokenKey, myTaskPromise);
    try {
      await previousTask;
    } catch (e) {
    }
    const now = Date.now();
    const nextAllowedTime = this.nextAvailableTimeByTokenKey.get(tokenKey) || 0;
    const waitTime = Math.ceil(Math.max(0, nextAllowedTime - now));
    if (waitTime > 0) {
      console.log(`[GeminiChatService][${requestId}] Cooling down: Waiting ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    console.log(`[GeminiChatService][${requestId}] Executing task NOW.`);
    try {
      const result = await fn();
      return result;
    } finally {
      const MIN_DELAY_MS = 1e4;
      const MAX_DELAY_MS = 2e4;
      const randomDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
      const completionTime = Date.now();
      const nextTime = completionTime + randomDelay;
      this.nextAvailableTimeByTokenKey.set(tokenKey, nextTime);
      console.log(`[GeminiChatService][${requestId}] Task Complete. Next request allowed at: ${nextTime} (Delay: ${randomDelay}ms)`);
      if (typeof signalTaskDone === "function") signalTaskDone();
    }
  }
  buildTokenKey(_cookie, atToken) {
    return (atToken || "").trim();
  }
  getTokenKey(config) {
    return this.buildTokenKey(config.cookie || "", config.atToken || "") || config.id;
  }
  // ... (checkDuplicateToken omitted, unchanged) ...
  /**
   * Smart Account Selection:
   * - Prioritize accounts that are READY (Zero wait time).
   * - If multiple are ready, rotate among them.
   * - If none are ready, pick the one with the SHORTEST wait time.
   */
  getNextActiveConfig() {
    const activeConfigs = this.getAll().filter((c) => c.isActive);
    if (activeConfigs.length === 0) {
      console.warn("[GeminiChatService] No active configs available");
      return null;
    }
    const now = Date.now();
    let bestConfig = null;
    let minWaitTime = Infinity;
    const readyCandidates = [];
    for (const config of activeConfigs) {
      const tokenKey = this.getTokenKey(config);
      const nextTime = this.nextAvailableTimeByTokenKey.get(tokenKey) || 0;
      const waitTime = Math.max(0, nextTime - now);
      if (waitTime <= 0) {
        readyCandidates.push(config);
      }
      if (waitTime < minWaitTime) {
        minWaitTime = waitTime;
        bestConfig = config;
      }
    }
    if (readyCandidates.length > 0) {
      readyCandidates.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      let nextIndex = 0;
      if (this.lastUsedConfigId) {
        const lastUsedIndex = readyCandidates.findIndex((c) => c.id === this.lastUsedConfigId);
        if (lastUsedIndex !== -1) {
          nextIndex = (lastUsedIndex + 1) % readyCandidates.length;
        }
      }
      bestConfig = readyCandidates[nextIndex];
      console.log(`[GeminiChatService] Selected READY config: ${bestConfig.name} (Wait: 0ms)`);
    } else {
      if (bestConfig) {
        console.log(`[GeminiChatService] All busy. Selected BEST config: ${bestConfig.name} (Wait: ${minWaitTime}ms)`);
      }
    }
    if (bestConfig) {
      this.lastUsedConfigId = bestConfig.id;
    }
    return bestConfig;
  }
  checkDuplicateToken(cookie, atToken, excludeId) {
    const tokenKey = this.buildTokenKey(cookie || "", atToken || "");
    if (!tokenKey) {
      return { isDuplicate: false };
    }
    const configs = this.getAll();
    for (const config of configs) {
      if (excludeId && config.id === excludeId) continue;
      const configKey = this.buildTokenKey(config.cookie || "", config.atToken || "");
      if (configKey && configKey === tokenKey) {
        console.log(`[DEBUG] FOUND DUPLICATE: Input '${tokenKey}' == Config '${configKey}' (Name: ${config.name})`);
        return { isDuplicate: true, duplicate: config };
      }
    }
    return { isDuplicate: false };
  }
  getAssignedProxyId(configId) {
    if (!configId || configId === "legacy") return null;
    try {
      const db2 = getDatabase();
      const row = db2.prepare("SELECT proxy_id FROM gemini_chat_config WHERE id = ?").get(configId);
      return row?.proxy_id || null;
    } catch (error) {
      console.warn("[GeminiChatService] Không thể đọc proxy_id từ DB:", error);
      return null;
    }
  }
  setAssignedProxyId(configId, proxyId) {
    if (!configId || configId === "legacy") return;
    try {
      const db2 = getDatabase();
      db2.prepare("UPDATE gemini_chat_config SET proxy_id = ?, updated_at = ? WHERE id = ?").run(proxyId || null, Date.now(), configId);
    } catch (error) {
      console.warn("[GeminiChatService] Không thể lưu proxy_id vào DB:", error);
    }
  }
  getAssignedProxyIds(excludeConfigId) {
    const assigned = /* @__PURE__ */ new Set();
    try {
      const db2 = getDatabase();
      const rows = db2.prepare(`
                SELECT id, proxy_id FROM gemini_chat_config
                WHERE is_active = 1 AND proxy_id IS NOT NULL AND proxy_id != ''
            `).all();
      for (const row of rows) {
        if (excludeConfigId && row.id === excludeConfigId) continue;
        assigned.add(row.proxy_id);
      }
    } catch (error) {
      console.warn("[GeminiChatService] Không thể tải danh sách proxy_id đã gán:", error);
    }
    return assigned;
  }
  getUseProxySetting() {
    try {
      const settings = AppSettingsService.getAll();
      return settings.useProxy;
    } catch (error) {
      console.warn("[GeminiChatService] Không tải được cài đặt proxy, dùng mặc định (bật)");
      return true;
    }
  }
  async createProxyAgent(proxy, timeoutMs) {
    if (!proxy) return void 0;
    const { HttpsProxyAgent } = await import("https-proxy-agent");
    const { SocksProxyAgent } = await import("socks-proxy-agent");
    const proxyScheme = proxy.type === "socks5" ? "socks5h" : proxy.type;
    const proxyUrl = proxy.username ? `${proxyScheme}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}` : `${proxyScheme}://${proxy.host}:${proxy.port}`;
    if (proxy.type === "socks5") {
      return new SocksProxyAgent(proxyUrl, { timeout: timeoutMs });
    }
    return new HttpsProxyAgent(proxyUrl, {
      timeout: timeoutMs,
      rejectUnauthorized: false,
      keepAlive: false
    });
  }
  async fetchWithProxy(url, fetchOptions, timeoutMs, accountKey, useProxyOverride) {
    const setting = this.getUseProxySetting();
    const useProxy = typeof useProxyOverride === "boolean" ? useProxyOverride : setting;
    console.log(`[GeminiChatService] fetchWithProxy - Override: ${useProxyOverride}, Setting: ${setting}, Final: ${useProxy}`);
    const proxyManager = getProxyManager();
    let currentProxy = null;
    if (useProxy) {
      currentProxy = this.getOrAssignProxy(accountKey);
      if (!currentProxy) {
        throw new Error("Không còn proxy khả dụng");
      }
    }
    const { default: fetch2 } = await import("node-fetch");
    try {
      const agent = await this.createProxyAgent(currentProxy, timeoutMs);
      const response = await fetch2(url, { ...fetchOptions, ...agent ? { agent } : {} });
      if (response.ok) {
        if (currentProxy) {
          proxyManager.markProxySuccess(currentProxy.id);
          if (accountKey && accountKey !== "legacy") {
            this.setAssignedProxyId(accountKey, currentProxy.id);
          }
        }
        return { response, usedProxy: currentProxy };
      }
      if (currentProxy) {
        proxyManager.markProxyFailed(currentProxy.id, `HTTP ${response.status}`);
        if (accountKey && accountKey !== "legacy") {
          this.setAssignedProxyId(accountKey, null);
        }
        this.releaseProxy(accountKey, currentProxy.id);
      }
      return { response, usedProxy: currentProxy };
    } catch (error) {
      if (currentProxy) {
        proxyManager.markProxyFailed(currentProxy.id, error?.message || String(error));
        if (accountKey && accountKey !== "legacy") {
          this.setAssignedProxyId(accountKey, null);
        }
        this.releaseProxy(accountKey, currentProxy.id);
      }
      throw error;
    }
  }
  getOrAssignProxy(accountKey) {
    const assignedIdInMemory = this.proxyAssignments.get(accountKey);
    if (assignedIdInMemory) {
      const assigned = this.getAvailableProxies().find((p) => p.id === assignedIdInMemory);
      if (assigned) {
        return assigned;
      }
      this.releaseProxy(accountKey, assignedIdInMemory);
    }
    if (accountKey && accountKey !== "legacy") {
      const assignedId = this.getAssignedProxyId(accountKey);
      if (assignedId) {
        const assignedIds2 = this.getAssignedProxyIds(accountKey);
        if (assignedIds2.has(assignedId)) {
          console.warn("[GeminiChatService] Proxy đã gán bị trùng với cấu hình khác, sẽ gán lại");
          this.setAssignedProxyId(accountKey, null);
        } else {
          const assignedProxy = this.getAvailableProxies().find((p) => p.id === assignedId);
          if (assignedProxy) {
            if (!this.proxyInUse.has(assignedProxy.id)) {
              this.proxyAssignments.set(accountKey, assignedProxy.id);
              this.proxyInUse.add(assignedProxy.id);
              return assignedProxy;
            }
            console.warn(`[GeminiChatService] Proxy đã gán đang được dùng bởi tài khoản khác: ${assignedProxy.host}:${assignedProxy.port}`);
          } else {
            this.setAssignedProxyId(accountKey, null);
          }
        }
      }
    }
    const assignedIds = this.getAssignedProxyIds(accountKey);
    let available = this.getAvailableProxies().filter((p) => !this.proxyInUse.has(p.id) && !assignedIds.has(p.id));
    if (available.length === 0) {
      console.warn("[GeminiChatService] Không còn proxy trống chưa gán, fallback sang proxy khả dụng khác");
      available = this.getAvailableProxies().filter((p) => !this.proxyInUse.has(p.id));
    }
    if (available.length === 0) {
      console.warn(`[GeminiChatService] Không còn proxy trống cho tài khoản ${accountKey}`);
      return null;
    }
    const proxy = available[this.proxyRotationIndex % available.length];
    this.proxyRotationIndex = (this.proxyRotationIndex + 1) % available.length;
    this.proxyAssignments.set(accountKey, proxy.id);
    this.proxyInUse.add(proxy.id);
    if (accountKey && accountKey !== "legacy") {
      this.setAssignedProxyId(accountKey, proxy.id);
    }
    return proxy;
  }
  // =======================================================
  // IMPIT BROWSER ASSIGNMENT - Mỗi tài khoản 1 trình duyệt
  // =======================================================
  /**
   * Gán trình duyệt impit cho một tài khoản.
   * Mỗi tài khoản sẽ được gán 1 trình duyệt duy nhất từ danh sách IMPIT_BROWSERS.
   * Trả về null nếu hết trình duyệt khả dụng.
   */
  assignImpitBrowser(accountKey) {
    const existing = this.impitBrowserAssignments.get(accountKey);
    if (existing) {
      console.log(`[GeminiChatService] Impit browser đã gán cho ${accountKey}: ${existing}`);
      return existing;
    }
    const available = IMPIT_BROWSERS.filter((b) => !this.impitBrowsersInUse.has(b));
    if (available.length === 0) {
      console.error("[GeminiChatService] Hết trình duyệt impit khả dụng!");
      return null;
    }
    const browser = available[0];
    this.impitBrowserAssignments.set(accountKey, browser);
    this.impitBrowsersInUse.add(browser);
    console.log(`[GeminiChatService] Gán impit browser '${browser}' cho ${accountKey} (còn ${available.length - 1} trình duyệt)`);
    return browser;
  }
  /**
   * Giải phóng trình duyệt impit của 1 tài khoản
   */
  releaseImpitBrowser(accountKey) {
    const browser = this.impitBrowserAssignments.get(accountKey);
    if (browser) {
      this.impitBrowserAssignments.delete(accountKey);
      this.impitBrowsersInUse.delete(browser);
      console.log(`[GeminiChatService] Giải phóng impit browser '${browser}' từ ${accountKey}`);
    }
  }
  /**
   * Giải phóng tất cả trình duyệt impit
   */
  releaseAllImpitBrowsers() {
    this.impitBrowserAssignments.clear();
    this.impitBrowsersInUse.clear();
    console.log("[GeminiChatService] Đã giải phóng tất cả trình duyệt impit");
  }
  /**
   * Lấy trình duyệt impit đã gán cho tài khoản (không gán mới)
   */
  getAssignedImpitBrowser(accountKey) {
    return this.impitBrowserAssignments.get(accountKey) || null;
  }
  /**
   * Lấy số lượng trình duyệt impit tối đa có thể sử dụng
   */
  getMaxImpitBrowserCount() {
    return IMPIT_BROWSERS.length;
  }
  /**
   * Lấy số lượng trình duyệt impit còn khả dụng
   */
  getAvailableImpitBrowserCount() {
    return IMPIT_BROWSERS.length - this.impitBrowsersInUse.size;
  }
  releaseProxy(accountKey, proxyId) {
    const assignedId = this.proxyAssignments.get(accountKey);
    if (assignedId === proxyId) {
      this.proxyAssignments.delete(accountKey);
    }
    this.proxyInUse.delete(proxyId);
  }
  getAvailableProxies() {
    const proxyManager = getProxyManager();
    const allProxies = proxyManager.getAllProxies();
    return allProxies.filter((p) => p.enabled && (p.failedCount || 0) < this.proxyMaxFailedCount);
  }
  getStoredConfigContext(configId) {
    if (!configId || configId === "legacy") return null;
    try {
      const db2 = getDatabase();
      const row = db2.prepare("SELECT conversation_id, response_id, choice_id FROM gemini_chat_context WHERE config_id = ?").get(configId);
      if (!row) return null;
      return {
        conversationId: row.conversation_id || "",
        responseId: row.response_id || "",
        choiceId: row.choice_id || ""
      };
    } catch (error) {
      console.warn("[GeminiChatService] Không thể tải ngữ cảnh cấu hình từ DB:", error);
      return null;
    }
  }
  saveContext(context, configId) {
    if (!configId || configId === "legacy") return;
    try {
      const db2 = getDatabase();
      db2.prepare(`
                INSERT OR REPLACE INTO gemini_chat_context (config_id, conversation_id, response_id, choice_id, updated_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(
        configId,
        context.conversationId || "",
        context.responseId || "",
        context.choiceId || "",
        Date.now()
      );
    } catch (error) {
      console.warn("[GeminiChatService] Không thể lưu ngữ cảnh cấu hình vào DB:", error);
    }
  }
  // =======================================================
  // COOKIE CONFIG (Bảng riêng, chỉ 1 dòng)
  // =======================================================
  getCookieConfig() {
    const db2 = getDatabase();
    const configService = getConfigurationService(db2);
    return configService.getActiveConfig();
  }
  saveCookieConfig(config) {
    const db2 = getDatabase();
    const configService = getConfigurationService(db2);
    const result = configService.saveConfig(config);
    return result.success;
  }
  updateReqId(reqId) {
    const db2 = getDatabase();
    const configService = getConfigurationService(db2);
    const result = configService.updateReqId(reqId);
    return result.success;
  }
  // =======================================================
  // OLD CONFIG METHODS (gemini_chat_config table)
  // =======================================================
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
      const profile = getRandomBrowserProfile();
      console.log("[GeminiChatService] Creating config with profile:", data.userAgent ? "Custom" : profile.platform);
      db2.prepare(`
        INSERT INTO gemini_chat_config (
            id, name, cookie, bl_label, f_sid, at_token, proxy_id,
            conv_id, resp_id, cand_id, req_id, 
            user_agent, accept_language, platform,
            is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
        id,
        data.name || "default",
        data.cookie,
        data.blLabel || "",
        data.fSid || "",
        data.atToken || "",
        data.proxyId || null,
        data.convId || "",
        data.respId || "",
        data.candId || "",
        data.reqId || generateInitialReqId(),
        data.userAgent || profile.userAgent,
        data.acceptLanguage || null,
        data.platform || profile.platform,
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
    if (data.proxyId !== void 0) {
      updates.push("proxy_id = @proxyId");
      params.proxyId = data.proxyId;
    }
    if (data.convId !== void 0) {
      updates.push("conv_id = @convId");
      params.convId = data.convId;
    }
    if (data.respId !== void 0) {
      updates.push("resp_id = @respId");
      params.respId = data.respId;
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
    if (data.reqId !== void 0) {
      updates.push("req_id = @reqId");
      params.reqId = data.reqId;
    }
    if (data.isActive !== void 0) {
      updates.push("is_active = @isActive");
      params.isActive = data.isActive ? 1 : 0;
    }
    if (data.userAgent !== void 0) {
      updates.push("user_agent = @userAgent");
      params.userAgent = data.userAgent;
    }
    if (data.acceptLanguage !== void 0) {
      updates.push("accept_language = @acceptLanguage");
      params.acceptLanguage = data.acceptLanguage;
    }
    if (data.platform !== void 0) {
      updates.push("platform = @platform");
      params.platform = data.platform;
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
      proxyId: row.proxy_id || void 0,
      convId: row.conv_id,
      respId: row.resp_id,
      candId: row.cand_id,
      reqId: row.req_id,
      userAgent: row.user_agent,
      acceptLanguage: row.accept_language,
      platform: row.platform,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  // =======================================================
  // GUI TIN NHAN DEN GEMINI WEB API - STRICT PYTHON PORT
  // =======================================================
  // DEPRECATED WEB method (node-fetch) removed - use API or IMPIT instead
  // Old sendMessage() and _sendMessageInternal() functions deleted to avoid maintenance burden
  // =======================================================
  // Hàm hòa trộn Cookie cũ và Set-Cookie mới
  mergeCookies(oldCookieStr, setCookieHeader) {
    if (!setCookieHeader) return oldCookieStr;
    const newCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const cookieMap = /* @__PURE__ */ new Map();
    if (oldCookieStr) {
      oldCookieStr.split(";").forEach((c) => {
        const parts = c.trim().split("=");
        const key = parts[0];
        const val = parts.slice(1).join("=");
        if (key) cookieMap.set(key, val);
      });
    }
    newCookies.forEach((c) => {
      const parts = c.split(";")[0].split("=");
      const key = parts[0].trim();
      const value = parts.slice(1).join("=").trim();
      cookieMap.set(key, value);
    });
    return Array.from(cookieMap.entries()).map(([key, val]) => `${key}=${val}`).join("; ");
  }
  // =======================================================
  // SEND MESSAGE IMPIT
  // =======================================================
  async sendMessageImpit(message, configId, context, useProxyOverride, metadata) {
    let config = null;
    if (configId) {
      config = this.getById(configId);
      if (!config) return { success: false, error: `Config ID ${configId} not found`, metadata, retryable: false };
      if (!config.isActive) return { success: false, error: "Config is inactive", metadata, retryable: false };
    } else {
      config = this.getNextActiveConfig();
      if (!config) return { success: false, error: "No active config found", metadata, retryable: false };
    }
    const tokenKey = this.getTokenKey(config);
    console.log(`[GeminiChatService] Sending message via IMPIT using config: ${config.name}`);
    return await this.withTokenLock(tokenKey, async () => {
      const MAX_RETRIES = 3;
      const MIN_DELAY_MS = 5e3;
      const MAX_DELAY_MS = 3e4;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[GeminiChatService] Impit: Đang gửi tin nhắn (Lần ${attempt}/${MAX_RETRIES})...`);
        const result = await this._sendMessageImpitInternal(message, config, context, useProxyOverride);
        if (result.success) {
          return { ...result, metadata };
        }
        if (result.error && result.error.includes("Không còn proxy khả dụng")) {
          console.error("[GeminiChatService] Impit: Dừng retry do hết proxy khả dụng");
          return { ...result, metadata, retryable: true };
        }
        if (attempt < MAX_RETRIES) {
          const retryDelay = Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS;
          console.log(`[GeminiChatService] Impit: Yêu cầu thất bại, thử lại sau ${retryDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          console.error(`[GeminiChatService] Impit: Tất cả ${MAX_RETRIES} lần thử đều thất bại.`);
          return { ...result, metadata, retryable: true };
        }
      }
      return { success: false, error: "Unexpected error in Impit retry loop", metadata, retryable: true };
    });
  }
  async _sendMessageImpitInternal(message, config, context, useProxyOverride) {
    try {
      const { cookie, blLabel, fSid, atToken } = config;
      if (!cookie || !blLabel || !fSid || !atToken) {
        return { success: false, error: "Missing config fields", configId: config.id };
      }
      const tokenKey = this.getTokenKey(config);
      let currentReqIdStr = config.reqId || generateInitialReqId();
      const reqId = String(parseInt(currentReqIdStr) + 1e5);
      if (config.id !== "legacy") {
        try {
          getDatabase().prepare("UPDATE gemini_chat_config SET req_id = ? WHERE id = ?").run(reqId, config.id);
          config.reqId = reqId;
        } catch (e) {
        }
      }
      const appSettings = AppSettingsService.getAll();
      const allowStoredContextOnFirstSend = !!appSettings.useStoredContextOnFirstSend;
      const isFirstSendForToken = !this.firstSendByTokenKey.has(tokenKey);
      const canUseStoredContext = !isFirstSendForToken || allowStoredContextOnFirstSend;
      const shouldIgnoreIncomingContext = isFirstSendForToken && !allowStoredContextOnFirstSend;
      const incomingContext = shouldIgnoreIncomingContext ? void 0 : context;
      const configContext = this.getStoredConfigContext(config.id);
      let storedContext = null;
      if (!incomingContext && canUseStoredContext) {
        if (configContext) {
          storedContext = configContext;
        }
      }
      const effectiveContext = incomingContext || storedContext || void 0;
      const contextArray = effectiveContext ? [effectiveContext.conversationId, effectiveContext.responseId, effectiveContext.choiceId] : ["", "", ""];
      const createChatOnWeb = true;
      console.log(`[GeminiChatService] Impit: createChatOnWeb = ${createChatOnWeb} (Updated to match Python REQ structure)`);
      const fReq = buildRequestPayload(message, contextArray, createChatOnWeb);
      const useProxy = this.getUseProxySetting();
      console.log(`[GeminiChatService] Proxy setting from DB: ${useProxy}${typeof useProxyOverride === "boolean" ? `, frontend override: ${useProxyOverride}` : ""}`);
      let proxyUrl = void 0;
      let usedProxy = null;
      if (useProxy) {
        usedProxy = this.getOrAssignProxy(config.id);
        if (usedProxy) {
          const scheme = usedProxy.type === "socks5" ? "socks5" : usedProxy.type === "https" ? "https" : "http";
          if (usedProxy.username) {
            proxyUrl = `${scheme}://${usedProxy.username}:${usedProxy.password}@${usedProxy.host}:${usedProxy.port}`;
          } else {
            proxyUrl = `${scheme}://${usedProxy.host}:${usedProxy.port}`;
          }
        }
      }
      const assignedBrowser = this.assignImpitBrowser(config.id);
      if (!assignedBrowser) {
        return {
          success: false,
          error: `Hết trình duyệt impit khả dụng (tối đa ${IMPIT_BROWSERS.length} tài khoản đồng thời)`,
          configId: config.id
        };
      }
      console.log(`[GeminiChatService] Impit: Sử dụng trình duyệt '${assignedBrowser}' cho config ${config.name}`);
      const useHttp3 = !proxyUrl;
      if (proxyUrl) {
        console.log(`[GeminiChatService] Impit: Tắt HTTP/3 vì đang dùng proxy (${proxyUrl.split("@").pop()})`);
      }
      const impit$1 = new impit.Impit({
        browser: assignedBrowser,
        proxyUrl,
        ignoreTlsErrors: true,
        timeout: 3e5,
        http3: useHttp3,
        followRedirects: true,
        maxRedirects: 10
      });
      const hl = config.acceptLanguage ? config.acceptLanguage.split(",")[0] : "vi";
      const baseUrl = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
      const params = new URLSearchParams({
        "bl": blLabel,
        "_reqid": reqId,
        "rt": "c",
        "f.sid": fSid,
        "hl": hl
      });
      const url = `${baseUrl}?${params.toString()}`;
      const body = new URLSearchParams(
        createChatOnWeb ? { "f.req": fReq, "at": atToken } : { "f.req": fReq, "at": atToken, "": "" }
      );
      console.log(`[GeminiChatService] Impit: Request body keys = [${Array.from(body.keys()).join(", ")}]`);
      const headers = {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "cookie": (cookie || "").replace(/[\r\n]+/g, "")
      };
      headers["origin"] = "https://gemini.google.com";
      headers["referer"] = "https://gemini.google.com/";
      const cookieLength = headers["cookie"].length;
      const hasSecurePSID = headers["cookie"].includes("__Secure-1PSID");
      const hasSecurePSIDTS = headers["cookie"].includes("__Secure-1PSIDTS");
      console.log(`[GeminiChatService] Impit: Cookie length=${cookieLength}, __Secure-1PSID=${hasSecurePSID}, __Secure-1PSIDTS=${hasSecurePSIDTS}`);
      if (!hasSecurePSID || !hasSecurePSIDTS) {
        console.error("[GeminiChatService] ⚠️ CẢNH BÁO: Cookie thiếu __Secure-1PSID hoặc __Secure-1PSIDTS - Có thể gây lỗi 400!");
      }
      const atTokenPreview = atToken ? `${atToken.substring(0, 20)}...` : "MISSING";
      const blLabelPreview = blLabel ? blLabel : "MISSING";
      const fSidPreview = fSid ? fSid : "MISSING";
      console.log(`[GeminiChatService] Impit: AT Token=${atTokenPreview}, BL=${blLabelPreview}, F.SID=${fSidPreview}`);
      const contextSummary = {
        conversationId: contextArray[0] ? `${String(contextArray[0]).slice(0, 24)}...` : "",
        responseId: contextArray[1] ? `${String(contextArray[1]).slice(0, 24)}...` : "",
        choiceId: contextArray[2] ? `${String(contextArray[2]).slice(0, 24)}...` : ""
      };
      const hasContext = !!(contextArray[0] || contextArray[1] || contextArray[2]);
      if (hasContext) {
        console.log("[GeminiChatService] Impit: Đang sử dụng context cũ:", contextSummary);
        console.log("[GeminiChatService] ⚠️ Nếu lỗi 400 liên tục, hãy thử XÓA context (Reset conversation)");
      } else {
        console.log("[GeminiChatService] Impit: Bắt đầu conversation MỚI (không có context)");
      }
      console.log("[GeminiChatService] Sending message via IMPIT");
      console.log("[GeminiChatService] Sending Impit request to:", url);
      const response = await impit$1.fetch(url, {
        method: "POST",
        headers,
        body: body.toString()
      });
      console.log("[GeminiChatService] Impit response status:", response.status);
      if (response.status !== 200) {
        try {
          const responseText2 = await response.text();
          console.error(`[GeminiChatService] Impit HTTP ${response.status} Error Response:`, responseText2.substring(0, 500));
        } catch (e) {
          console.error("[GeminiChatService] Could not read error response body:", e);
        }
        if (usedProxy) {
          const proxyManager = getProxyManager();
          proxyManager.markProxyFailed(usedProxy.id, `HTTP ${response.status}`);
          this.releaseProxy(config.id, usedProxy.id);
          this.setAssignedProxyId(config.id, null);
        }
        return { success: false, error: `Impit HTTP ${response.status}`, configId: config.id };
      }
      if (usedProxy) {
        const proxyManager = getProxyManager();
        proxyManager.markProxySuccess(usedProxy.id);
      }
      let setCookieHeaders = [];
      if (typeof response.headers.getSetCookie === "function") {
        setCookieHeaders = response.headers.getSetCookie();
      } else if ("raw" in response.headers && typeof response.headers.raw === "function") {
        const raw = response.headers.raw();
        if (raw["set-cookie"]) {
          setCookieHeaders = raw["set-cookie"];
        }
      } else {
        const headerVal = response.headers.get("set-cookie");
        if (headerVal) {
          setCookieHeaders = [headerVal];
        }
      }
      const responseText = await response.text();
      let foundText = "";
      const sessionManager = getSessionContextManager();
      let newContext = { conversationId: "", responseId: "", choiceId: "" };
      for (const line of responseText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(")]}'") || /^\d+$/.test(trimmed)) continue;
        try {
          const parsedCtx = sessionManager.parseFromFetchResponse(line);
          if (parsedCtx.conversationId) newContext.conversationId = parsedCtx.conversationId;
          if (parsedCtx.responseId) newContext.responseId = parsedCtx.responseId;
          if (parsedCtx.choiceId) newContext.choiceId = parsedCtx.choiceId;
          const dataObj = JSON.parse(trimmed);
          if (!Array.isArray(dataObj)) continue;
          for (const payloadItem of dataObj) {
            if (Array.isArray(payloadItem) && payloadItem.length >= 3 && payloadItem[0] === "wrb.fr") {
              const innerData = JSON.parse(payloadItem[2]);
              const candidates = innerData[4];
              if (Array.isArray(candidates) && candidates.length > 0) {
                const candidate = candidates[0];
                if (candidate && candidate.length > 1) {
                  const textSource = candidate[1];
                  const txt = Array.isArray(textSource) ? textSource[0] : textSource;
                  if (typeof txt === "string" && txt && txt.length > foundText.length) {
                    foundText = txt;
                  }
                }
              }
            }
          }
        } catch (e) {
        }
      }
      if (foundText) {
        const contextWasParsed = !!(newContext.conversationId || newContext.responseId || newContext.choiceId);
        if (!contextWasParsed && effectiveContext) {
          console.warn("[GeminiChatService] ⚠️ Impit: Không parse được context mới từ response, dùng context cũ");
        }
        if (!newContext.conversationId && effectiveContext) newContext.conversationId = effectiveContext.conversationId;
        if (!newContext.responseId && effectiveContext) newContext.responseId = effectiveContext.responseId;
        if (!newContext.choiceId && effectiveContext) newContext.choiceId = effectiveContext.choiceId;
        console.log(`[GeminiChatService] Impit: Nhận phản hồi thành công (${foundText.length} ký tự)`);
        const contextSummary2 = {
          conversationId: newContext.conversationId ? `${String(newContext.conversationId).slice(0, 24)}...` : "",
          responseIdLength: newContext.responseId ? String(newContext.responseId).length : 0,
          choiceId: newContext.choiceId ? `${String(newContext.choiceId).slice(0, 24)}...` : "",
          parsedFromResponse: contextWasParsed
        };
        console.log("[GeminiChatService] Impit: Ngữ cảnh (tóm tắt):", contextSummary2);
        this.saveContext(newContext, config.id);
        this.firstSendByTokenKey.add(tokenKey);
        return {
          success: true,
          data: {
            text: foundText,
            context: newContext
          },
          configId: config.id
        };
      }
      return { success: false, error: "No text found in Impit response", configId: config.id };
    } catch (error) {
      console.error("[GeminiChatService] Impit Error:", error);
      return { success: false, error: String(error), configId: config?.id };
    }
  }
  // ... (existing code)
}
const GeminiChatService = GeminiChatServiceClass.getInstance();
class StoryService {
  /**
   * Translates a chapter using prepared prompt and Gemini API
   * Method: 'API' (Google Gemini API) hoặc 'IMPIT' (Web scraping qua impit)
   */
  static async translateChapter(options) {
    try {
      console.log("[StoryService] Starting translation...", options.method || "API", options.model || "default");
      if (options.method === "IMPIT") {
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
        const webConfigId = options.webConfigId?.trim() || "";
        console.log("[StoryService] Using IMPIT for translation...");
        const result = await GeminiChatService.sendMessageImpit(promptText, webConfigId, options.context, options.useProxy, options.metadata);
        if (result.success && result.data) {
          console.log("[StoryService] Translation completed.");
          const ctx = result.data.context;
          if (ctx && (ctx.conversationId || ctx.responseId)) {
            console.log(`[StoryService] Context updated: convId=${ctx.conversationId ? ctx.conversationId.slice(0, 20) + "..." : "(empty)"}, respId length=${ctx.responseId ? ctx.responseId.length : 0}`);
          } else {
            console.warn("[StoryService] ⚠️ Response context is empty - context may not be updated properly");
          }
          return {
            success: true,
            data: result.data.text,
            context: result.data.context,
            // Return new context
            configId: result.configId,
            metadata: result.metadata
          };
        } else {
          return { success: false, error: result.error || "Gemini Web Error", configId: result.configId, metadata: result.metadata, retryable: result.retryable };
        }
      } else {
        const modelToUse = options.model || GEMINI_MODELS.FLASH_3_0;
        const result = await callGeminiWithRotation(
          options.prompt,
          modelToUse
        );
        if (result.success) {
          return { success: true, data: result.data, metadata: options.metadata };
        } else {
          return { success: false, error: result.error, metadata: options.metadata };
        }
      }
    } catch (error) {
      console.error("[StoryService] Error translating chapter:", error);
      return { success: false, error: String(error), metadata: options.metadata };
    }
  }
  /**
   * Prepares the translation prompt by fetching the appropriate prompt from the database
   * and injecting the chapter content.
   */
  static async prepareTranslationPrompt(chapterContent, sourceLang, targetLang) {
    try {
      let matchingPrompt;
      const appSettings = AppSettingsService.getAll();
      if (appSettings.translationPromptId) {
        matchingPrompt = PromptService.getById(appSettings.translationPromptId);
        if (!matchingPrompt) {
          console.warn(`[StoryService] Configured translation prompt "${appSettings.translationPromptId}" not found, falling back to auto-detect`);
        }
      }
      if (!matchingPrompt) {
        const prompts = PromptService.getAll();
        matchingPrompt = prompts.find(
          (p) => p.sourceLang === sourceLang && p.targetLang === targetLang && p.isDefault
        ) || prompts.find(
          (p) => p.sourceLang === sourceLang && p.targetLang === targetLang
        );
      }
      if (!matchingPrompt) {
        return {
          success: false,
          error: `No translation prompt found for ${sourceLang} -> ${targetLang}`
        };
      }
      return this.injectContentIntoPrompt(matchingPrompt.content, chapterContent);
    } catch (error) {
      console.error("Error preparing translation prompt:", error);
      return { success: false, error: String(error) };
    }
  }
  /**
   * Prepares the summary prompt by fetching the appropriate summary prompt from the database
   * and injecting the chapter content.
   */
  static async prepareSummaryPrompt(chapterContent, sourceLang, targetLang) {
    try {
      let matchingPrompt;
      const appSettings = AppSettingsService.getAll();
      if (appSettings.summaryPromptId) {
        matchingPrompt = PromptService.getById(appSettings.summaryPromptId);
        if (!matchingPrompt) {
          console.warn(`[StoryService] Configured summary prompt "${appSettings.summaryPromptId}" not found, falling back to auto-detect`);
        }
      }
      if (!matchingPrompt) {
        const prompts = PromptService.getAll();
        matchingPrompt = prompts.find(
          (p) => p.sourceLang === sourceLang && p.targetLang === targetLang && (p.name.includes("[SUMMARY]") || p.name.toLowerCase().includes("tóm tắt"))
        );
      }
      if (!matchingPrompt) {
        return {
          success: false,
          error: `Không tìm thấy prompt tóm tắt cho ${sourceLang} -> ${targetLang}. Vui lòng chọn prompt trong Settings.`
        };
      }
      return this.injectContentIntoPrompt(matchingPrompt.content, chapterContent);
    } catch (error) {
      console.error("Error preparing summary prompt:", error);
      return { success: false, error: String(error) };
    }
  }
  /**
   * Helper function to inject content into prompt template
   */
  static injectContentIntoPrompt(promptContent, chapterContent) {
    try {
      let promptData;
      try {
        promptData = JSON.parse(promptContent);
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
      console.error("Error injecting content into prompt:", error);
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
      let coverPath = cover;
      let tempCoverPath = void 0;
      if (!coverPath) {
        const coverBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
        tempCoverPath = path2.join(os.tmpdir(), `cover_${Date.now()}.png`);
        fs2.writeFileSync(tempCoverPath, coverBuffer);
        coverPath = tempCoverPath;
      }
      const metadata = {
        id: safeTitle,
        title,
        author: author || "AI Translator",
        cover: coverPath
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
          if (tempCoverPath && fs2.existsSync(tempCoverPath)) {
            fs2.unlinkSync(tempCoverPath);
          }
          resolve({ success: true, filePath: finalPath });
        } catch (e) {
          if (tempCoverPath && fs2.existsSync(tempCoverPath)) {
            try {
              fs2.unlinkSync(tempCoverPath);
            } catch {
            }
          }
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
  PREPARE_SUMMARY_PROMPT: "story:prepareSummaryPrompt",
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
const PROXY_IPC_CHANNELS = {
  GET_ALL: "proxy:getAll",
  ADD: "proxy:add",
  REMOVE: "proxy:remove",
  UPDATE: "proxy:update",
  TEST: "proxy:test",
  CHECK_ALL: "proxy:checkAll",
  GET_STATS: "proxy:getStats",
  IMPORT: "proxy:import",
  EXPORT: "proxy:export",
  RESET: "proxy:reset"
  // Reset failed counts
};
const PROJECT_IPC_CHANNELS = {
  OPEN: "project:open",
  CREATE_AND_OPEN: "project:createAndOpen",
  SCAN_PROJECTS: "project:scanProjects",
  GET_METADATA: "project:getMetadata",
  GET_RESOLVED_PATHS: "project:getResolvedPaths",
  READ_FEATURE_FILE: "project:readFeatureFile",
  WRITE_FEATURE_FILE: "project:writeFeatureFile",
  GET_PROJECTS_PATH: "project:getProjectsPath",
  SET_PROJECTS_PATH: "project:setProjectsPath"
};
function registerStoryHandlers() {
  console.log("[StoryHandlers] Đăng ký handlers...");
  electron.ipcMain.removeHandler("dialog:showSaveDialog");
  electron.ipcMain.handle(
    "dialog:showSaveDialog",
    async (_event, options) => {
      const result = await electron.dialog.showSaveDialog({
        title: options?.title,
        defaultPath: options?.defaultPath,
        filters: options?.filters || [{ name: "All Files", extensions: ["*"] }]
      });
      return result;
    }
  );
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
    STORY_IPC_CHANNELS.PREPARE_SUMMARY_PROMPT,
    async (_event, { chapterContent, sourceLang, targetLang }) => {
      console.log(`[StoryHandlers] Prepare summary prompt: ${sourceLang} -> ${targetLang}`);
      return await StoryService.prepareSummaryPrompt(chapterContent, sourceLang, targetLang);
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
let dashboardWindow = null;
const editorWindows = /* @__PURE__ */ new Map();
function buildRendererUrl(route, params) {
  const search = params ? new URLSearchParams(params).toString() : "";
  const hashPath = route.startsWith("/") ? route : `/${route}`;
  const hash = search ? `${hashPath}?${search}` : hashPath;
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    return `${process.env["ELECTRON_RENDERER_URL"]}#${hash}`;
  }
  const filePath = path.join(__dirname, "../renderer/index.html");
  return `file://${filePath}#${hash}`;
}
function createBaseWindow() {
  return new electron.BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
}
function attachCommonHandlers(win) {
  win.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
}
function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return dashboardWindow;
  }
  dashboardWindow = createBaseWindow();
  attachCommonHandlers(dashboardWindow);
  dashboardWindow.on("ready-to-show", () => {
    dashboardWindow?.maximize();
    dashboardWindow?.show();
  });
  const url = buildRendererUrl("/projects");
  dashboardWindow.loadURL(url);
  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
  });
  console.log("[Cửa sổ] Đã mở Dashboard");
  return dashboardWindow;
}
function createEditorWindow(projectId) {
  const editorWindow = createBaseWindow();
  attachCommonHandlers(editorWindow);
  editorWindow.on("ready-to-show", () => {
    editorWindow.maximize();
    editorWindow.show();
  });
  const url = buildRendererUrl("story-translator", { projectId });
  editorWindow.loadURL(url);
  editorWindow.on("closed", () => {
    editorWindows.delete(projectId);
    if (!dashboardWindow || dashboardWindow.isDestroyed()) {
      createDashboardWindow();
    }
  });
  editorWindows.set(projectId, editorWindow);
  console.log(`[Cửa sổ] Đã mở Editor cho project ${projectId}`);
  return editorWindow;
}
const PROJECT_FILE = "project.json";
const DEFAULT_PROJECT_PATHS = {
  story: "story",
  caption: "caption",
  tts: "tts",
  gemini: "gemini-chat"
};
function getProjectsBasePathOrThrow() {
  const basePath = AppSettingsService.getProjectsBasePath();
  if (!basePath) {
    throw new Error("Chưa cấu hình thư mục Projects trong Settings");
  }
  return basePath;
}
function readProjectMetadata(projectId) {
  const basePath = getProjectsBasePathOrThrow();
  const projectPath = path__namespace.join(basePath, projectId);
  const metadataPath = path__namespace.join(projectPath, PROJECT_FILE);
  if (!fs__namespace.existsSync(metadataPath)) {
    throw new Error("Không tìm thấy project.json");
  }
  const content = fs__namespace.readFileSync(metadataPath, "utf-8");
  const metadata = JSON.parse(content);
  if (!metadata.paths) {
    metadata.paths = { ...DEFAULT_PROJECT_PATHS };
    fs__namespace.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  }
  return metadata;
}
function resolveProjectPaths(projectId) {
  const basePath = getProjectsBasePathOrThrow();
  const metadata = readProjectMetadata(projectId);
  const projectRoot = path__namespace.join(basePath, projectId);
  return {
    root: projectRoot,
    story: path__namespace.join(projectRoot, metadata.paths.story),
    caption: path__namespace.join(projectRoot, metadata.paths.caption),
    tts: path__namespace.join(projectRoot, metadata.paths.tts),
    gemini: path__namespace.join(projectRoot, metadata.paths.gemini)
  };
}
function scanProjects(basePath) {
  try {
    if (!fs__namespace.existsSync(basePath)) {
      console.log("[ProjectHandlers] Thư mục projects không tồn tại:", basePath);
      return [];
    }
    const entries = fs__namespace.readdirSync(basePath, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path__namespace.join(basePath, entry.name);
      const metadataPath = path__namespace.join(projectPath, PROJECT_FILE);
      if (fs__namespace.existsSync(metadataPath)) {
        try {
          const content = fs__namespace.readFileSync(metadataPath, "utf-8");
          const metadata = JSON.parse(content);
          if (!metadata.paths) {
            metadata.paths = { ...DEFAULT_PROJECT_PATHS };
          }
          projects.push(metadata);
        } catch (err) {
          console.error(`[ProjectHandlers] Lỗi đọc metadata của project ${entry.name}:`, err);
        }
      }
    }
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error("[ProjectHandlers] Lỗi quét thư mục projects:", error);
    return [];
  }
}
function createProject(basePath, projectName) {
  try {
    const projectId = projectName.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    const projectPath = path__namespace.join(basePath, projectId);
    if (fs__namespace.existsSync(projectPath)) {
      throw new Error("Project đã tồn tại");
    }
    fs__namespace.mkdirSync(projectPath, { recursive: true });
    const featureFolders = Object.values(DEFAULT_PROJECT_PATHS);
    for (const folderName of featureFolders) {
      const featurePath = path__namespace.join(projectPath, folderName);
      fs__namespace.mkdirSync(featurePath, { recursive: true });
    }
    const metadata = {
      id: projectId,
      name: projectName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      paths: { ...DEFAULT_PROJECT_PATHS }
    };
    const metadataPath = path__namespace.join(projectPath, PROJECT_FILE);
    fs__namespace.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    console.log("[ProjectHandlers] Đã tạo project:", projectId);
    return metadata;
  } catch (error) {
    console.error("[ProjectHandlers] Lỗi tạo project:", error);
    return null;
  }
}
function registerProjectHandlers() {
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.GET_METADATA, async (_event, projectId) => {
    try {
      if (!projectId) {
        return { success: false, error: "Thiếu projectId" };
      }
      const metadata = readProjectMetadata(projectId);
      return { success: true, data: metadata };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.GET_RESOLVED_PATHS, async (_event, projectId) => {
    try {
      if (!projectId) {
        return { success: false, error: "Thiếu projectId" };
      }
      const paths = resolveProjectPaths(projectId);
      return { success: true, data: paths };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(
    PROJECT_IPC_CHANNELS.READ_FEATURE_FILE,
    async (_event, payload) => {
      try {
        const { projectId, feature, fileName } = payload;
        if (!projectId || !feature || !fileName) {
          return { success: false, error: "Thiếu tham số" };
        }
        const metadata = readProjectMetadata(projectId);
        const basePath = getProjectsBasePathOrThrow();
        const projectRoot = path__namespace.join(basePath, projectId);
        const featureDir = path__namespace.join(projectRoot, metadata.paths[feature]);
        const filePath = path__namespace.join(featureDir, fileName);
        if (!fs__namespace.existsSync(filePath)) {
          return { success: true, data: null };
        }
        const content = fs__namespace.readFileSync(filePath, "utf-8");
        return { success: true, data: content };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROJECT_IPC_CHANNELS.WRITE_FEATURE_FILE,
    async (_event, payload) => {
      try {
        const { projectId, feature, fileName, content } = payload;
        if (!projectId || !feature || !fileName) {
          return { success: false, error: "Thiếu tham số" };
        }
        const metadata = readProjectMetadata(projectId);
        const basePath = getProjectsBasePathOrThrow();
        const projectRoot = path__namespace.join(basePath, projectId);
        const featureDir = path__namespace.join(projectRoot, metadata.paths[feature]);
        const filePath = path__namespace.join(featureDir, fileName);
        if (!fs__namespace.existsSync(featureDir)) {
          fs__namespace.mkdirSync(featureDir, { recursive: true });
        }
        const dataToWrite = typeof content === "string" ? content : JSON.stringify(content, null, 2);
        fs__namespace.writeFileSync(filePath, dataToWrite, "utf-8");
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.OPEN, async (event, projectId) => {
    try {
      if (!projectId) {
        console.error("[Lỗi] Thiếu projectId để mở project");
        return { success: false, error: "Thiếu projectId để mở project" };
      }
      createEditorWindow(projectId);
      AppSettingsService.addRecentProject(projectId);
      const currentWin = electron.BrowserWindow.fromWebContents(event.sender);
      if (currentWin) {
        currentWin.close();
      }
      console.log(`[Hệ thống] Đã mở project ${projectId} và đóng Dashboard`);
      return { success: true };
    } catch (error) {
      console.error("[Lỗi] Không thể chuyển đổi cửa sổ:", error);
      return { success: false, error: "Chuyển đổi cửa sổ thất bại" };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.CREATE_AND_OPEN, async (event, projectName) => {
    try {
      if (!projectName || !projectName.trim()) {
        return { success: false, error: "Thiếu tên project" };
      }
      const basePath = AppSettingsService.getProjectsBasePath();
      if (!basePath) {
        return { success: false, error: "Chưa cấu hình thư mục Projects trong Settings" };
      }
      const metadata = createProject(basePath, projectName.trim());
      if (!metadata) {
        return { success: false, error: "Không thể tạo project" };
      }
      createEditorWindow(metadata.id);
      AppSettingsService.setLastActiveProjectId(metadata.id);
      const currentWin = electron.BrowserWindow.fromWebContents(event.sender);
      if (currentWin) {
        currentWin.close();
      }
      console.log(`[Hệ thống] Đã tạo và mở project ${metadata.id}`);
      return { success: true, data: metadata };
    } catch (error) {
      console.error("[Lỗi] Không thể tạo và mở project:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.SCAN_PROJECTS, async () => {
    try {
      const basePath = AppSettingsService.getProjectsBasePath();
      if (!basePath) {
        return { success: true, data: [] };
      }
      const projects = scanProjects(basePath);
      return { success: true, data: projects };
    } catch (error) {
      console.error("[Lỗi] Không thể quét projects:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.GET_PROJECTS_PATH, async () => {
    try {
      const basePath = AppSettingsService.getProjectsBasePath();
      return { success: true, data: basePath };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(PROJECT_IPC_CHANNELS.SET_PROJECTS_PATH, async (event, newPath) => {
    try {
      AppSettingsService.setProjectsBasePath(newPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
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
  CHECK_DUPLICATE_TOKEN: "geminiChat:checkDuplicateToken",
  // Cookie Config (bảng riêng)
  GET_COOKIE_CONFIG: "geminiChat:getCookieConfig",
  SAVE_COOKIE_CONFIG: "geminiChat:saveCookieConfig",
  // Impit Browser Management
  GET_MAX_IMPIT_BROWSERS: "geminiChat:getMaxImpitBrowsers",
  RELEASE_ALL_IMPIT_BROWSERS: "geminiChat:releaseAllImpitBrowsers"
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
  electron.ipcMain.handle(CHANNELS.GET_COOKIE_CONFIG, async () => {
    try {
      const config = GeminiChatService.getCookieConfig();
      return { success: true, data: config };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi getCookieConfig:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.SAVE_COOKIE_CONFIG, async (_, data) => {
    try {
      const success = GeminiChatService.saveCookieConfig(data);
      return { success, data: null };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi saveCookieConfig:", error);
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
  electron.ipcMain.handle(CHANNELS.CHECK_DUPLICATE_TOKEN, async (_, payload) => {
    try {
      const result = GeminiChatService.checkDuplicateToken(payload.cookie, payload.atToken, payload.excludeId);
      return { success: true, data: result };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi checkDuplicateToken:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.GET_MAX_IMPIT_BROWSERS, async () => {
    try {
      return { success: true, data: GeminiChatService.getMaxImpitBrowserCount() };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi getMaxImpitBrowsers:", error);
      return { success: false, error: String(error) };
    }
  });
  electron.ipcMain.handle(CHANNELS.RELEASE_ALL_IMPIT_BROWSERS, async () => {
    try {
      GeminiChatService.releaseAllImpitBrowsers();
      return { success: true };
    } catch (error) {
      console.error("[GeminiChatHandlers] Loi releaseAllImpitBrowsers:", error);
      return { success: false, error: String(error) };
    }
  });
  console.log("[GeminiChatHandlers] Da dang ky handlers thanh cong");
}
function registerProxyHandlers() {
  console.log("[ProxyHandlers] Đăng ký handlers...");
  const manager = getProxyManager();
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.GET_ALL,
    async () => {
      try {
        const proxies = manager.getAllProxies();
        const maskedProxies = proxies.map((p) => ({
          ...p,
          password: p.password ? "***MASKED***" : void 0
        }));
        return { success: true, data: maskedProxies };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi get all proxies:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.ADD,
    async (_event, config) => {
      try {
        console.log(`[ProxyHandlers] Thêm proxy: ${config.host}:${config.port}`);
        const newProxy = manager.addProxy(config);
        const maskedProxy = {
          ...newProxy,
          password: newProxy.password ? "***MASKED***" : void 0
        };
        return { success: true, data: maskedProxy };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi add proxy:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.REMOVE,
    async (_event, proxyId) => {
      try {
        console.log(`[ProxyHandlers] Xóa proxy: ${proxyId}`);
        const removed = manager.removeProxy(proxyId);
        if (removed) {
          return { success: true };
        } else {
          return { success: false, error: "Proxy không tồn tại" };
        }
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi remove proxy:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.UPDATE,
    async (_event, proxyId, updates) => {
      try {
        console.log(`[ProxyHandlers] Cập nhật proxy: ${proxyId}`);
        const updated = manager.updateProxy(proxyId, updates);
        if (updated) {
          return { success: true };
        } else {
          return { success: false, error: "Proxy không tồn tại" };
        }
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi update proxy:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.TEST,
    async (_event, proxyId) => {
      try {
        console.log(`[ProxyHandlers] Test proxy: ${proxyId}`);
        const result = await manager.testProxy(proxyId);
        return {
          success: result.success,
          latency: result.latency,
          error: result.error,
          testedAt: Date.now()
        };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi test proxy:", error);
        return {
          success: false,
          error: String(error),
          testedAt: Date.now()
        };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.CHECK_ALL,
    async () => {
      try {
        console.log("[ProxyHandlers] Check all proxies...");
        const result = await manager.checkAllProxies("https://generativelanguage.googleapis.com");
        return { success: true, ...result };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi check all proxies:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.GET_STATS,
    async () => {
      try {
        const stats = manager.getStats();
        return { success: true, data: stats };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi get stats:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.IMPORT,
    async (_event, data) => {
      try {
        console.log("[ProxyHandlers] Import proxies...");
        const result = manager.importProxies(data);
        return { success: true, ...result };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi import proxies:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.EXPORT,
    async () => {
      try {
        console.log("[ProxyHandlers] Export proxies...");
        const data = manager.exportProxies();
        return { success: true, data };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi export proxies:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    "proxy:bulkImportWebshare",
    async (_event, text) => {
      try {
        console.log("[ProxyHandlers] Bulk import Webshare proxies...");
        const { parseWebshareProxies } = await Promise.resolve().then(() => require("./chunks/webshareParser-jlBvLl5E.js"));
        const proxiesToAdd = parseWebshareProxies(text);
        if (proxiesToAdd.length === 0) {
          return { success: false, error: "Không parse được proxy nào từ input" };
        }
        let added = 0;
        let skipped = 0;
        for (const proxyConfig of proxiesToAdd) {
          const allProxies = manager.getAllProxies();
          const exists = allProxies.some((p) => p.host === proxyConfig.host && p.port === proxyConfig.port);
          if (exists) {
            skipped++;
            continue;
          }
          manager.addProxy(proxyConfig);
          added++;
        }
        console.log(`[ProxyHandlers] Bulk import complete: ${added} added, ${skipped} skipped`);
        return { success: true, added, skipped };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi bulk import Webshare:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    "proxy:quickAddWebshare",
    async () => {
      try {
        console.log("[ProxyHandlers] Quick add Webshare free proxies...");
        const { getWebshareFreeProxies } = await Promise.resolve().then(() => require("./chunks/webshareParser-jlBvLl5E.js"));
        const proxiesToAdd = getWebshareFreeProxies();
        let added = 0;
        for (const proxyConfig of proxiesToAdd) {
          const allProxies = manager.getAllProxies();
          const exists = allProxies.some((p) => p.host === proxyConfig.host && p.port === proxyConfig.port);
          if (exists) {
            continue;
          }
          manager.addProxy(proxyConfig);
          added++;
        }
        console.log(`[ProxyHandlers] Quick add complete: ${added} proxies added`);
        return { success: true, added };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi quick add Webshare:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  electron.ipcMain.handle(
    PROXY_IPC_CHANNELS.RESET,
    async () => {
      try {
        console.log("[ProxyHandlers] Reset all proxies...");
        manager.resetAllFailedCounts();
        return { success: true };
      } catch (error) {
        console.error("[ProxyHandlers] Lỗi reset proxies:", error);
        return { success: false, error: String(error) };
      }
    }
  );
  console.log("[ProxyHandlers] Đã đăng ký handlers thành công");
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
  registerProxyHandlers();
  console.log("[IPC] Da dang ky xong tat ca handlers");
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
  createDashboardWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createDashboardWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
exports.getProxyManager = getProxyManager;
