// background.js - Tối ưu hóa với cấu trúc module pattern

// ============================================
// STATE MANAGEMENT
// ============================================
const State = {
    isRunning: false,
    geminiTabId: null,
    geminiWindowId: null,
    storyTabId: null,
    promptTemplate: "",
    chapterLimit: 50,
    chapterCount: 0,
    keepAliveIntervalId: null,
    dataSource: 'file', // 'file' or 'web'
    copyOnlyMode: false, // true = skip Gemini, just copy text
    pageLoadDelay: 2, // seconds to wait for page load (default 2s)
    currentChapterTitle: "Starting...",
    currentStatus: "Ready",
    
    reset() {
        this.isRunning = false;
        this.chapterCount = 0;
    },
    
    async loadFromStorage() {
        const data = await chrome.storage.local.get([
            'promptTemplate', 
            'chapterLimit', 
            'chapterCount',
            'dataSource',
            'selectedWebsite',
            'copyOnlyMode',
            'pageLoadDelay',
            'chapters',
            'fileName',
            'totalChapters',
            'currentChapterIndex'
        ]);
        
        this.promptTemplate = data.promptTemplate || "Dịch sang tiếng Việt: {{TEXT}}";
        this.chapterLimit = data.chapterLimit || 50;
        this.chapterCount = data.chapterCount || 0;
        this.dataSource = data.dataSource || 'file';
        this.copyOnlyMode = data.copyOnlyMode || false;
        this.pageLoadDelay = data.pageLoadDelay || 2; // Default 2 seconds
        
        return data;
    }
};

// ============================================
// UTILITIES
// ============================================
const Utils = {
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    
    log(message, type = 'info') {
        const prefix = {
            info: '------>',
            success: '✓',
            error: '❌',
            warning: '⚠️'
        }[type] || '---->';
        
        console.log(`${prefix} ${message}`);
    },
    
    async sendMessageToTab(tabId, message) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Lỗi gửi tin nhắn:", chrome.runtime.lastError.message);
                    resolve(null);
                } else {
                    resolve(response);
                }
            });
        });
    },
    
    // Gửi cập nhật tiến độ đến tất cả các tab progress.html VÀ tab Gemini (PiP window)
    async sendProgressUpdate(status) {
        State.currentStatus = status;
        
        const progressData = {
            completed: State.chapterCount,
            total: State.chapterLimit,
            currentChapter: State.currentChapterTitle,
            status: status
        };
        
        // Gửi đến tất cả các tab
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            // Gửi đến progress.html tabs
            if (tab.url && tab.url.includes('progress.html')) {
                chrome.tabs.sendMessage(tab.id, {
                    action: "UPDATE_PROGRESS",
                    data: progressData
                }).catch(() => {});
            }
            // Gửi đến tab Gemini (pip-script.js sẽ forward vào PiP window)
            if (tab.url && tab.url.includes('gemini.google.com')) {
                chrome.tabs.sendMessage(tab.id, {
                    action: "UPDATE_PROGRESS",
                    data: progressData
                }).catch(() => {});
            }
        }
    }
};

// ============================================
// TAB MANAGEMENT
// ============================================
const TabManager = {
    async findTab(urlPattern) {
        const tabs = await chrome.tabs.query({});
        return tabs.find(t => t.url && t.url.includes(urlPattern));
    },
    
    async findGeminiTab() {
        return this.findTab("gemini.google.com");
    },
    
    async findStoryTab(website) {
        if (website === 'novel543') {
            return this.findTab("novel543.com");
        }
        if (website === 'thienloitruc') {
            return this.findTab("thienloitruc.com");
        }
        const tab = await this.findTab("69shuba.com");
        return tab || this.findTab("69shu.me");
    },
    
    async injectScript(tabId, scriptPath) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: [scriptPath]
            });
            Utils.log(`Đã inject ${scriptPath}`, 'success');
            return true;
        } catch (e) {
            Utils.log(`Script ${scriptPath} đã có sẵn hoặc lỗi: ${e.message}`, 'warning');
            return false;
        }
    },
    
    async keepAlive(tabId) {
        if (State.keepAliveIntervalId) {
            clearInterval(State.keepAliveIntervalId);
        }
        
        State.keepAliveIntervalId = setInterval(async () => {
            try {
                await Utils.sendMessageToTab(tabId, { action: "PING" });
            } catch (e) {
                // Silent fail
            }
        }, 30000);
        
        Utils.log("Keep-alive đã được thiết lập", 'success');
    }
};

