// background.js - Subtitle batch translation

// ============================================
// STATE MANAGEMENT
// ============================================
const State = {
    isRunning: false,
    geminiTabId: null,
    geminiWindowId: null,
    promptTemplate: "",
    batchLimit: 0,
    batchCount: 0,
    keepAliveIntervalId: null,
    copyOnlyMode: false,
    currentBatchName: "Starting...",
    currentStatus: "Ready",

    reset() {
        this.isRunning = false;
        this.batchCount = 0;
    },

    async loadFromStorage() {
        const data = await chrome.storage.local.get([
            'promptTemplate',
            'batchLimit',
            'batchCount',
            'copyOnlyMode',
            'batchFiles',
            'totalBatches',
            'currentBatchIndex'
        ]);

        this.promptTemplate = data.promptTemplate || "Dịch sang tiếng Việt: {{TEXT}}";
        this.batchCount = data.batchCount || 0;
        this.copyOnlyMode = data.copyOnlyMode || false;

        const total = data.totalBatches || (data.batchFiles ? data.batchFiles.length : 0);
        const limit = data.batchLimit || total || 1;
        this.batchLimit = Math.min(limit, total || limit);

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

    async sendProgressUpdate(status) {
        State.currentStatus = status;

        const progressData = {
            completed: State.batchCount,
            total: State.batchLimit,
            currentChapter: State.currentBatchName,
            status: status
        };

        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.url && tab.url.includes('progress.html')) {
                chrome.tabs.sendMessage(tab.id, {
                    action: "UPDATE_PROGRESS",
                    data: progressData
                }).catch(() => {});
            }
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
// BATCH PROCESSING
// ============================================
const BatchProcessor = {
    async getBatchData(data) {
        if (!data.batchFiles || data.batchFiles.length === 0) {
            throw new Error("Không có dữ liệu batch. Hãy chọn file .txt trước.");
        }

        const currentIndex = data.currentBatchIndex || 0;
        const totalBatches = data.totalBatches || data.batchFiles.length;
        if (currentIndex >= totalBatches) {
            throw new Error("ĐÃ DỊCH HẾT FILE");
        }

        const batch = data.batchFiles[currentIndex];
        State.currentBatchName = batch.name || `Batch ${currentIndex + 1}`;

        Utils.log(`Batch ${State.batchCount + 1}/${State.batchLimit} (${currentIndex + 1}/${totalBatches})`);
        Utils.log(`Tên file: ${State.currentBatchName}`);
        Utils.log(`Số dòng: ${batch.lines.length}`);

        return {
            name: batch.name,
            lines: batch.lines,
            index: currentIndex
        };
    },

    buildBatchPrompt(lines) {
        return lines
            .map((line, idx) => `${idx + 1}. ${line}`)
            .join('\n');
    },

    async translateWithGemini(batchData) {
        Utils.log("Gửi yêu cầu dịch tới Gemini...");

        await chrome.tabs.update(State.geminiTabId, { active: true });
        await Utils.sleep(500);

        const payload = this.buildBatchPrompt(batchData.lines);
        const finalPrompt = State.promptTemplate.replace("{{TEXT}}", payload);

        if (!State.isRunning) {
            throw new Error("STOPPED_BY_USER");
        }

        Utils.log("Đang gửi prompt và đợi Gemini trả lời...");
        Utils.log(`Độ dài prompt: ${finalPrompt.length} ký tự`);

        const geminiResult = await Utils.sendMessageToTab(State.geminiTabId, {
            action: "PASTE_AND_SEND",
            prompt: finalPrompt
        });

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

        Utils.log("Đợi 2 giây để Gemini ổn định...");
        await Utils.sleep(2000);

        return geminiResult;
    },

    parseGeminiJson(text) {
        if (!text) return { ok: false, error: 'Empty response' };
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
        }
        try {
            return { ok: true, data: JSON.parse(cleaned) };
        } catch (e) {
            return { ok: false, error: e.message, responseText: text };
        }
    },

    async saveTranslation(batchResult) {
        const data = await chrome.storage.local.get(['translatedBatches']);
        const translatedBatches = data.translatedBatches || [];

        translatedBatches.push(batchResult);
        State.batchCount++;

        await chrome.storage.local.set({
            translatedBatches: translatedBatches,
            batchCount: State.batchCount
        });

        Utils.log(`Đã lưu batch ${batchResult.batchIndex}`, 'success');
        Utils.log(`Tiến độ: ${State.batchCount}/${State.batchLimit} batch`);
    },

    async moveToNextBatch(currentIndex) {
        Utils.log("Chuyển sang batch tiếp theo...");
        await chrome.storage.local.set({
            currentBatchIndex: currentIndex + 1
        });
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

        await TabManager.injectScript(State.geminiTabId, 'pip-script.js');
        await TabManager.injectScript(State.geminiTabId, 'content-script-gemini.js');

        await TabManager.keepAlive(State.geminiTabId);
    },

    async validateFileMode(data) {
        if (!data.batchFiles || data.batchFiles.length === 0) {
            throw new Error("Chưa load file! Hãy chọn batch file .txt trước.");
        }
        Utils.log(`Đã load batch files: ${data.batchFiles.length} file`, 'success');
    }
};

// ============================================
// MAIN PROCESS LOOP
// ============================================
async function processLoop() {
    if (!State.isRunning) {
        Utils.log("Đã dừng bởi người dùng.", 'warning');
        return;
    }

    if (State.batchCount >= State.batchLimit) {
        console.log(`\n🎉 ĐÃ HOÀN THÀNH! Đã dịch đủ ${State.batchLimit} batch.`);
        Utils.log("Tự động dừng. Bạn có thể bấm 'Tải JSONL' để tải về.", 'success');
        State.isRunning = false;
        await chrome.storage.local.set({ isRunning: false });
        return;
    }

    try {
        Utils.log(`\n========== BATCH ${State.batchCount + 1}/${State.batchLimit} ==========`, 'info');

        Utils.log("BƯỚC 1: Lấy nội dung batch...");
        await Utils.sendProgressUpdate("Đang lấy nội dung batch...");

        const data = await chrome.storage.local.get([
            'batchFiles', 'currentBatchIndex', 'totalBatches'
        ]);

        const batchData = await BatchProcessor.getBatchData(data);
        Utils.log(`✓ Đã lấy: "${batchData.name}"`, 'success');
        await Utils.sendProgressUpdate(`Đã lấy: ${batchData.name}`);

        let responseObject;

        if (State.copyOnlyMode) {
            Utils.log("BƯỚC 2: Chế độ Copy Only - Bỏ qua Gemini");
            await Utils.sendProgressUpdate("Chế độ Copy Only: Lưu text gốc...");

            responseObject = {
                translations: batchData.lines.map((line, idx) => ({
                    index: idx + 1,
                    original: line,
                    translated: line
                })),
                summary: {
                    copyOnly: true,
                    input_count: batchData.lines.length,
                    output_count: batchData.lines.length,
                    match: true
                }
            };

            Utils.log("✓ Đã tạo response copy-only", 'success');
        } else {
            Utils.log("BƯỚC 2: Gửi qua Gemini để dịch...");
            await Utils.sendProgressUpdate("Đang dịch với Gemini...");

            const geminiResult = await BatchProcessor.translateWithGemini(batchData);
            Utils.log("✓ Gemini đã hoàn thành dịch", 'success');
            await Utils.sendProgressUpdate("Gemini đã hoàn thành dịch");

            const parsed = BatchProcessor.parseGeminiJson(geminiResult.text);
            if (parsed.ok) {
                responseObject = parsed.data;
            } else {
                responseObject = {
                    responseText: parsed.responseText || geminiResult.text,
                    parseError: parsed.error
                };
            }
        }

        Utils.log("BƯỚC 3: Lưu kết quả vào bộ nhớ...");
        await Utils.sendProgressUpdate("Đang lưu kết quả...");

        const batchResult = {
            batchIndex: batchData.index + 1,
            fileName: batchData.name,
            response: responseObject
        };

        await BatchProcessor.saveTranslation(batchResult);
        Utils.log("✓ Đã lưu thành công", 'success');

        await Utils.sleep(1000);

        if (!State.isRunning) {
            Utils.log("Đã dừng bởi người dùng.", 'warning');
            return;
        }

        Utils.log("BƯỚC 4: Chuyển sang batch tiếp theo...");
        await Utils.sendProgressUpdate("Đang chuyển sang batch tiếp theo...");
        await BatchProcessor.moveToNextBatch(batchData.index);
        Utils.log("✓ Đã chuyển batch", 'success');

        await Utils.sleep(1000);

        Utils.log("BƯỚC 5: Tiếp tục với batch tiếp theo...\n");
        processLoop();

    } catch (error) {
        if (error.message === "STOPPED_BY_USER") {
            Utils.log("🛑 Quy trình đã dừng ngay lập tức.", 'warning');
            State.isRunning = false;
            await chrome.storage.local.set({ isRunning: false });
            await Utils.sendProgressUpdate("Đã dừng bởi người dùng");
        } else if (error.message === "ĐÃ DỊCH HẾT FILE") {
            console.log("\n🎉 " + error.message);
            Utils.log("Đã hoàn thành toàn bộ batch files!", 'success');
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

        Utils.log(`Cài đặt: Dịch ${State.batchLimit} batch (Đã dịch: ${State.batchCount})`);

        if (!State.copyOnlyMode) {
            Utils.log("Chế độ dịch: Cần tab Gemini...");
            await Initializer.setupGeminiTab();
        } else {
            Utils.log("Chế độ Copy Only: KHÔNG cần tab Gemini", 'success');
        }

        await Initializer.validateFileMode(data);

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
    Utils.log("Bắt đầu tải JSONL...");
    const data = await chrome.storage.local.get(['translatedBatches', 'batchCount']);
    const translatedBatches = data.translatedBatches || [];
    const count = data.batchCount || 0;

    if (!translatedBatches || translatedBatches.length === 0) {
        Utils.log("Chưa có nội dung. Hãy chạy dịch trước.", 'warning');
        return;
    }

    const jsonl = translatedBatches.map(line => JSON.stringify(line)).join('\n');
    const docUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(jsonl);
    const date = new Date().toISOString().slice(0,10);
    const filename = `SubtitleBatch_${count}batch_${date}.jsonl`;

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
        (async () => {
            await chrome.storage.local.set({
                translatedBatches: [],
                batchCount: 0,
                currentBatchIndex: 0
            });
            loadSettingsAndStart();
        })();
    } else if (request.action === "STOP_PROCESS") {
        State.isRunning = false;
        Utils.log("Đã nhận lệnh DỪNG. Đang hủy các tác vụ...");

        if (State.geminiTabId) {
            chrome.tabs.sendMessage(State.geminiTabId, { action: "CANCEL_POLLING" })
                .catch(() => {});
        }

        Utils.sendProgressUpdate("Đã dừng bởi người dùng");
    } else if (request.action === "DOWNLOAD_FULL") {
        downloadFullStory();
    } else if (request.action === "CLEAR_DATA") {
        chrome.storage.local.set({
            translatedBatches: [],
            batchCount: 0,
            currentBatchIndex: 0
        });
        Utils.log("Đã xóa dữ liệu cũ.");
    } else if (request.action === "GET_PROGRESS") {
        sendResponse({
            completed: State.batchCount,
            total: State.batchLimit,
            currentChapter: State.currentBatchName,
            status: State.currentStatus
        });
        return true;
    }
});
