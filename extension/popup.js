// popup.js - Subtitle batch translator

// ============================================
// DOM ELEMENTS
// ============================================
const DOM = {
  // Inputs
  promptInput: null,
  batchLimitInput: null,
  fileInput: null,
  copyOnlyMode: null,

  // Buttons
  btnStart: null,
  btnStop: null,
  btnDownload: null,
  btnClear: null,

  // Sections
  fileListContainer: null,
  alwaysOnTopSection: null,

  // Status displays
  fileStatus: null,
  statusLog: null,
  fileList: null,
  fileSummary: null,

  init() {
    this.promptInput = document.getElementById("promptTemplate");
    this.batchLimitInput = document.getElementById("batchLimit");
    this.fileInput = document.getElementById("fileInput");
    this.copyOnlyMode = document.getElementById("copyOnlyMode");

    this.btnStart = document.getElementById("btnStart");
    this.btnStop = document.getElementById("btnStop");
    this.btnDownload = document.getElementById("btnDownload");
    this.btnClear = document.getElementById("btnClear");

    this.fileListContainer = document.getElementById("fileListContainer");
    this.alwaysOnTopSection = document.getElementById("alwaysOnTopSection");

    this.fileStatus = document.getElementById("fileStatus");
    this.statusLog = document.getElementById("statusLog");
    this.fileList = document.getElementById("fileList");
    this.fileSummary = document.getElementById("fileSummary");
  }
};

// ============================================
// UI MANAGER
// ============================================
const UIManager = {
  setStatus(message, color = null) {
    DOM.statusLog.textContent = message;
    if (color) {
      DOM.statusLog.style.color = color;
    }
  },

  setFileStatus(message, color = null) {
    DOM.fileStatus.textContent = message;
    if (color) {
      DOM.fileStatus.style.color = color;
    }
  },

  displayFileList(batchFiles) {
    if (!batchFiles || batchFiles.length === 0) {
      DOM.fileListContainer.style.display = 'none';
      return;
    }

    DOM.fileListContainer.style.display = 'block';
    DOM.fileList.innerHTML = batchFiles.map((bf, idx) =>
      `<div class="file-item">#${idx + 1}: ${bf.name} (${bf.lines.length} dòng)</div>`
    ).join('');
    DOM.fileSummary.textContent = `Tổng batch: ${batchFiles.length}`;
  }
};

// ============================================
// STORAGE MANAGER
// ============================================
const StorageManager = {
  async loadSettings() {
    return await chrome.storage.local.get([
      'promptTemplate',
      'isRunning',
      'batchLimit',
      'batchCount',
      'batchFiles',
      'totalBatches',
      'currentBatchIndex',
      'copyOnlyMode',
      'alwaysOnTop'
    ]);
  },

  async saveSettings(settings) {
    await chrome.storage.local.set(settings);
  },

  async saveBatchFiles(batchFiles) {
    await chrome.storage.local.set({
      batchFiles: batchFiles,
      totalBatches: batchFiles.length,
      currentBatchIndex: 0
    });
  }
};

