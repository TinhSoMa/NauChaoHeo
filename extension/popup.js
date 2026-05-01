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
  dataModal: null,
  dataModalTitle: null,
  dataModalBody: null,
  dataModalClose: null,

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
    this.dataModal = document.getElementById("dataModal");
    this.dataModalTitle = document.getElementById("dataModalTitle");
    this.dataModalBody = document.getElementById("dataModalBody");
    this.dataModalClose = document.getElementById("dataModalClose");
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
      const hasData = !!(bf.rawText || bf.result);
      const viewBtn = hasData
        ? `<button class="btn-view" data-view-index="${idx}" title="Xem dữ liệu đã lưu">view</button>`
        : "";
      const resetBtn = st === 'done'
        ? `<button class="btn-reset" data-reset-index="${idx}" title="Xóa bản dịch">x</button>`
        : "";
      return `<div class="file-item">
        <span class="file-name" title="${bf.name}">#${idx + 1}: ${projectTag}${bf.name}</span>
        <span class="file-actions">
          <span class="file-badge badge-${st}">${badgeLabel[st] || '⏳ Chờ'}</span>
          ${viewBtn}
          ${resetBtn}
        </span>
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

const SPECIAL_PROJECTS = new Set(["Mixed_Files", "Unknown_Project", "Khong_Ro_Ten"]);
const nameCollator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

function isSpecialProject(name) {
  return !name || SPECIAL_PROJECTS.has(name);
}

function getPartNumber(fileName) {
  if (!fileName) return null;
  const match = /part[_-]?(\d+)/i.exec(fileName);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return Number.isNaN(num) ? null : num;
}

function sortBatchFiles(files) {
  const list = [...files];
  list.sort((a, b) => {
    const aProject = a?.projectName || "";
    const bProject = b?.projectName || "";
    const aSpecial = isSpecialProject(aProject);
    const bSpecial = isSpecialProject(bProject);
    if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;

    const projectCmp = nameCollator.compare(aProject, bProject);
    if (projectCmp !== 0) return projectCmp;

    const aPart = getPartNumber(a?.name);
    const bPart = getPartNumber(b?.name);
    if (aPart !== null && bPart !== null && aPart !== bPart) return aPart - bPart;
    if (aPart !== null && bPart === null) return -1;
    if (aPart === null && bPart !== null) return 1;

    return nameCollator.compare(a?.name || "", b?.name || "");
  });
  return list;
}

function sanitizeFilenamePart(input) {
  if (!input) return "";
  return String(input).replace(/[\\\/:*?"<>|]+/g, "_").trim();
}

function sortProjectNames(projectsMap) {
  const names = Object.keys(projectsMap);
  return names.sort((a, b) => {
    const aSpecial = isSpecialProject(a);
    const bSpecial = isSpecialProject(b);
    if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
    return nameCollator.compare(a, b);
  });
}

async function downloadFullStoryInPopup() {
  UIManager.setStatus("Đang tải JSONL...");
  const data = await chrome.storage.local.get(['batchFiles', 'batchCount']);
  const batchFiles = data.batchFiles || [];

  const completedFiles = batchFiles.filter(f => f.completed && (f.rawText || f.result));
  if (completedFiles.length === 0) {
    UIManager.setStatus("⚠️ Chưa có nội dung. Hãy chạy dịch trước.", "#ff9800");
    return;
  }

  const projects = {};
  batchFiles.forEach((f, idx) => {
    if (f.completed && (f.rawText || f.result)) {
      const pName = f.projectName || 'Khong_Ro_Ten';
      if (!projects[pName]) projects[pName] = [];
      projects[pName].push({ file: f, originalIndex: idx });
    }
  });

  const date = new Date().toISOString().slice(0, 10);

  const orderedProjects = sortProjectNames(projects);
  const padWidth = String(orderedProjects.length).length;

  for (let i = 0; i < orderedProjects.length; i++) {
    const pName = orderedProjects[i];
    const projectItems = projects[pName];
    const rootFolder = projectItems[0]?.file?.rootFolder || "";
    const safeRoot = sanitizeFilenamePart(rootFolder);
    const prefix = safeRoot ? `${safeRoot}_` : "";
    const orderPrefix = `${String(i + 1).padStart(padWidth, "0")}_`;

    const jsonl = projectItems.map((item, idx) => {
      const f = item.file;
      let finalResponseStr = "";
      if (f.rawText) {
        finalResponseStr = f.rawText.replace(/\r?\n|\r/g, " ");
      } else {
        finalResponseStr = JSON.stringify(f.result);
      }
      return `{"batchIndex": ${idx + 1}, "response": ${finalResponseStr}}`;
    }).join('\n');

    let filename;
    if (pName === "Mixed_Files" || pName === "Unknown_Project" || pName === "Khong_Ro_Ten") {
      filename = `${prefix}${orderPrefix}SubtitleBatch_${projectItems.length}batch_${date}.jsonl`;
    } else {
      filename = `${prefix}${orderPrefix}SubtitleBatch_${pName}_${date}.jsonl`;
    }

    const blob = new Blob([jsonl], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // nhẹ delay để tránh browser chặn nhiều downloads cùng lúc
    await new Promise(r => setTimeout(r, 300));
  }

  UIManager.setStatus("✓ Đã tạo file JSONL để tải xuống.");
}

// ============================================
// EVENT HANDLERS
// ============================================
const EventHandlers = {
  openDataModal(title, content) {
    DOM.dataModalTitle.textContent = title;
    DOM.dataModalBody.textContent = content;
    DOM.dataModal.classList.add("show");
  },

  closeDataModal() {
    DOM.dataModal.classList.remove("show");
  },

  async onViewSavedData(fileIndex) {
    const data = await chrome.storage.local.get(['batchFiles']);
    const batchFiles = data.batchFiles || [];
    const file = batchFiles[fileIndex];
    if (!file) return;

    let content = "Không có dữ liệu đã lưu.";
    if (file.rawText) {
      content = file.rawText;
    } else if (file.result !== undefined) {
      content = JSON.stringify(file.result, null, 2);
    }

    const title = `Dữ liệu: ${file.name || `Batch ${fileIndex + 1}`}`;
    EventHandlers.openDataModal(title, content);
  },

  async onResetTranslation(fileIndex) {
    const state = await StorageManager.loadSettings();
    if (state.isRunning) {
      UIManager.setStatus("⚠️ Hãy bấm Dừng trước khi xóa bản dịch.", "#ff9800");
      return;
    }

    const data = await chrome.storage.local.get(['batchFiles', 'translatedBatches']);
    const batchFiles = data.batchFiles || [];
    const translatedBatches = data.translatedBatches || [];

    if (!batchFiles[fileIndex]) return;

    batchFiles[fileIndex].completed = false;
    batchFiles[fileIndex].status = 'pending';
    delete batchFiles[fileIndex].result;
    delete batchFiles[fileIndex].rawText;

    const targetBatchIndex = fileIndex + 1;
    const updatedTranslated = translatedBatches.filter(b => b.batchIndex !== targetBatchIndex);

    const completedCount = batchFiles.filter(f => f.completed).length;
    const firstPendingIndex = batchFiles.findIndex(f => !f.completed);
    const nextIndex = firstPendingIndex >= 0 ? firstPendingIndex : batchFiles.length;

    await chrome.storage.local.set({
      batchFiles: batchFiles,
      translatedBatches: updatedTranslated,
      batchCount: completedCount,
      currentBatchIndex: nextIndex
    });

    UIManager.setStatus(`Đã xóa bản dịch: ${batchFiles[fileIndex].name}`, "#4CAF50");
  },
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
        const rootFolder = pathParts[0] || null;
        const captionIdx = pathParts.findIndex(p => p === 'caption_output');
        const projectName = captionIdx > 0 ? pathParts[captionIdx - 1] : "Unknown_Project";

        const text = await file.text();
        const lines = parseLinesFromText(text);
        
        newBatchFiles.push({
          name: file.name,
          rootFolder: rootFolder,
          projectName: projectName,
          lines: lines,
          completed: false,
          status: 'pending'
        });
      }

      const combinedBatchFiles = sortBatchFiles([...existingBatchFiles, ...newBatchFiles]);
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
          rootFolder: null,
          projectName: "Mixed_Files", // Nếu tải file lẻ thì gom vào thư mục mặc định
          lines: lines,
          completed: false,
          status: 'pending'
        });
      }

      const combinedBatchFiles = sortBatchFiles([...existingBatchFiles, ...newBatchFiles]);
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
    downloadFullStoryInPopup();
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

      const matcher = (t) => {
        if (!t.url) return false;
        if (provider === 'grok') return t.url.includes("grok.com");
        return t.url.includes("gemini.google.com");
      };

      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      let targetTab = activeTabs.find(matcher);

      if (!targetTab) {
        const tabs = await chrome.tabs.query({});
        targetTab = tabs.find(matcher);
      }

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
        await StorageManager.saveSettings({ pipTargetTabId: targetTab.id });
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
  DOM.dataModalClose.addEventListener("click", () => EventHandlers.closeDataModal());
  DOM.dataModal.addEventListener("click", (e) => {
    if (e.target === DOM.dataModal) {
      EventHandlers.closeDataModal();
    }
  });

  DOM.fileList.addEventListener("click", (e) => {
    const target = e.target;
    if (target && target.classList && target.classList.contains("btn-reset")) {
      const idx = parseInt(target.getAttribute("data-reset-index"), 10);
      if (!Number.isNaN(idx)) {
        EventHandlers.onResetTranslation(idx);
      }
    }
    if (target && target.classList && target.classList.contains("btn-view")) {
      const idx = parseInt(target.getAttribute("data-view-index"), 10);
      if (!Number.isNaN(idx)) {
        EventHandlers.onViewSavedData(idx);
      }
    }
  });

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