// ============================================
// CHAPTER PROCESSING
// ============================================
const ChapterProcessor = {
    async getChapterData(dataSource, data) {
        if (dataSource === 'file') {
            return this.getFromFile(data);
        } else {
            return this.getFromWeb();
        }
    },
    
    async getFromFile(data) {
        if (!data.chapters || data.chapters.length === 0) {
            throw new Error("Không có dữ liệu chapters. Hãy load file trước.");
        }

        const currentIndex = data.currentChapterIndex || 0;
        
        if (currentIndex >= data.chapters.length) {
            throw new Error("ĐÃ DỊCH HẾT FILE");
        }

        const chapter = data.chapters[currentIndex];
        
        State.currentChapterTitle = chapter.title;
        
        Utils.log(`Chương ${State.chapterCount + 1}/${State.chapterLimit} (${currentIndex + 1}/${data.totalChapters})`);
        Utils.log(`Tiêu đề: ${chapter.title}`);
        Utils.log(`Độ dài: ${chapter.content.length} ký tự`);

        return {
            title: chapter.title,
            content: chapter.content,
            index: currentIndex
        };
    },
    
    async getFromWeb() {
        Utils.log("Đang lấy nội dung từ trang web...");
        
        await chrome.tabs.update(State.storyTabId, { active: true });
        await Utils.sleep(1000);

        const storyResult = await Utils.sendMessageToTab(State.storyTabId, { 
            action: "GET_CONTENT" 
        });
        
        if (!storyResult || !storyResult.content) {
            throw new Error("Không lấy được nội dung từ trang web!");
        }
        
        State.currentChapterTitle = storyResult.title;
        
        Utils.log(`Đã lấy: ${storyResult.title}`, 'success');
        Utils.log(`Độ dài: ${storyResult.content.length} ký tự`);
        
        return {
            title: storyResult.title,
            content: storyResult.content
        };
    },
    
    async translateWithGemini(chapterData) {
        Utils.log("Gửi yêu cầu dịch tới Gemini...");
        
        // Chuyển sang tab Gemini
        await chrome.tabs.update(State.geminiTabId, { active: true });
        await Utils.sleep(500);

        // Ghép Prompt + Nội dung truyện
        const finalPrompt = State.promptTemplate.replace("{{TEXT}}", `${chapterData.title}\n\n${chapterData.content}`);

        // Kiểm tra ngay trước khi gửi - Tránh gửi request khi đã dừng
        if (!State.isRunning) {
            throw new Error("STOPPED_BY_USER");
        }

        Utils.log("Đang gửi prompt và đợi Gemini trả lời...");
        Utils.log(`Độ dài prompt: ${finalPrompt.length} ký tự`);
        
        // Gửi lệnh và đợi (Hàm này sẽ đợi cho đến khi Gemini viết xong)
        const geminiResult = await Utils.sendMessageToTab(State.geminiTabId, { 
            action: "PASTE_AND_SEND", 
            prompt: finalPrompt 
        });

        // Kiểm tra ngay sau khi nhận kết quả (đề phòng trường hợp chờ quá lâu)
        if (!State.isRunning) {
            throw new Error("STOPPED_BY_USER");
        }

        if (!geminiResult) {
            throw new Error("Gemini không phản hồi");
        }

        if (geminiResult.status === "TIMEOUT") {
            throw new Error("Timeout: Gemini mất quá nhiều thời gian");
        }

        if (geminiResult.status === "ERROR") {
            throw new Error(`Gemini lỗi: ${geminiResult.message || 'Unknown error'}`);
        }

        if (geminiResult.status !== "DONE") {
            throw new Error(`Gemini trả về status không mong đợi: ${geminiResult.status}`);
        }

        Utils.log("Dịch thành công!", 'success');
        Utils.log(`Độ dài response: ${geminiResult.text ? geminiResult.text.length : 0} ký tự`);
        
        // QUAN TRỌNG: Delay 2 giây sau khi Gemini hoàn thành
        // Đảm bảo UI ổn định trước khi gửi request tiếp theo
        Utils.log("Đợi 2 giây để Gemini ổn định...");
        await Utils.sleep(2000);
        
        return geminiResult;
    },
    
    async saveTranslation(geminiResult, title) {
        if (!geminiResult.text) {
            Utils.log("Gemini không trả về text!", 'warning');
            return;
        }

        const data = await chrome.storage.local.get(['fullStory']);
        let currentStory = data.fullStory || "";

        const newChapter = `\n\n=== ${title} ===\n\n${geminiResult.text}`;
        currentStory += newChapter;

        State.chapterCount++;

        await chrome.storage.local.set({ 
            fullStory: currentStory,
            chapterCount: State.chapterCount
        });
        
        Utils.log(`Đã lưu "${title}"`, 'success');
        Utils.log(`Tiến độ: ${State.chapterCount}/${State.chapterLimit} chương`);
    },
    
    async saveTextDirect(text, title) {
        const data = await chrome.storage.local.get(['fullStory']);
        let currentStory = data.fullStory || "";

        const newChapter = `\n\n=== ${title} ===\n\n${text}`;
        currentStory += newChapter;

        State.chapterCount++;

        await chrome.storage.local.set({ 
            fullStory: currentStory,
            chapterCount: State.chapterCount
        });
        
        Utils.log(`Đã lưu "${title}" (text gốc)`, 'success');
        Utils.log(`Tiến độ: ${State.chapterCount}/${State.chapterLimit} chương`);
    },
    
    async moveToNextChapter(dataSource, currentIndex) {
        if (dataSource === 'file') {
            Utils.log("Chuyển sang chương tiếp theo trong file...");
            await chrome.storage.local.set({ 
                currentChapterIndex: currentIndex + 1 
            });
        } else {
            Utils.log("Click nút Next trên trang web...");
            await chrome.tabs.update(State.storyTabId, { active: true });
            await Utils.sleep(1000);
            
            const navResult = await Utils.sendMessageToTab(State.storyTabId, { 
                action: "CLICK_NEXT" 
            });
            
            if (!navResult || !navResult.success) {
                throw new Error("Không tìm thấy nút Next hoặc đã hết truyện");
            }
            
            Utils.log("Da click Next. Dang doi trang load...", 'success');
            const delayMs = State.pageLoadDelay * 1000; // Convert to milliseconds
            Utils.log(`Cho ${State.pageLoadDelay}s de Angular render...`);
            await Utils.sleep(delayMs);
        }
    }
};