// ============================================
// HELPERS
// ============================================
function parseLinesFromText(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

// ============================================
// EVENT HANDLERS
// ============================================
const EventHandlers = {
  async onFileSelect(fileList) {
    if (!fileList || fileList.length === 0) return;

    try {
      const files = Array.from(fileList);
      const batchFiles = [];

      for (const file of files) {
        const text = await file.text();
        const lines = parseLinesFromText(text);
        batchFiles.push({
          name: file.name,
          lines: lines
        });
      }

      await StorageManager.saveBatchFiles(batchFiles);

      UIManager.setFileStatus(`✓ Đã chọn ${batchFiles.length} file`, '#4CAF50');
      UIManager.displayFileList(batchFiles);

      // Auto set batch limit if user chưa chỉnh
      if (!DOM.batchLimitInput.dataset.userSet) {
        DOM.batchLimitInput.value = batchFiles.length;
      }

    } catch (error) {
      UIManager.setFileStatus(`❌ Lỗi đọc file: ${error.message}`, '#f44336');
      console.error("Lỗi đọc file:", error);
    }
  },

  async onStart() {
    const template = DOM.promptInput.value;
    const batchLimit = parseInt(DOM.batchLimitInput.value) || 1;
    const alwaysOnTop = document.getElementById("alwaysOnTop").checked;
    const copyOnly = DOM.copyOnlyMode.checked;

    const data = await StorageManager.loadSettings();
    if (!data.batchFiles || data.batchFiles.length === 0) {
      UIManager.setStatus("⚠️ Chưa chọn batch file .txt", "#ff9800");
      return;
    }

    const settings = {
      promptTemplate: template,
      batchLimit: batchLimit,
      isRunning: true,
      batchCount: 0,
      currentBatchIndex: 0,
      alwaysOnTop: alwaysOnTop,
      copyOnlyMode: copyOnly
    };

    await StorageManager.saveSettings({
      ...settings,
      translatedBatches: []
    });

    if (alwaysOnTop && !copyOnly) {
      const pipSuccess = await PiPManager.openPiP();
      if (!pipSuccess) return;
    }

    chrome.runtime.sendMessage({ action: "START_PROCESS" });
    UIManager.setStatus(`Trạng thái: Đang khởi động (dịch ${batchLimit} batch)...`);
  },

  onStop() {
    chrome.storage.local.set({ isRunning: false });
    chrome.runtime.sendMessage({ action: "STOP_PROCESS" });
    UIManager.setStatus("Trạng thái: Đã dừng.");
  },

  onDownload() {
    chrome.runtime.sendMessage({ action: "DOWNLOAD_FULL" });
    UIManager.setStatus("Đang tải JSONL...");
  },

  onClear() {
    if (confirm("Bạn có chắc muốn xóa toàn bộ dữ liệu đã dịch trước đó không?")) {
      chrome.runtime.sendMessage({ action: "CLEAR_DATA" });
      UIManager.setStatus("Đã xóa dữ liệu cũ.");
    }
  }
};

// ============================================
// PIP MANAGER
// ============================================
const PiPManager = {
  async openPiP() {
    try {
      UIManager.setStatus("Đang mở PiP window...");

      const tabs = await chrome.tabs.query({});
      const geminiTab = tabs.find(t => t.url && t.url.includes("gemini.google.com"));

      if (!geminiTab) {
        UIManager.setStatus("⚠️ Không tìm thấy tab Gemini!", "#ff9800");
        document.getElementById("alwaysOnTop").checked = false;
        await StorageManager.saveSettings({ alwaysOnTop: false });
        return false;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: geminiTab.id },
          files: ['pip-script.js']
        });
      } catch (e) {
        console.log("PiP script đã có sẵn");
      }

      await new Promise(r => setTimeout(r, 500));

      const response = await chrome.tabs.sendMessage(geminiTab.id, {
        action: "OPEN_PIP"
      });

      if (response && response.status === "OK") {
        UIManager.setStatus("✓ PiP window đã mở! (Tự động Always On Top)");
        await new Promise(r => setTimeout(r, 1000));
        return true;
      } else if (response && response.status === "ERROR") {
        if (response.message.includes("conversation")) {
          UIManager.setStatus("⚠️ Vui lòng mở một conversation trong Gemini trước!", "#ff9800");
        } else {
          UIManager.setStatus("⚠️ Lỗi: " + response.message);
        }

        document.getElementById("alwaysOnTop").checked = false;
        await StorageManager.saveSettings({ alwaysOnTop: false });
        return false;
      }
    } catch (e) {
      console.error("Lỗi mở PiP:", e);
      UIManager.setStatus("⚠️ Lỗi mở PiP: " + e.message, "#f44336");
      document.getElementById("alwaysOnTop").checked = false;
      await StorageManager.saveSettings({ alwaysOnTop: false });
      return false;
    }
  }
};

// ============================================
// INITIALIZATION
// ============================================
async function initializePopup() {
  DOM.init();

  const result = await StorageManager.loadSettings();

  if (result.promptTemplate) {
    DOM.promptInput.value = result.promptTemplate;
  }

  if (result.batchLimit) {
    DOM.batchLimitInput.value = result.batchLimit;
  }

  if (result.isRunning) {
    UIManager.setStatus("Trạng thái: Đang chạy...");
  }

  if (result.alwaysOnTop !== undefined) {
    document.getElementById("alwaysOnTop").checked = result.alwaysOnTop;
  }

  if (result.copyOnlyMode !== undefined) {
    DOM.copyOnlyMode.checked = result.copyOnlyMode;
  }

  if (result.batchFiles && result.batchFiles.length > 0) {
    UIManager.setFileStatus(`File đã chọn: ${result.batchFiles.length}`, '#4CAF50');
    UIManager.displayFileList(result.batchFiles);
  }

  setupEventListeners();
}

function setupEventListeners() {
  DOM.fileInput.addEventListener("change", async (e) => {
    const files = e.target.files;
    await EventHandlers.onFileSelect(files);
  });

  DOM.batchLimitInput.addEventListener("input", () => {
    DOM.batchLimitInput.dataset.userSet = 'true';
  });

  DOM.btnStart.addEventListener("click", () => EventHandlers.onStart());
  DOM.btnStop.addEventListener("click", () => EventHandlers.onStop());
  DOM.btnDownload.addEventListener("click", () => EventHandlers.onDownload());
  DOM.btnClear.addEventListener("click", () => EventHandlers.onClear());
}

// ============================================
// START
// ============================================
document.addEventListener("DOMContentLoaded", initializePopup);
