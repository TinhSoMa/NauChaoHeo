// popup.js - Tối ưu hóa với module pattern

// ============================================
// DOM ELEMENTS
// ============================================
const DOM = {
  // Inputs
  promptInput: null,
  chapterLimitInput: null,
  startChapterInput: null,
  fileInput: null,
  websiteSelect: null,
  copyOnlyMode: null,
  pageLoadDelay: null,
  chapterFormat: null,
  
  // Buttons
  btnStart: null,
  btnStop: null,
  btnDownload: null,
  btnClear: null,
  
  // Radio buttons
  sourceFileRadio: null,
  sourceWebRadio: null,
  
  // Sections
  fileSection: null,
  webSection: null,
  startChapterSection: null,
  alwaysOnTopSection: null,
  chapterListContainer: null,
  
  // Status displays
  fileStatus: null,
  statusLog: null,
  chapterList: null,
  
  init() {
    // Inputs
    this.promptInput = document.getElementById("promptTemplate");
    this.chapterLimitInput = document.getElementById("chapterLimit");
    this.startChapterInput = document.getElementById("startChapter");
    this.fileInput = document.getElementById("fileInput");
    this.websiteSelect = document.getElementById("websiteSelect");
    this.copyOnlyMode = document.getElementById("copyOnlyMode");
    this.pageLoadDelay = document.getElementById("pageLoadDelay");
    this.chapterFormat = document.getElementById("chapterFormat");
    
    // Buttons
    this.btnStart = document.getElementById("btnStart");
    this.btnStop = document.getElementById("btnStop");
    this.btnDownload = document.getElementById("btnDownload");
    this.btnClear = document.getElementById("btnClear");
    
    // Radio buttons
    this.sourceFileRadio = document.getElementById("sourceFile");
    this.sourceWebRadio = document.getElementById("sourceWeb");
    
    // Sections
    this.fileSection = document.getElementById("fileSection");
    this.webSection = document.getElementById("webSection");
    this.startChapterSection = document.getElementById("startChapterSection");
    this.alwaysOnTopSection = document.getElementById("alwaysOnTopSection");
    this.chapterListContainer = document.getElementById("chapterListContainer");
    
    // Status displays
    this.fileStatus = document.getElementById("fileStatus");
    this.statusLog = document.getElementById("statusLog");
    this.chapterList = document.getElementById("chapterList");
  }
};

// ============================================
// UI MANAGER
// ============================================
const UIManager = {
  showFileMode() {
    DOM.fileSection.style.display = 'block';
    DOM.webSection.style.display = 'none';
    DOM.startChapterSection.style.display = 'block';
    DOM.alwaysOnTopSection.style.display = 'block';
  },
  
  showWebMode() {
    DOM.fileSection.style.display = 'none';
    DOM.webSection.style.display = 'block';
    DOM.startChapterSection.style.display = 'none';
    DOM.alwaysOnTopSection.style.display = 'none';
  },
  
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
  
  displayChapterList(chapters) {
    if (!chapters || chapters.length === 0) {
      DOM.chapterListContainer.style.display = 'none';
      return;
    }
    
    DOM.chapterListContainer.style.display = 'block';
    DOM.chapterList.innerHTML = chapters.map((ch, idx) => 
      `<div style="padding: 3px 0; border-bottom: 1px solid #eee;">
        #${idx + 1}: ${ch.title} (${ch.content.length} ký tự)
      </div>`
    ).join('');
  },
  
  populateStartChapterDropdown(chapters) {
    DOM.startChapterInput.innerHTML = chapters.map((ch, idx) => 
      `<option value="${idx}">#${idx + 1}: ${ch.title}</option>`
    ).join('');
  }
};

