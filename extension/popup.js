// popup.js - Subtitle batch translator

// ============================================
// DOM ELEMENTS
// ============================================
const DOM = {
  // Inputs
  modeFile: null,
  modeFolder: null,
  modeEbook: null,
  fileInputWrapper: null,
  folderInputWrapper: null,
  ebookInputWrapper: null,
  folderInput: null,
  ebookInput: null,
  batchLimitInput: null,
  promptDelayInput: null,
  fileInput: null,
  promptPresetSelect: null,
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
  promptStatus: null,
  dataModal: null,
  dataModalTitle: null,
  dataModalBody: null,
  dataModalClose: null,

  init() {
    this.modeFile = document.getElementById("modeFile");
    this.modeFolder = document.getElementById("modeFolder");
    this.modeEbook = document.getElementById("modeEbook");
    this.fileInputWrapper = document.getElementById("fileInputWrapper");
    this.folderInputWrapper = document.getElementById("folderInputWrapper");
    this.ebookInputWrapper = document.getElementById("ebookInputWrapper");
    this.folderInput = document.getElementById("folderInput");
    this.ebookInput = document.getElementById("ebookInput");

    this.batchLimitInput = document.getElementById("batchLimit");
    this.promptDelayInput = document.getElementById("promptDelay");
    this.fileInput = document.getElementById("fileInput");
    this.promptPresetSelect = document.getElementById("promptPresetSelect");
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
    this.promptStatus = document.getElementById("promptStatus");
    this.dataModal = document.getElementById("dataModal");
    this.dataModalTitle = document.getElementById("dataModalTitle");
    this.dataModalBody = document.getElementById("dataModalBody");
    this.dataModalClose = document.getElementById("dataModalClose");
  }
};

const INPUT_MODE = {
  SUBTITLE: "subtitle",
  EBOOK: "ebook"
};

