// popup.js - Subtitle batch translator

// ============================================
// DOM ELEMENTS
// ============================================
const DOM = {
  // Inputs
  modeFile: null,
  modeFolder: null,
  fileInputWrapper: null,
  folderInputWrapper: null,
  folderInput: null,
  batchLimitInput: null,
  promptDelayInput: null,
  fileInput: null,
  copyOnlyMode: null,
  providerSelect: null,

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
    this.modeFile = document.getElementById("modeFile");
    this.modeFolder = document.getElementById("modeFolder");
    this.fileInputWrapper = document.getElementById("fileInputWrapper");
    this.folderInputWrapper = document.getElementById("folderInputWrapper");
    this.folderInput = document.getElementById("folderInput");

    this.batchLimitInput = document.getElementById("batchLimit");
    this.promptDelayInput = document.getElementById("promptDelay");
    this.fileInput = document.getElementById("fileInput");
    this.copyOnlyMode = document.getElementById("copyOnlyMode");
    this.providerSelect = document.getElementById("providerSelect");

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
    const completedCount = batchFiles.filter(f => f.completed).length;
    const errorCount = batchFiles.filter(f => f.status === 'error').length;
    const badgeLabel = {
      pending: '⏳ Chờ',
      translating: '🔄 Đang dịch',
      done: '✅ Xong',
      error: '❌ Lỗi'
    };
    DOM.fileList.innerHTML = batchFiles.map((bf, idx) => {
      const st = bf.status || (bf.completed ? 'done' : 'pending');
      const projectTag = bf.projectName && bf.projectName !== "Mixed_Files" ? `[${bf.projectName}] ` : "";
      return `<div class="file-item">
        <span class="file-name" title="${bf.name}">#${idx + 1}: ${projectTag}${bf.name}</span>
        <span class="file-badge badge-${st}">${badgeLabel[st] || '⏳ Chờ'}</span>
      </div>`;
    }).join('');
    DOM.fileSummary.textContent = `Tổng: ${batchFiles.length} | ✅ ${completedCount} | ❌ ${errorCount} | ⏳ ${batchFiles.length - completedCount - errorCount}`;
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
      'alwaysOnTop',
      'provider'
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
  async onFolderSelect(fileList) {
    if (!fileList || fileList.length === 0) return;

    try {
      // Lọc ra các file txt nằm trong "/caption_output/text/"
      const files = Array.from(fileList).filter(f => {
         const path = f.webkitRelativePath || "";
         return path.match(/\/caption_output\/text\/.*\.txt$/i);
      });

      if (files.length === 0) {
        UIManager.setFileStatus(`⚠️ Không tìm thấy file .txt nào theo chuẩn [dự án]/caption_output/text/`, '#ff9800');
        return;
      }

      const data = await chrome.storage.local.get(['batchFiles']);
      const existingBatchFiles = data.batchFiles || [];
      const newBatchFiles = [];

      for (const file of files) {
        // Tách path để lấy tên thư mục dự án
        const pathParts = file.webkitRelativePath.split('/');
        const captionIdx = pathParts.findIndex(p => p === 'caption_output');
        const projectName = captionIdx > 0 ? pathParts[captionIdx - 1] : "Unknown_Project";

        const text = await file.text();
        const lines = parseLinesFromText(text);
        
        newBatchFiles.push({
          name: file.name,
          projectName: projectName,
          lines: lines,
          completed: false,
          status: 'pending'
        });
      }

      const combinedBatchFiles = [...existingBatchFiles, ...newBatchFiles];
      await StorageManager.saveBatchFiles(combinedBatchFiles);

      UIManager.setFileStatus(`✓ Đã thêm ${newBatchFiles.length} file (Tổng: ${combinedBatchFiles.length})`, '#4CAF50');
      UIManager.displayFileList(combinedBatchFiles);

      if (!DOM.batchLimitInput.dataset.userSet) {
        DOM.batchLimitInput.value = combinedBatchFiles.length;
      }

    } catch (error) {
      UIManager.setFileStatus(`❌ Lỗi đọc folder: ${error.message}`, '#f44336');
      console.error("Lỗi đọc folder:", error);
    }
  },

  async onFileSelect(fileList) {
    if (!fileList || fileList.length === 0) return;

    try {
      const files = Array.from(fileList);
      const data = await chrome.storage.local.get(['batchFiles']);
      const existingBatchFiles = data.batchFiles || [];
      const newBatchFiles = [];

      for (const file of files) {
        const text = await file.text();
        const lines = parseLinesFromText(text);
        newBatchFiles.push({
          name: file.name,
          projectName: "Mixed_Files", // Nếu tải file lẻ thì gom vào thư mục mặc định
          lines: lines,
          completed: false,
          status: 'pending'
        });
      }

      const combinedBatchFiles = [...existingBatchFiles, ...newBatchFiles];
      await StorageManager.saveBatchFiles(combinedBatchFiles);

      UIManager.setFileStatus(`✓ Đã thêm ${newBatchFiles.length} file (Tổng: ${combinedBatchFiles.length})`, '#4CAF50');
      UIManager.displayFileList(combinedBatchFiles);

      // Auto set batch limit
      if (!DOM.batchLimitInput.dataset.userSet) {
        DOM.batchLimitInput.value = combinedBatchFiles.length;
      }

    } catch (error) {
      UIManager.setFileStatus(`❌ Lỗi đọc file: ${error.message}`, '#f44336');
      console.error("Lỗi đọc file:", error);
    }
  },

  async onStart() {
    const batchLimit = parseInt(DOM.batchLimitInput.value) || 1;
    const promptDelay = parseInt(DOM.promptDelayInput.value) || 10;
    const alwaysOnTop = document.getElementById("alwaysOnTop").checked;
    const copyOnly = DOM.copyOnlyMode.checked;
    const provider = DOM.providerSelect.value || 'gemini';

    const data = await StorageManager.loadSettings();
    if (!data.batchFiles || data.batchFiles.length === 0) {
      UIManager.setStatus("⚠️ Chưa chọn batch file .txt", "#ff9800");
      return;
    }

    const settings = {
      batchLimit: batchLimit,
      promptDelay: promptDelay,
      isRunning: true,
      // KHÔNG reset batchCount/currentBatchIndex - sẽ được tính lại trong START_PROCESS
      alwaysOnTop: alwaysOnTop,
      copyOnlyMode: copyOnly,
      provider: provider
    };

    await StorageManager.saveSettings(settings);

    if (alwaysOnTop && !copyOnly) {
      const pipSuccess = await PiPManager.openPiP(provider);
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

  async onClear() {
    if (confirm("Bạn có chắc muốn làm sạch TẤT CẢ danh sách file đang chọn và lịch sử dịch không?")) {
      await chrome.storage.local.set({
        batchFiles: [],
        translatedBatches: [],
        batchCount: 0,
        currentBatchIndex: 0
      });
      
      // Reset input value để OS cho phép chọn lại cùng 1 cục file/thư mục
      if (DOM.fileInput) DOM.fileInput.value = "";
      if (DOM.folderInput) DOM.folderInput.value = "";
      if (DOM.batchLimitInput) {
        DOM.batchLimitInput.value = 1;
        delete DOM.batchLimitInput.dataset.userSet;
      }

      UIManager.displayFileList([]);
      chrome.runtime.sendMessage({ action: "CLEAR_DATA" });
      UIManager.setFileStatus("Chưa chọn file/folder", '#777');
      UIManager.setStatus("Đã làm sạch danh sách. Hãy chọn file mới.");
    }
  }
};

// ============================================
// PIP MANAGER
// ============================================
const PiPManager = {
  async openPiP(provider) {
    try {
      UIManager.setStatus("Đang mở PiP window...");

      const tabs = await chrome.tabs.query({});
      const targetTab = tabs.find(t => {
        if (!t.url) return false;
        if (provider === 'grok') return t.url.includes("grok.com");
        return t.url.includes("gemini.google.com");
      });

      if (!targetTab) {
        const name = provider === 'grok' ? 'Grok' : 'Gemini';
        UIManager.setStatus(`⚠️ Không tìm thấy tab ${name}!`, "#ff9800");
        document.getElementById("alwaysOnTop").checked = false;
        await StorageManager.saveSettings({ alwaysOnTop: false });
        return false;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ['pip-script.js']
        });
      } catch (e) {
        console.log("PiP script đã có sẵn");
      }

      await new Promise(r => setTimeout(r, 500));

      const response = await chrome.tabs.sendMessage(targetTab.id, {
        action: "OPEN_PIP"
      });

      if (response && response.status === "OK") {
        UIManager.setStatus("✓ PiP window đã mở! (Tự động Always On Top)");
        await new Promise(r => setTimeout(r, 1000));
        return true;
      } else if (response && response.status === "ERROR") {
        if (response.message.includes("conversation")) {
          const name = provider === 'grok' ? 'Grok' : 'Gemini';
          UIManager.setStatus(`⚠️ Vui lòng mở một conversation trong ${name} trước!`, "#ff9800");
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

  if (result.batchLimit) {
    DOM.batchLimitInput.value = result.batchLimit;
  }

  if (result.promptDelay !== undefined) {
    DOM.promptDelayInput.value = result.promptDelay;
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
  if (result.provider) {
    DOM.providerSelect.value = result.provider;
  } else {
    DOM.providerSelect.value = 'gemini';
  }

  if (result.batchFiles && result.batchFiles.length > 0) {
    UIManager.setFileStatus(`File đã chọn: ${result.batchFiles.length}`, '#4CAF50');
    UIManager.displayFileList(result.batchFiles);
  }

  setupEventListeners();
}

function setupEventListeners() {
  DOM.modeFile.addEventListener("change", () => {
    DOM.fileInputWrapper.style.display = "block";
    DOM.folderInputWrapper.style.display = "none";
  });

  DOM.modeFolder.addEventListener("change", () => {
    DOM.fileInputWrapper.style.display = "none";
    DOM.folderInputWrapper.style.display = "block";
  });

  DOM.folderInput.addEventListener("change", async (e) => {
    const files = e.target.files;
    await EventHandlers.onFolderSelect(files);
  });

  DOM.fileInput.addEventListener("change", async (e) => {
    const files = e.target.files;
    await EventHandlers.onFileSelect(files);
  });

  DOM.providerSelect.addEventListener("change", async () => {
    await StorageManager.saveSettings({ provider: DOM.providerSelect.value });
  });
  DOM.batchLimitInput.addEventListener("input", () => {
    DOM.batchLimitInput.dataset.userSet = 'true';
  });

  DOM.btnStart.addEventListener("click", () => EventHandlers.onStart());
  DOM.btnStop.addEventListener("click", () => EventHandlers.onStop());
  DOM.btnDownload.addEventListener("click", () => EventHandlers.onDownload());
  DOM.btnClear.addEventListener("click", () => EventHandlers.onClear());

  // Live update: khi background thay đổi batchFiles -> tự động render lại danh sách
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.batchFiles) {
      UIManager.displayFileList(changes.batchFiles.newValue);
    }
  });
}

// ============================================
// START
// ============================================
document.addEventListener("DOMContentLoaded", initializePopup);