// ============================================
// FILE PARSER (giữ nguyên logic từ file-parser.js)
// ============================================
function parseChapters(content, format = 'format1') {
  const chapters = [];
  
  const patterns = {
    // Pattern 1: "第X章 Tên chương" - ví dụ: "第1章 车队第一铁律"
    chapter1: /^第(\d+)章\s*(.+)$/,
    // Pattern 2: "STT X: Chương X - Tên chương" - ví dụ: "STT 1: Chương 1 - Cuồng hóa" hoặc "STT1: Chương 1 - Cuồng hóa"
    chapter2: /^STT\s*(\d+):\s*Chương\s*\d+\s*-\s*(.+)$/,
    ads: /溫馨提示|登錄用戶|VIP會員|點擊查看|避免下次找不到/
  };
  
  const lines = content.split('\n');
  let currentChapter = null;
  let chapterContent = [];

  const saveChapter = (chapter, content) => {
    if (chapter && content.length > 0) {
      chapter.content = content.join('\n').trim();
      chapters.push(chapter);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip dòng trống và quảng cáo
    if (!line || patterns.ads.test(line)) continue;
    
    let matched = false;
    
    // Thử match theo format được chọn
    if (format === 'format1') {
      const match1 = line.match(patterns.chapter1);
      if (match1) {
        saveChapter(currentChapter, chapterContent);
        const [, numStr, title] = match1;
        const chapterNumber = parseInt(numStr);
        currentChapter = {
          number: chapterNumber,
          title: `第${chapterNumber}章 ${title.trim()}`,
          content: '',
          startLine: i
        };
        chapterContent = [line];
        matched = true;
      }
    } else if (format === 'format2') {
      const match2 = line.match(patterns.chapter2);
      if (match2) {
        saveChapter(currentChapter, chapterContent);
        const [, numStr, title] = match2;
        const chapterNumber = parseInt(numStr);
        currentChapter = {
          number: chapterNumber,
          title: `STT${chapterNumber}: Chương ${chapterNumber} - ${title.trim()}`,
          content: '',
          startLine: i
        };
        chapterContent = [line];
        matched = true;
      }
    }
    
    if (!matched && currentChapter) {
      // Nội dung chương
      chapterContent.push(line);
    }
  }

  // Lưu chương cuối cùng
  saveChapter(currentChapter, chapterContent);
  console.log(`📖 Phân tích hoàn tất: ${chapters.length} chương`);
  return chapters;
}

// ============================================
// STORAGE MANAGER
// ============================================
const StorageManager = {
  async loadSettings() {
    return await chrome.storage.local.get([
      'promptTemplate', 
      'isRunning', 
      'chapterLimit', 
      'startChapter', 
      'fileName', 
      'totalChapters', 
      'alwaysOnTop', 
      'chapters', 
      'currentChapterIndex',
      'dataSource',
      'selectedWebsite',
      'copyOnlyMode',
      'pageLoadDelay',
      'chapterFormat'
    ]);
  },
  
  async saveSettings(settings) {
    await chrome.storage.local.set(settings);
  },
  
  async saveChapters(file, chapters) {
    await chrome.storage.local.set({
      chapters: chapters,
      fileName: file.name,
      totalChapters: chapters.length,
      currentChapterIndex: 0
    });
  }
};

// ============================================
// EVENT HANDLERS
// ============================================
const EventHandlers = {
  async onSourceChange(isFileMode) {
    if (isFileMode) {
      UIManager.showFileMode();
      await StorageManager.saveSettings({ dataSource: 'file' });
      UIManager.setStatus("Đã chuyển sang chế độ: File local");
    } else {
      UIManager.showWebMode();
      await StorageManager.saveSettings({ dataSource: 'web' });
      UIManager.setStatus("Đã chuyển sang chế độ: Web scraping");
    }
  },
  
  async onWebsiteChange(website) {
    await StorageManager.saveSettings({ selectedWebsite: website });
    UIManager.setStatus(`Đã chọn website: ${website}`);
  },
  
  async onFileSelect(file) {
    if (!file) return;
    
    try {
      const text = await file.text();
      const selectedFormat = DOM.chapterFormat.value || 'format1';
      const chapters = parseChapters(text, selectedFormat);
      
      if (chapters.length === 0) {
        throw new Error("Không tìm thấy chương nào trong file");
      }
      
      await StorageManager.saveChapters(file, chapters);
      await StorageManager.saveSettings({ chapterFormat: selectedFormat });
      UIManager.setFileStatus(`✓ ${file.name} (${chapters.length} chương)`, '#4CAF50');
      UIManager.displayChapterList(chapters);
      UIManager.populateStartChapterDropdown(chapters);
      
      console.log(`Đã load ${chapters.length} chương từ file ${file.name}`);
    } catch (error) {
      UIManager.setFileStatus(`❌ Lỗi đọc file: ${error.message}`, '#f44336');
      console.error("Lỗi đọc file:", error);
    }
  },
  
  async onStart() {
    const template = DOM.promptInput.value;
    const chapterLimit = parseInt(DOM.chapterLimitInput.value) || 50;
    const startIndex = parseInt(DOM.startChapterInput.value) || 0;
    const alwaysOnTop = document.getElementById("alwaysOnTop").checked;
    const dataSource = DOM.sourceFileRadio.checked ? 'file' : 'web';
    
    // Prepare settings
    const settings = {
      promptTemplate: template,
      chapterLimit: chapterLimit,
      isRunning: true,
      chapterCount: 0,
      alwaysOnTop: alwaysOnTop,
      dataSource: dataSource,
      copyOnlyMode: DOM.copyOnlyMode.checked,
      pageLoadDelay: parseFloat(DOM.pageLoadDelay.value) || 2
    };
    
    if (dataSource === 'file') {
      settings.startChapter = startIndex + 1;
      settings.currentChapterIndex = startIndex;
    }
    
    await StorageManager.saveSettings(settings);
    
    // Handle PiP if needed
    if (alwaysOnTop && dataSource === 'file') {
      const pipSuccess = await PiPManager.openPiP();
      if (!pipSuccess) return;
    }
    
    // Start process
    chrome.runtime.sendMessage({ action: "START_PROCESS" });
    
    // Update status
    if (dataSource === 'file') {
      const selectedOption = DOM.startChapterInput.options[DOM.startChapterInput.selectedIndex];
      const chapterName = selectedOption ? selectedOption.textContent : `Chương ${startIndex + 1}`;
      UIManager.setStatus(`Trạng thái: Đang khởi động (Từ ${chapterName}, dịch ${chapterLimit} chương)...`);
    } else {
      const selectedWebsite = DOM.websiteSelect.value;
      UIManager.setStatus(`Trạng thái: Đang khởi động (${selectedWebsite}, dịch ${chapterLimit} chương)...`);
    }
  },
  
  onStop() {
    chrome.storage.local.set({ isRunning: false });
    chrome.runtime.sendMessage({ action: "STOP_PROCESS" });
    UIManager.setStatus("Trạng thái: Đã dừng.");
  },
  
  onDownload() {
    chrome.runtime.sendMessage({ action: "DOWNLOAD_FULL" });
    UIManager.setStatus("Đang tải ebook...");
  },
  
  onClear() {
    if (confirm("Bạn có chắc muốn xóa toàn bộ nội dung đã dịch trước đó không?")) {
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
      
      // Inject PiP script
      try {
        await chrome.scripting.executeScript({
          target: { tabId: geminiTab.id },
          files: ['pip-script.js']
        });
      } catch (e) {
        console.log("PiP script đã có sẵn");
      }
      
      await new Promise(r => setTimeout(r, 500));
      
      // Open PiP
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
  // Initialize DOM references
  DOM.init();
  
  // Load settings
  const result = await StorageManager.loadSettings();
  
  // Restore prompt
  if (result.promptTemplate) {
    DOM.promptInput.value = result.promptTemplate;
  }
  
  // Restore chapter limit
  if (result.chapterLimit) {
    DOM.chapterLimitInput.value = result.chapterLimit;
  }
  
  // Restore running status
  if (result.isRunning) {
    UIManager.setStatus("Trạng thái: Đang chạy...");
  }
  
  // Restore file info
  if (result.fileName) {
    UIManager.setFileStatus(`File: ${result.fileName} (${result.totalChapters} chương)`, '#4CAF50');
  }
  
  // Restore always on top
  if (result.alwaysOnTop !== undefined) {
    document.getElementById("alwaysOnTop").checked = result.alwaysOnTop;
  }
  
  // Restore data source
  const dataSource = result.dataSource || 'file';
  if (dataSource === 'web') {
    DOM.sourceWebRadio.checked = true;
    UIManager.showWebMode();
  } else {
    DOM.sourceFileRadio.checked = true;
    UIManager.showFileMode();
  }
  
  // Restore website
  if (result.selectedWebsite) {
    DOM.websiteSelect.value = result.selectedWebsite;
  }
  
  // Restore copy only mode
  if (result.copyOnlyMode !== undefined) {
    DOM.copyOnlyMode.checked = result.copyOnlyMode;
  }
  
  // Restore page load delay
  if (result.pageLoadDelay !== undefined) {
    DOM.pageLoadDelay.value = result.pageLoadDelay;
  }
  
  // Restore chapter format
  if (result.chapterFormat) {
    DOM.chapterFormat.value = result.chapterFormat;
  }
  
  // Restore chapters
  if (result.chapters && result.chapters.length > 0) {
    UIManager.displayChapterList(result.chapters);
    UIManager.populateStartChapterDropdown(result.chapters);
    
    if (result.currentChapterIndex !== undefined) {
      DOM.startChapterInput.value = result.currentChapterIndex;
    }
  }
  
  // Setup event listeners
  setupEventListeners();
}

function setupEventListeners() {
  // Source change
  DOM.sourceFileRadio.addEventListener('change', () => {
    if (DOM.sourceFileRadio.checked) {
      EventHandlers.onSourceChange(true);
    }
  });
  
  DOM.sourceWebRadio.addEventListener('change', () => {
    if (DOM.sourceWebRadio.checked) {
      EventHandlers.onSourceChange(false);
    }
  });
  
  // Website change
  DOM.websiteSelect.addEventListener('change', () => {
    EventHandlers.onWebsiteChange(DOM.websiteSelect.value);
  });
  
  // File select
  DOM.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    await EventHandlers.onFileSelect(file);
  });
  
  // Chapter format change - reload file if already loaded
  DOM.chapterFormat.addEventListener('change', async () => {
    await StorageManager.saveSettings({ chapterFormat: DOM.chapterFormat.value });
    UIManager.setStatus(`Định dạng đã chọn: ${DOM.chapterFormat.value}`);
    
    // If file is already loaded, re-parse with new format
    if (DOM.fileInput.files[0]) {
      await EventHandlers.onFileSelect(DOM.fileInput.files[0]);
    }
  });
  
  // Buttons
  DOM.btnStart.addEventListener("click", () => EventHandlers.onStart());
  DOM.btnStop.addEventListener("click", () => EventHandlers.onStop());
  DOM.btnDownload.addEventListener("click", () => EventHandlers.onDownload());
  DOM.btnClear.addEventListener("click", () => EventHandlers.onClear());
}

// ============================================
// START
// ============================================
document.addEventListener("DOMContentLoaded", initializePopup);