// ============================================
// INITIALIZATION
// ============================================
const Initializer = {
    async setupGeminiTab() {
        const geminiTab = await TabManager.findGeminiTab();
        
        if (!geminiTab) {
            throw new Error("Không tìm thấy tab Gemini! Hãy mở tab Gemini trước khi chạy.");
        }

        State.geminiTabId = geminiTab.id;
        State.geminiWindowId = geminiTab.windowId;
        Utils.log(`Tìm thấy tab Gemini (Tab ${State.geminiTabId})`, 'success');
        
        // Inject scripts
        await TabManager.injectScript(State.geminiTabId, 'pip-script.js');
        await TabManager.injectScript(State.geminiTabId, 'content-script-gemini.js');
        
        // Keep alive
        await TabManager.keepAlive(State.geminiTabId);
    },
    
    async setupStoryTab(selectedWebsite) {
        const storyTab = await TabManager.findStoryTab(selectedWebsite);
        
        if (!storyTab) {
            throw new Error(`Không tìm thấy tab ${selectedWebsite}! Hãy mở tab trước khi chạy.`);
        }
        
        State.storyTabId = storyTab.id;
        Utils.log(`Tìm thấy tab Story (${selectedWebsite}, Tab ${State.storyTabId})`, 'success');
        
        await TabManager.injectScript(State.storyTabId, 'content-script-story.js');
    },
    
    async validateFileMode(data) {
        if (!data.chapters || data.chapters.length === 0) {
            throw new Error("Chưa load file! Hãy chọn file .txt trước.");
        }
        Utils.log(`Đã load file: ${data.fileName} (${data.chapters.length} chương)`, 'success');
    }
};

// ============================================
// MAIN PROCESS LOOP
// ============================================
/**
 * Vòng lặp xử lý chính - Điều phối toàn bộ luồng dịch
 * 
 * LUỒNG HOẠT ĐỘNG:
 * 1. Lấy nội dung (Scrape): Từ file hoặc web
 * 2. Dịch thuật (Translate): Gửi qua Gemini và đợi kết quả
 * 3. Lưu trữ (Store): Lưu vào chrome.storage.local
 * 4. Chuyển chương (Navigation): Chuyển sang chương tiếp theo
 * 5. Lặp lại: Gọi đệ quy để xử lý chương tiếp theo
 */