const SUBTITLE_INPUT_METHOD = {
  FILE: "file",
  FOLDER: "folder"
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
      const isEbookItem = bf?.sourceType === "epub" || !!bf?.chapterTitle;
      const projectTag = (!isEbookItem && bf.projectName && bf.projectName !== "Mixed_Files")
        ? `[${bf.projectName}] `
        : "";
      const displayName = isEbookItem
        ? (bf.chapterTitle || bf.name || `Chapter ${idx + 1}`)
        : (bf.name || `Batch ${idx + 1}`);
      const hasData = !!(bf.rawText || bf.result);
      const viewBtn = hasData
        ? `<button class="btn-view" data-view-index="${idx}" title="Xem dữ liệu đã lưu">view</button>`
        : "";
      const resetBtn = st === 'done'
        ? `<button class="btn-reset" data-reset-index="${idx}" title="Xóa bản dịch">x</button>`
        : "";
      return `<div class="file-item">
        <span class="file-name" title="${displayName}">#${idx + 1}: ${projectTag}${displayName}</span>
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
      'provider',
      'subtitleBatchFiles',
      'ebookBatchFiles',
      'activeInputMode',
      'subtitleInputMethod',
      'promptPresets',
      'selectedPromptPresetId',
      'selectedPromptName',
      'selectedPromptContent',
      'selectedPromptValid'
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
  },

  async saveModeBatchFiles(mode, batchFiles) {
    if (mode === INPUT_MODE.EBOOK) {
      await chrome.storage.local.set({ ebookBatchFiles: batchFiles });
    } else {
      await chrome.storage.local.set({ subtitleBatchFiles: batchFiles });
    }
  },

  async getModeBatchFiles(mode) {
    const data = await chrome.storage.local.get(['subtitleBatchFiles', 'ebookBatchFiles']);
    return mode === INPUT_MODE.EBOOK
      ? (data.ebookBatchFiles || [])
      : (data.subtitleBatchFiles || []);
  },

  async setActiveMode(mode) {
    await chrome.storage.local.set({ activeInputMode: mode });
  },

  async getActiveMode() {
    const data = await chrome.storage.local.get(['activeInputMode']);
    return data.activeInputMode || INPUT_MODE.SUBTITLE;
  },

  async setSubtitleInputMethod(method) {
    await chrome.storage.local.set({ subtitleInputMethod: method });
  },

  async getSubtitleInputMethod() {
    const data = await chrome.storage.local.get(['subtitleInputMethod']);
    return data.subtitleInputMethod || SUBTITLE_INPUT_METHOD.FILE;
  }
};

async function getBackgroundRunningState() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "GET_RUNNING_STATE" });
    return !!response?.isRunning;
  } catch (_) {
    return false;
  }
}

function renderPromptStatus({ valid, name, message }) {
  if (!DOM.promptStatus) return;
  if (valid) {
    DOM.promptStatus.textContent = `✓ Prompt hợp lệ: ${name || "prompt.json"}`;
    DOM.promptStatus.style.color = "#2e7d32";
    return;
  }
  DOM.promptStatus.textContent = message || "Chưa chọn prompt";
  DOM.promptStatus.style.color = "#b71c1c";
}

function getBuiltInPromptDefinitions() {
  return [
    { id: "default-preset", name: "Prompt subtitle mặc định", file: "promt.json" },
    { id: "novel-preset", name: "Prompt dịch truyện (Novel)", file: "promtnovel.json" }
  ];
}

async function loadBuiltInPromptPresets() {
  const defs = getBuiltInPromptDefinitions();
  const presets = [];
  for (const def of defs) {
    try {
      const url = chrome.runtime.getURL(def.file);
      const content = (await (await fetch(url)).text()).trim();
      if (!content) continue;
      presets.push({
        id: def.id,
        name: def.name,
        content,
        builtIn: true
      });
    } catch (error) {
      console.warn(`Không thể nạp prompt built-in ${def.file}:`, error?.message || error);
    }
  }
  return presets;
}

async function ensurePromptPresetsInitialized(settings) {
  let promptPresets = Array.isArray(settings.promptPresets) ? settings.promptPresets : [];
  let selectedPromptPresetId = settings.selectedPromptPresetId || "";
  const builtIns = await loadBuiltInPromptPresets();
  const byId = new Map(promptPresets.map((p) => [p.id, p]));

  for (const builtIn of builtIns) {
    byId.set(builtIn.id, builtIn);
  }

  promptPresets = Array.from(byId.values());
  const selectedExists = promptPresets.some((p) => p.id === selectedPromptPresetId);
  if (!selectedExists) {
    selectedPromptPresetId = promptPresets[0]?.id || "";
  }

  const selectedPreset = promptPresets.find((p) => p.id === selectedPromptPresetId) || null;
  const selectedContent = (selectedPreset?.content || "").trim();

  await StorageManager.saveSettings({
    promptPresets,
    selectedPromptPresetId,
    selectedPromptName: selectedPreset?.name || "",
    selectedPromptContent: selectedContent,
    selectedPromptValid: !!selectedContent,
    promptTemplate: selectedContent
  });

  return { promptPresets, selectedPromptPresetId };
}

function renderPromptPresetOptions(presets, selectedId) {
  if (!DOM.promptPresetSelect) return;
  DOM.promptPresetSelect.innerHTML = "";
  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name || preset.id;
    if (preset.id === selectedId) option.selected = true;
    DOM.promptPresetSelect.appendChild(option);
  }
}

async function setActivePromptPreset(presets, selectedId) {
  const selectedPreset = presets.find((p) => p.id === selectedId) || null;
  const content = (selectedPreset?.content || "").trim();
  const valid = !!content;
  await StorageManager.saveSettings({
    selectedPromptPresetId: selectedId || "",
    selectedPromptName: selectedPreset?.name || "",
    selectedPromptContent: content,
    selectedPromptValid: valid,
    promptTemplate: content
  });
  if (valid) {
    renderPromptStatus({ valid: true, name: selectedPreset.name });
  } else {
    renderPromptStatus({ valid: false, message: "❌ Prompt preset không hợp lệ" });
  }
}

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
  const activeMode = await StorageManager.getActiveMode();
  if (activeMode === INPUT_MODE.EBOOK) {
    await downloadEbookInPopup();
    return;
  }

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

function getSelectedModeFromUI() {
  if (DOM.modeEbook && DOM.modeEbook.checked) {
    return INPUT_MODE.EBOOK;
  }
  return INPUT_MODE.SUBTITLE;
}

function applySubtitleInputMethod(method) {
  const useFolder = method === SUBTITLE_INPUT_METHOD.FOLDER;
  DOM.modeFile.checked = !useFolder;
  DOM.modeFolder.checked = useFolder;
  DOM.modeEbook.checked = false;
  DOM.fileInputWrapper.style.display = useFolder ? "none" : "block";
  DOM.folderInputWrapper.style.display = useFolder ? "block" : "none";
  DOM.ebookInputWrapper.style.display = "none";
}

function setModeControlsDisabled(disabled) {
  if (DOM.modeFile) DOM.modeFile.disabled = disabled;
  if (DOM.modeFolder) DOM.modeFolder.disabled = disabled;
  if (DOM.modeEbook) DOM.modeEbook.disabled = disabled;
}

function extractTranslatedChapterText(batchFile) {
  const responseObj = batchFile?.result;
  if (!responseObj || !Array.isArray(responseObj.translations)) {
    return "";
  }

  const sorted = [...responseObj.translations]
    .map((item) => ({
      index: Number(item?.index),
      translated: item?.translated
    }))
    .filter((item) => Number.isInteger(item.index) && item.translated !== undefined && item.translated !== null)
    .sort((a, b) => a.index - b.index);

  const lines = sorted
    .map((item) => String(item.translated).trim())
    .filter((line) => line.length > 0);

  return lines.join("\n");
}

function sanitizeFileName(name) {
  return String(name || "ebook")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
}

async function downloadEbookInPopup() {
  UIManager.setStatus("Đang đóng gói EPUB...");
  const data = await chrome.storage.local.get(['ebookBatchFiles', 'ebookBookMeta']);
  const ebookBatchFiles = data.ebookBatchFiles || [];
  const ebookBookMeta = data.ebookBookMeta || {};

  const completed = ebookBatchFiles.filter((f) => f.completed && (f.result || f.rawText));
  if (completed.length === 0) {
    UIManager.setStatus("⚠️ Ebook chưa có chapter đã dịch để xuất.", "#ff9800");
    return;
  }

  UIManager.setStatus(`Đang đóng gói EPUB (${completed.length}/${ebookBatchFiles.length} chapter đã dịch)...`);

  const chapters = completed
    .map((f, idx) => ({
      chapterTitle: f.chapterTitle || f.name || `Chapter ${idx + 1}`,
      chapterIndex: Number.isInteger(f.chapterIndex) ? f.chapterIndex : idx + 1,
      content: extractTranslatedChapterText(f)
    }))
    .filter((c) => c.content.length > 0)
    .sort((a, b) => a.chapterIndex - b.chapterIndex);

  if (chapters.length === 0) {
    UIManager.setStatus("⚠️ Không tìm thấy nội dung dịch hợp lệ trong chapter completed.", "#ff9800");
    return;
  }

  const title = ebookBookMeta.title || chapters[0]?.sourceBookTitle || "Translated_Ebook";
  const author = ebookBookMeta.author || "Unknown Author";
  const language = ebookBookMeta.language || "vi";
  const sourceFileName = ebookBookMeta.sourceFileName || title;

  const blob = await window.EbookExportService.buildEpubBlob({
    bookMeta: {
      title,
      author,
      language,
      identifier: `ebook-${Date.now()}`
    },
    chapters
  });

  const fileBase = sanitizeFileName(sourceFileName.replace(/\.epub$/i, "") || title);
  const fileName = `${fileBase}_translated.epub`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  UIManager.setStatus(`✓ Đã xuất EPUB: ${fileName}`);
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
    const mode = await StorageManager.getActiveMode();
    const batchFiles = await StorageManager.getModeBatchFiles(mode);
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

    const mode = await StorageManager.getActiveMode();
    const data = await chrome.storage.local.get(['translatedBatches']);
    const batchFiles = await StorageManager.getModeBatchFiles(mode);
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

    await StorageManager.saveModeBatchFiles(mode, batchFiles);
    await chrome.storage.local.set({
      // Đồng bộ nguồn chạy chính cho background
      batchFiles: batchFiles,
      totalBatches: batchFiles.length,
      translatedBatches: updatedTranslated,
      batchCount: completedCount,
      currentBatchIndex: nextIndex
    });

    UIManager.setStatus(`Đã xóa bản dịch: ${batchFiles[fileIndex].name}`, "#4CAF50");
    UIManager.displayFileList(batchFiles);
    if (mode === INPUT_MODE.EBOOK) {
      UIManager.setFileStatus(`Ebook chapters đã chọn: ${batchFiles.length}`, batchFiles.length > 0 ? '#4CAF50' : '#777');
    } else {
      UIManager.setFileStatus(`Batch subtitle đã chọn: ${batchFiles.length}`, batchFiles.length > 0 ? '#4CAF50' : '#777');
    }
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

      await StorageManager.setActiveMode(INPUT_MODE.SUBTITLE);
      await StorageManager.setSubtitleInputMethod(SUBTITLE_INPUT_METHOD.FOLDER);
      const existingBatchFiles = await StorageManager.getModeBatchFiles(INPUT_MODE.SUBTITLE);
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
      await StorageManager.saveModeBatchFiles(INPUT_MODE.SUBTITLE, combinedBatchFiles);

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

  async onEbookSelect(fileList) {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    try {
      UIManager.setFileStatus("Đang parse EPUB...", "#1976d2");
      if (!window.EbookParser || typeof window.EbookParser.parseEpubFile !== "function") {
        throw new Error("Thiếu module EbookParser");
      }

      const parsed = await window.EbookParser.parseEpubFile(file);
      await StorageManager.setActiveMode(INPUT_MODE.EBOOK);
      const newBatchFiles = parsed.chapters || [];
      const normalizedBatchFiles = [...newBatchFiles].sort((a, b) => {
        const ai = Number.isInteger(a?.chapterIndex) ? a.chapterIndex : Number.MAX_SAFE_INTEGER;
        const bi = Number.isInteger(b?.chapterIndex) ? b.chapterIndex : Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });

      // EPUB là nguồn đơn lẻ: chọn file mới thì thay thế toàn bộ danh sách chapter cũ,
      // tránh lệch chỉ mục/chạy nhầm chapter do dữ liệu còn sót từ lần chạy trước.
      await StorageManager.saveModeBatchFiles(INPUT_MODE.EBOOK, normalizedBatchFiles);
      await chrome.storage.local.set({
        ebookBookMeta: parsed.metadata || {
          title: parsed.bookTitle || file.name.replace(/\.epub$/i, ""),
          author: "Unknown Author",
          language: "vi",
          createdAt: new Date().toISOString(),
          sourceFileName: file.name
        },
        // reset tiến độ cho lần dịch EPUB mới
        translatedBatches: [],
        batchCount: 0,
        currentBatchIndex: 0
      });

      const skipped = parsed.skipped || [];
      if (skipped.length > 0) {
        UIManager.setFileStatus(`✓ EPUB mới: ${normalizedBatchFiles.length} chapter hợp lệ, bỏ qua ${skipped.length} chapter rỗng/lỗi`, '#4CAF50');
      } else {
        UIManager.setFileStatus(`✓ EPUB mới: ${normalizedBatchFiles.length} chapter (${parsed.bookTitle})`, '#4CAF50');
      }
      UIManager.displayFileList(normalizedBatchFiles);

      if (!DOM.batchLimitInput.dataset.userSet) {
        DOM.batchLimitInput.value = normalizedBatchFiles.length;
      }
    } catch (error) {
      UIManager.setFileStatus(`❌ Lỗi parse EPUB: ${error.message}`, '#f44336');
      console.error("Lỗi parse EPUB:", error);
    }
  },

  async onFileSelect(fileList) {
    if (!fileList || fileList.length === 0) return;

    try {
      const files = Array.from(fileList);
      await StorageManager.setActiveMode(INPUT_MODE.SUBTITLE);
      await StorageManager.setSubtitleInputMethod(SUBTITLE_INPUT_METHOD.FILE);
      const existingBatchFiles = await StorageManager.getModeBatchFiles(INPUT_MODE.SUBTITLE);
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
      await StorageManager.saveModeBatchFiles(INPUT_MODE.SUBTITLE, combinedBatchFiles);

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
    const state = await StorageManager.loadSettings();
    if (state.isRunning) {
      UIManager.setStatus("⚠️ Quy trình đang chạy, không thể Start thêm.", "#ff9800");
      return;
    }
    if (!state.selectedPromptValid || !state.selectedPromptContent || !state.selectedPromptContent.trim()) {
      UIManager.setStatus("⚠️ Vui lòng chọn prompt preset hợp lệ trước khi chạy.", "#ff9800");
      renderPromptStatus({ valid: false, message: "❌ Chưa có prompt preset hợp lệ" });
      return;
    }

    const batchLimit = parseInt(DOM.batchLimitInput.value) || 1;
    const promptDelay = parseInt(DOM.promptDelayInput.value) || 10;
    const alwaysOnTop = document.getElementById("alwaysOnTop").checked;
    const copyOnly = DOM.copyOnlyMode.checked;
    const provider = DOM.providerSelect.value || 'gemini';

    const activeMode = getSelectedModeFromUI();
    await StorageManager.setActiveMode(activeMode);
    let modeBatchFiles = await StorageManager.getModeBatchFiles(activeMode);
    if (!modeBatchFiles || modeBatchFiles.length === 0) {
      UIManager.setStatus(activeMode === INPUT_MODE.EBOOK ? "⚠️ Chưa chọn file EPUB" : "⚠️ Chưa chọn batch file .txt", "#ff9800");
      return;
    }

    if (activeMode === INPUT_MODE.EBOOK) {
      // Chạy EPUB luôn bắt đầu sạch từ chapter đầu tiên để tránh lệch state
      // khi lần chạy trước bị lỗi/dừng giữa chừng.
      const sanitizedEbookBatches = [...modeBatchFiles]
        .sort((a, b) => {
          const ai = Number.isInteger(a?.chapterIndex) ? a.chapterIndex : Number.MAX_SAFE_INTEGER;
          const bi = Number.isInteger(b?.chapterIndex) ? b.chapterIndex : Number.MAX_SAFE_INTEGER;
          return ai - bi;
        })
        .map((bf) => ({
          ...bf,
          completed: false,
          status: "pending",
          retryCount: 0,
          errorReason: null,
          missingIndices: [],
          duplicateIndices: [],
          outOfRangeIndices: [],
          ebookFirstLineOk: null,
          ebookEndMarkerOk: null,
          ebookExpectedFirstLine: "",
          ebookReceivedFirstLine: "",
          result: undefined,
          rawText: undefined
        }));

      modeBatchFiles = sanitizedEbookBatches;
      await StorageManager.saveModeBatchFiles(INPUT_MODE.EBOOK, sanitizedEbookBatches);
      await chrome.storage.local.set({
        translatedBatches: [],
        batchCount: 0,
        currentBatchIndex: 0
      });
      UIManager.displayFileList(sanitizedEbookBatches);
    }

    await StorageManager.saveBatchFiles(modeBatchFiles);

    const settings = {
      batchLimit: batchLimit,
      promptDelay: promptDelay,
      isRunning: true,
      runContext: {
        mode: activeMode,
        sourceCount: modeBatchFiles.length,
        startedAt: new Date().toISOString()
      },
      // KHÔNG reset batchCount/currentBatchIndex - sẽ được tính lại trong START_PROCESS
      alwaysOnTop: alwaysOnTop,
      copyOnlyMode: copyOnly,
      provider: provider,
      promptTemplate: state.selectedPromptContent
    };

    await StorageManager.saveSettings(settings);

    if (alwaysOnTop && !copyOnly) {
      const pipSuccess = await PiPManager.openPiP(provider);
      if (!pipSuccess) return;
    }

    setModeControlsDisabled(true);
    chrome.runtime.sendMessage({ action: "START_PROCESS" });
    UIManager.setStatus(`Trạng thái: Đang khởi động [${activeMode}] (${modeBatchFiles.length} batch nguồn, giới hạn ${batchLimit})...`);
  },

  onStop() {
    chrome.storage.local.set({ isRunning: false });
    chrome.runtime.sendMessage({ action: "STOP_PROCESS" });
    setModeControlsDisabled(false);
    UIManager.setStatus("Trạng thái: Đã dừng.");
  },

  onDownload() {
    downloadFullStoryInPopup();
  },

  async onClear() {
    if (confirm("Bạn có chắc muốn làm sạch TẤT CẢ danh sách file đang chọn và lịch sử dịch không?")) {
      await chrome.storage.local.set({
        batchFiles: [],
        subtitleBatchFiles: [],
        ebookBatchFiles: [],
        ebookBookMeta: null,
        activeInputMode: INPUT_MODE.SUBTITLE,
        subtitleInputMethod: SUBTITLE_INPUT_METHOD.FILE,
        translatedBatches: [],
        batchCount: 0,
        currentBatchIndex: 0
      });
      
      // Reset input value để OS cho phép chọn lại cùng 1 cục file/thư mục
      if (DOM.fileInput) DOM.fileInput.value = "";
      if (DOM.folderInput) DOM.folderInput.value = "";
      if (DOM.ebookInput) DOM.ebookInput.value = "";
      if (DOM.batchLimitInput) {
        DOM.batchLimitInput.value = 1;
        delete DOM.batchLimitInput.dataset.userSet;
      }

      UIManager.displayFileList([]);
      chrome.runtime.sendMessage({ action: "CLEAR_DATA" });
      UIManager.setFileStatus("Chưa chọn file/folder/ebook", '#777');
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
  const presetState = await ensurePromptPresetsInitialized(result);
  const realRunning = await getBackgroundRunningState();
  if (result.isRunning && !realRunning) {
    await StorageManager.saveSettings({ isRunning: false });
    result.isRunning = false;
  }

  if (result.batchLimit) {
    DOM.batchLimitInput.value = result.batchLimit;
  }

  if (result.promptDelay !== undefined) {
    DOM.promptDelayInput.value = result.promptDelay;
  }

  if (result.isRunning) {
    UIManager.setStatus("Trạng thái: Đang chạy...");
  }
  setModeControlsDisabled(!!result.isRunning);

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

  const resolvedSelectedId =
    presetState.selectedPromptPresetId || (presetState.promptPresets[0] ? presetState.promptPresets[0].id : "");
  renderPromptPresetOptions(presetState.promptPresets, resolvedSelectedId);
  await setActivePromptPreset(presetState.promptPresets, resolvedSelectedId);

  const activeMode = result.activeInputMode || INPUT_MODE.SUBTITLE;
  if (activeMode === INPUT_MODE.EBOOK) {
    DOM.modeEbook.checked = true;
    DOM.fileInputWrapper.style.display = "none";
    DOM.folderInputWrapper.style.display = "none";
    DOM.ebookInputWrapper.style.display = "block";
    const ebookFiles = result.ebookBatchFiles || [];
    UIManager.setFileStatus(`Ebook chapters đã chọn: ${ebookFiles.length}`, ebookFiles.length > 0 ? '#4CAF50' : '#777');
    UIManager.displayFileList(ebookFiles);
  } else {
    const subtitleInputMethod = result.subtitleInputMethod || SUBTITLE_INPUT_METHOD.FILE;
    applySubtitleInputMethod(subtitleInputMethod);
    const subtitleFiles = result.subtitleBatchFiles || [];
    UIManager.setFileStatus(`Batch subtitle đã chọn: ${subtitleFiles.length}`, subtitleFiles.length > 0 ? '#4CAF50' : '#777');
    UIManager.displayFileList(subtitleFiles);
  }

  setupEventListeners();
}

function setupEventListeners() {
  const guardModeSwitchWhileRunning = async () => {
    const running = await getBackgroundRunningState();
    if (running) {
      UIManager.setStatus("⚠️ Đang chạy, không thể đổi chức năng lúc này.", "#ff9800");
      return false;
    }
    await StorageManager.saveSettings({ isRunning: false });
    return true;
  };

  DOM.modeFile.addEventListener("change", () => {
    guardModeSwitchWhileRunning().then((ok) => {
      if (!ok) {
        Promise.all([StorageManager.getActiveMode(), StorageManager.getSubtitleInputMethod()]).then(([mode, subtitleMethod]) => {
          if (mode === INPUT_MODE.EBOOK) {
            DOM.modeEbook.checked = true;
            DOM.modeFile.checked = false;
            DOM.modeFolder.checked = false;
          } else {
            applySubtitleInputMethod(subtitleMethod);
          }
        });
        return;
      }

      applySubtitleInputMethod(SUBTITLE_INPUT_METHOD.FILE);
      StorageManager.setActiveMode(INPUT_MODE.SUBTITLE);
      StorageManager.setSubtitleInputMethod(SUBTITLE_INPUT_METHOD.FILE);
      StorageManager.getModeBatchFiles(INPUT_MODE.SUBTITLE).then((list) => {
        UIManager.displayFileList(list);
        UIManager.setFileStatus(`Batch subtitle đã chọn: ${list.length}`, list.length > 0 ? '#4CAF50' : '#777');
      });
    });
  });

  DOM.modeFolder.addEventListener("change", () => {
    guardModeSwitchWhileRunning().then((ok) => {
      if (!ok) {
        Promise.all([StorageManager.getActiveMode(), StorageManager.getSubtitleInputMethod()]).then(([mode, subtitleMethod]) => {
          if (mode === INPUT_MODE.EBOOK) {
            DOM.modeEbook.checked = true;
            DOM.modeFile.checked = false;
            DOM.modeFolder.checked = false;
          } else {
            applySubtitleInputMethod(subtitleMethod);
          }
        });
        return;
      }

      applySubtitleInputMethod(SUBTITLE_INPUT_METHOD.FOLDER);
      StorageManager.setActiveMode(INPUT_MODE.SUBTITLE);
      StorageManager.setSubtitleInputMethod(SUBTITLE_INPUT_METHOD.FOLDER);
      StorageManager.getModeBatchFiles(INPUT_MODE.SUBTITLE).then((list) => {
        UIManager.displayFileList(list);
        UIManager.setFileStatus(`Batch subtitle đã chọn: ${list.length}`, list.length > 0 ? '#4CAF50' : '#777');
      });
    });
  });

  DOM.modeEbook.addEventListener("change", () => {
    guardModeSwitchWhileRunning().then((ok) => {
      if (!ok) {
        Promise.all([StorageManager.getActiveMode(), StorageManager.getSubtitleInputMethod()]).then(([mode, subtitleMethod]) => {
          if (mode === INPUT_MODE.EBOOK) {
            DOM.modeEbook.checked = true;
            DOM.modeFile.checked = false;
            DOM.modeFolder.checked = false;
          } else {
            applySubtitleInputMethod(subtitleMethod);
          }
        });
        return;
      }

      DOM.fileInputWrapper.style.display = "none";
      DOM.folderInputWrapper.style.display = "none";
      DOM.ebookInputWrapper.style.display = "block";
      StorageManager.setActiveMode(INPUT_MODE.EBOOK);
      StorageManager.getModeBatchFiles(INPUT_MODE.EBOOK).then((list) => {
        UIManager.displayFileList(list);
        UIManager.setFileStatus(`Ebook chapters đã chọn: ${list.length}`, list.length > 0 ? '#4CAF50' : '#777');
      });
    });
  });

  DOM.folderInput.addEventListener("change", async (e) => {
    const files = e.target.files;
    await EventHandlers.onFolderSelect(files);
  });

  DOM.fileInput.addEventListener("change", async (e) => {
    const files = e.target.files;
    await EventHandlers.onFileSelect(files);
  });

  DOM.ebookInput.addEventListener("change", async (e) => {
    const files = e.target.files;
    await EventHandlers.onEbookSelect(files);
  });

  DOM.promptPresetSelect.addEventListener("change", async () => {
    const settings = await StorageManager.loadSettings();
    const presets = Array.isArray(settings.promptPresets) ? settings.promptPresets : [];
    await setActivePromptPreset(presets, DOM.promptPresetSelect.value);
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
    if (area === 'local' && (changes.batchFiles || changes.ebookBatchFiles || changes.subtitleBatchFiles)) {
      StorageManager.getActiveMode().then((mode) => {
        StorageManager.getModeBatchFiles(mode).then((list) => UIManager.displayFileList(list));
      });
    }
    if (area === 'local' && changes.isRunning) {
      setModeControlsDisabled(!!changes.isRunning.newValue);
    }
  });
}

// ============================================
// START
// ============================================
document.addEventListener("DOMContentLoaded", initializePopup);