async function processLoop() {
    if (!State.isRunning) {
        Utils.log("Đã dừng bởi người dùng.", 'warning');
        return;
    }
    
    // Kiểm tra giới hạn số chương
    if (State.chapterCount >= State.chapterLimit) {
        console.log(`\n🎉 ĐÃ HOÀN THÀNH! Đã dịch đủ ${State.chapterLimit} chương.`);
        Utils.log("Tự động dừng. Bạn có thể bấm 'Tải Ebook' để tải về.", 'success');
        State.isRunning = false;
        await chrome.storage.local.set({ isRunning: false });
        return;
    }

    try {
        Utils.log(`\n========== CHƯƠNG ${State.chapterCount + 1}/${State.chapterLimit} ==========`, 'info');
        
        // BƯỚC 1: LẤY NỘI DUNG (SCRAPE)
        Utils.log("BƯỚC 1: Lấy nội dung chương...");
        await Utils.sendProgressUpdate("Đang lấy nội dung chương...");
        
        // Chỉ load chapters khi ở chế độ File
        let data = {};
        if (State.dataSource === 'file') {
            data = await chrome.storage.local.get([
                'chapters', 'currentChapterIndex', 'totalChapters'
            ]);
        }
        
        // Lấy dữ liệu chương (từ file hoặc web)
        const chapterData = await ChapterProcessor.getChapterData(State.dataSource, data);
        Utils.log(`✓ Đã lấy: "${chapterData.title}"`, 'success');
        await Utils.sendProgressUpdate(`Đã lấy: ${chapterData.title}`);
        
        let textToSave;
        
        // BƯỚC 2: DỊCH THUẬT (TRANSLATE) - Skip if copyOnlyMode = true
        if (State.copyOnlyMode) {
            Utils.log("BƯỚC 2: Chế độ Copy Only - Bỏ qua Gemini");
            await Utils.sendProgressUpdate("Chế độ Copy Only: Lưu text gốc...");
            textToSave = chapterData.content;
            Utils.log("✓ Đã lấy text gốc (không dịch)", 'success');
        } else {
            Utils.log("BƯỚC 2: Gửi qua Gemini để dịch...");
            await Utils.sendProgressUpdate("Đang dịch với Gemini...");
            const geminiResult = await ChapterProcessor.translateWithGemini(chapterData);
            Utils.log("✓ Gemini đã hoàn thành dịch", 'success');
            await Utils.sendProgressUpdate("Gemini đã hoàn thành dịch");
            textToSave = geminiResult.text;
        }
        
        // BƯỚC 3: LƯU TRỮ (STORE)
        Utils.log("BƯỚC 3: Lưu kết quả vào bộ nhớ...");
        await Utils.sendProgressUpdate("Đang lưu kết quả...");
        await ChapterProcessor.saveTextDirect(textToSave, chapterData.title);
        Utils.log("✓ Đã lưu thành công", 'success');
        
        // Đợi trước khi chuyển chương
        await Utils.sleep(1000);
        
        // Kiểm tra lại xem có bị dừng không
        if (!State.isRunning) {
            Utils.log("Đã dừng bởi người dùng.", 'warning');
            return;
        }
        
        // BƯỚC 4: CHUYỂN CHƯƠNG (NAVIGATION)
        Utils.log("BƯỚC 4: Chuyển sang chương tiếp theo...");
        await Utils.sendProgressUpdate("Đang chuyển sang chương tiếp theo...");
        await ChapterProcessor.moveToNextChapter(State.dataSource, chapterData.index);
        Utils.log("✓ Đã chuyển chương", 'success');
        
        // Đợi trước khi lặp lại
        await Utils.sleep(1000);
        
        // BƯỚC 5: LẶP LẠI (RECURSION)
        Utils.log("BƯỚC 5: Tiếp tục với chương tiếp theo...\n");
        processLoop(); // Đệ quy: Gọi lại chính nó để xử lý chương tiếp theo

    } catch (error) {
        if (error.message === "STOPPED_BY_USER") {
            Utils.log("🛑 Quy trình đã dừng ngay lập tức.", 'warning');
            State.isRunning = false;
            await chrome.storage.local.set({ isRunning: false });
            await Utils.sendProgressUpdate("Đã dừng bởi người dùng");
        } else if (error.message === "ĐÃ DỊCH HẾT FILE") {
            console.log("\n🎉 " + error.message);
            Utils.log("Đã hoàn thành toàn bộ file!", 'success');
            State.isRunning = false;
            await chrome.storage.local.set({ isRunning: false });
        } else {
            Utils.log(`❌ Lỗi: ${error.message}`, 'error');
            console.error("Chi tiết lỗi:", error);
            State.isRunning = false;
            await chrome.storage.local.set({ isRunning: false });
        }
    }
}

// ============================================
// MAIN START FUNCTION
// ============================================
async function loadSettingsAndStart() {
    try {
        const data = await State.loadFromStorage();
        const selectedWebsite = data.selectedWebsite || '69shuba';
        
        Utils.log(`Chế độ: ${State.dataSource === 'file' ? 'File local' : 'Web scraping (' + selectedWebsite + ')'}`);
        Utils.log(`Cài đặt: Dịch ${State.chapterLimit} chương (Đã dịch: ${State.chapterCount})`);
        
        // Setup Gemini tab CHI KHI KHONG O CHE DO COPY ONLY
        if (!State.copyOnlyMode) {
            Utils.log("Che do dich: Can tab Gemini...");
            await Initializer.setupGeminiTab();
        } else {
            Utils.log("Che do Copy Only: KHONG can tab Gemini", 'success');
        }
        
        // Setup theo chế độ
        if (State.dataSource === 'web') {
            await Initializer.setupStoryTab(selectedWebsite);
        } else {
            await Initializer.validateFileMode(data);
        }
        
        await Utils.sleep(1000);
        processLoop();
        
    } catch (error) {
        Utils.log(error.message, 'error');
        console.error("Lỗi khởi tạo:", error);
    }
}

// ============================================
// DOWNLOAD FUNCTION
// ============================================
async function downloadFullStory() {
    Utils.log("Bắt đầu tải ebook...");
    const data = await chrome.storage.local.get(['fullStory', 'chapterCount']);
    const content = data.fullStory;
    const count = data.chapterCount || 0;

    if (!content) {
        Utils.log("Chưa có nội dung. Hãy chạy dịch trước.", 'warning');
        return;
    }

    const docUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    const date = new Date().toISOString().slice(0,10); 
    const filename = `TruyenDich_${count}chuong_${date}.txt`;
    
    try {
        chrome.downloads.download({
            url: docUrl,
            filename: filename,
            saveAs: true
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                Utils.log(`Lỗi tải: ${chrome.runtime.lastError}`, 'error');
            } else {
                Utils.log(`Đã bắt đầu tải, ID: ${downloadId}`, 'success');
            }
        });
    } catch (error) {
        Utils.log(`Lỗi: ${error}`, 'error');
    }
}

// ============================================
// MESSAGE LISTENERS
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_PROCESS") {
        State.isRunning = true;
        loadSettingsAndStart();
    } else if (request.action === "STOP_PROCESS") {
        State.isRunning = false;
        Utils.log("Đã nhận lệnh DỪNG. Đang hủy các tác vụ...");
        
        // [MỚI] Gửi lệnh hủy ngay lập tức tới Gemini Tab
        if (State.geminiTabId) {
            chrome.tabs.sendMessage(State.geminiTabId, { action: "CANCEL_POLLING" })
                .catch(() => {}); // Bỏ qua lỗi nếu tab đã đóng
        }
        
        Utils.sendProgressUpdate("Đã dừng bởi người dùng");
    } else if (request.action === "DOWNLOAD_FULL") {
        downloadFullStory();
    } else if (request.action === "CLEAR_DATA") {
        chrome.storage.local.set({ fullStory: "", chapterCount: 0, currentChapterIndex: 0 });
        Utils.log("Đã xóa dữ liệu truyện cũ.");
    } else if (request.action === "GET_PROGRESS") {
        // Trả về trạng thái hiện tại
        sendResponse({
            completed: State.chapterCount,
            total: State.chapterLimit,
            currentChapter: State.currentChapterTitle,
            status: State.currentStatus
        });
        return true; // Giữ kênh message mở để sendResponse async
    }
});

