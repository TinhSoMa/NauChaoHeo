// background.js - Subtitle batch translation

// ============================================
// STATE MANAGEMENT
// ============================================
const State = {
    isRunning: false,
    geminiTabId: null,
    geminiWindowId: null,
    grokTabId: null,
    promptTemplate: "",
    batchLimit: 0,
    batchCount: 0,
    keepAliveIntervalId: null,
    provider: "gemini",
    promptDelay: 10,
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
            'currentBatchIndex',
            'provider',
            'promptDelay'
        ]);

        this.promptTemplate = data.promptTemplate || "Dịch sang tiếng Việt: {{TEXT}}";
        this.batchCount = data.batchCount || 0;
        this.copyOnlyMode = data.copyOnlyMode || false;
        this.provider = data.provider || "gemini";
        if (data.promptDelay !== undefined) this.promptDelay = parseInt(data.promptDelay);

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
            if (tab.url && tab.url.includes('grok.com')) {
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
    
    async findGrokTab() {
        return this.findTab("grok.com");
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

        // Bỏ qua các file đã completed
        let startIndex = currentIndex;
        while (startIndex < totalBatches && data.batchFiles[startIndex].completed) {
            Utils.log(`Bỏ qua file đã dịch: ${data.batchFiles[startIndex].name}`);
            startIndex++;
        }
        if (startIndex >= totalBatches) {
            throw new Error("ĐÃ DỊCH HẾT FILE");
        }
        if (startIndex !== currentIndex) {
            await chrome.storage.local.set({ currentBatchIndex: startIndex });
        }

        const batch = data.batchFiles[startIndex];
        State.currentBatchName = batch.name || `Batch ${startIndex + 1}`;

        Utils.log(`Batch ${State.batchCount + 1}/${State.batchLimit} (${startIndex + 1}/${totalBatches})`);
        Utils.log(`Tên file: ${State.currentBatchName}`);
        Utils.log(`Số dòng: ${batch.lines.length}`);

        return {
            name: batch.name,
            lines: batch.lines,
            index: startIndex
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
        const escapedPayload = JSON.stringify(payload).slice(1, -1);
        
        let finalPrompt = State.promptTemplate;
        finalPrompt = finalPrompt.replace(/\{\{COUNT\}\}/g, batchData.lines.length);
        finalPrompt = finalPrompt.replace(/\{\{FILE_NAME\}\}/g, batchData.name);
        finalPrompt = finalPrompt.replace("{{TEXT}}", escapedPayload);

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

    async translateWithGrok(batchData) {
        Utils.log("Gửi yêu cầu dịch tới Grok...");

        await chrome.tabs.update(State.grokTabId, { active: true });
        await Utils.sleep(500);

        const payload = this.buildBatchPrompt(batchData.lines);
        const escapedPayload = JSON.stringify(payload).slice(1, -1);
        
        let finalPrompt = State.promptTemplate;
        finalPrompt = finalPrompt.replace(/\{\{COUNT\}\}/g, batchData.lines.length);
        finalPrompt = finalPrompt.replace(/\{\{FILE_NAME\}\}/g, batchData.name);
        finalPrompt = finalPrompt.replace("{{TEXT}}", escapedPayload);

        if (!State.isRunning) {
            throw new Error("STOPPED_BY_USER");
        }

        Utils.log("Đang gửi prompt và đợi Grok trả lời...");
        Utils.log(`Độ dài prompt: ${finalPrompt.length} ký tự`);

        const grokResult = await Utils.sendMessageToTab(State.grokTabId, {
            action: "PASTE_AND_SEND",
            prompt: finalPrompt
        });

        if (!State.isRunning) {
            throw new Error("STOPPED_BY_USER");
        }

        if (!grokResult) {
            throw new Error("Grok không phản hồi");
        }

        if (grokResult.status === "TIMEOUT") {
            throw new Error("Timeout: Grok mất quá nhiều thời gian");
        }

        if (grokResult.status === "ERROR") {
            throw new Error(`Grok lỗi: ${grokResult.message || 'Unknown error'}`);
        }

        if (grokResult.status !== "DONE") {
            throw new Error(`Grok trả về status không mong đợi: ${grokResult.status}`);
        }

        Utils.log("Dịch thành công!", 'success');
        Utils.log(`Độ dài response: ${grokResult.text ? grokResult.text.length : 0} ký tự`);

        Utils.log("Đợi 2 giây để Grok ổn định...");
        await Utils.sleep(2000);

        return grokResult;
    },

    parseGeminiJson(text) {
        if (!text) return { ok: false, error: 'Empty response' };
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
        }
        try {
            return { ok: true, data: JSON.parse(cleaned), rawText: cleaned };
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

        // Gắn kết quả trực tiếp vào file và đánh dấu done
        const filesData = await chrome.storage.local.get(['batchFiles']);
        const batchFiles = filesData.batchFiles || [];
        const fileIdx = batchResult.batchIndex - 1;
        if (batchFiles[fileIdx]) {
            batchFiles[fileIdx].completed = true;
            batchFiles[fileIdx].status = 'done';
            batchFiles[fileIdx].result = batchResult.response;
            if (batchResult.rawText) batchFiles[fileIdx].rawText = batchResult.rawText;
            await chrome.storage.local.set({ batchFiles });
            Utils.log(`Đã đánh dấu ${batchFiles[fileIdx].name} là done`, 'success');
        }

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

    async setupGrokTab() {
        const grokTab = await TabManager.findGrokTab();

        if (!grokTab) {
            throw new Error("Không tìm thấy tab Grok! Hãy mở tab Grok trước khi chạy.");
        }

        State.grokTabId = grokTab.id;
        Utils.log(`Tìm thấy tab Grok (Tab ${State.grokTabId})`, 'success');

        await TabManager.injectScript(State.grokTabId, 'pip-script.js');
        await TabManager.injectScript(State.grokTabId, 'content-script-grok.js');

        await TabManager.keepAlive(State.grokTabId);
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
        await Utils.sendProgressUpdate(`Đang dịch: ${batchData.name}`);

        // Đánh dấu file đang được xử lý
        const filesForStatus = (await chrome.storage.local.get(['batchFiles'])).batchFiles || [];
        if (filesForStatus[batchData.index]) {
            filesForStatus[batchData.index].status = 'translating';
            await chrome.storage.local.set({ batchFiles: filesForStatus });
        }

        let responseObject;
        let rawResponseText = null;

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
            const providerName = State.provider === 'grok' ? 'Grok' : 'Gemini';
            Utils.log(`BƯỚC 2: Gửi qua ${providerName} để dịch...`);
            await Utils.sendProgressUpdate(`Đang dịch với ${providerName}...`);

            const result = State.provider === 'grok'
                ? await BatchProcessor.translateWithGrok(batchData)
                : await BatchProcessor.translateWithGemini(batchData);

            Utils.log(`✓ ${providerName} đã hoàn thành dịch`, 'success');
            await Utils.sendProgressUpdate(`${providerName} đã hoàn thành dịch`);

            const parsed = BatchProcessor.parseGeminiJson(result.text);
            if (parsed.ok) {
                responseObject = parsed.data;
                rawResponseText = parsed.rawText;
            } else {
                // KHÔNG lưu câu trả lời bị lỗi - DỪNG lại để tránh gửi prompt tiếp theo
                Utils.log(`❌ Không thể parse JSON từ ${providerName}. Dừng lại để tránh mất dữ liệu.`, 'error');
                Utils.log(`Parse error: ${parsed.error}`, 'error');
                Utils.log(`Response preview: ${(parsed.responseText || result.text || '').slice(0, 200)}`, 'error');
                throw new Error(`PARSE_FAILED: ${providerName} trả về nội dung không hợp lệ. Kiểm tra console để xem response.`);
            }
        }

        Utils.log("BƯỚC 3: Lưu kết quả vào bộ nhớ...");
        await Utils.sendProgressUpdate("Đang lưu kết quả...");

        const batchResult = {
            batchIndex: batchData.index + 1,
            fileName: batchData.name,
            response: responseObject,
            rawText: rawResponseText
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

        if (!State.copyOnlyMode) {
            Utils.log(`BƯỚC 5: Nghỉ ${State.promptDelay} giây tránh rate limit...`);
            await Utils.sendProgressUpdate(`Đang nghỉ ${State.promptDelay} giây...`);
            await Utils.sleep(State.promptDelay * 1000);
        } else {
            await Utils.sleep(1000);
        }

        Utils.log("BƯỚC 6: Tiếp tục với batch tiếp theo...\n");
        processLoop();

    } catch (error) {
        if (error.message === "STOPPED_BY_USER") {
            Utils.log("🛑 Quy trình đã dừng ngay lập tức.", 'warning');
            State.isRunning = false;
            await chrome.storage.local.set({ isRunning: false });
            await Utils.sendProgressUpdate("Đã dừng bởi người dùng");
            // Reset file đang translating về pending
            const fd = await chrome.storage.local.get(['batchFiles']);
            const bf = (fd.batchFiles || []).map(f => f.status === 'translating' ? { ...f, status: 'pending' } : f);
            await chrome.storage.local.set({ batchFiles: bf });
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
            // Đánh dấu file bị lỗi
            const fd2 = await chrome.storage.local.get(['batchFiles', 'currentBatchIndex']);
            const bf2 = fd2.batchFiles || [];
            const errIdx = fd2.currentBatchIndex || 0;
            if (bf2[errIdx]) {
                bf2[errIdx].status = 'error';
                await chrome.storage.local.set({ batchFiles: bf2 });
            }
        }
    }
}

// ============================================
// MAIN START FUNCTION
// ============================================
async function loadSettingsAndStart() {
    try {
        const data = await State.loadFromStorage();
        
        // Load prompt template trực tiếp từ file promt.json
        const promptUrl = chrome.runtime.getURL('promt.json');
        State.promptTemplate = await (await fetch(promptUrl)).text();

        Utils.log(`Cài đặt: Dịch ${State.batchLimit} batch (Đã dịch: ${State.batchCount})`);

        if (!State.copyOnlyMode) {
            if (State.provider === 'grok') {
                Utils.log("Chế độ dịch: Cần tab Grok...");
                await Initializer.setupGrokTab();
            } else {
                Utils.log("Chế độ dịch: Cần tab Gemini...");
                await Initializer.setupGeminiTab();
            }
        } else {
            Utils.log("Chế độ Copy Only: KHÔNG cần tab dịch", 'success');
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
    const data = await chrome.storage.local.get(['batchFiles', 'batchCount']);
    const batchFiles = data.batchFiles || [];
    const count = data.batchCount || 0;

    const completedFiles = batchFiles.filter(f => f.completed && f.result);
    if (completedFiles.length === 0) {
        Utils.log("Chưa có nội dung. Hãy chạy dịch trước.", 'warning');
        return;
    }

    // Tạo JSONL (hoặc file chứa các JSON strings nối tiếp)
    const jsonl = batchFiles
        .map((f, idx) => {
            if (f.completed && f.result) {
                // Sắp xếp lại thứ tự key cho đúng yêu cầu (Chrome Storage tự động sort theo alphabet khi lưu)
                // 1. "status" 2. "data"
                // Trong data: 1. "translations" 2. "summary" (xuống dưới cùng)
                const responseData = f.result.data || {};
                const orderedResponse = {
                    status: f.result.status || "success",
                    data: {
                        translations: responseData.translations || [],
                        summary: responseData.summary || {}
                    }
                };
                
                // Trả về trên 1 dòng duy nhất để giảm kích thước (JSON.stringify mặc định)
                return JSON.stringify({ batchIndex: idx + 1, response: orderedResponse });
            }
            return null;
        })
        .filter(line => line !== null)
        .join('\n');
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
            // Resume: tìm file đầu tiên chưa completed thay vì reset về 0
            const existing = await chrome.storage.local.get(['batchFiles', 'translatedBatches']);
            const batchFiles = existing.batchFiles || [];
            const completedCount = batchFiles.filter(f => f.completed).length;
            const nextIndex = completedCount; // index của file tiếp theo chưa dịch
            await chrome.storage.local.set({
                currentBatchIndex: nextIndex,
                batchCount: completedCount
                // translatedBatches GIỮ LẠI - không reset
            });
            loadSettingsAndStart();
        })();
    } else if (request.action === "STOP_PROCESS") {
        State.isRunning = false;
        Utils.log("Đã nhận lệnh DỪNG. Đang hủy các tác vụ...");

        if (State.geminiTabId) {
            chrome.tabs.sendMessage(State.geminiTabId, { action: "CANCEL_POLLING" }, () => {
                void chrome.runtime.lastError; // suppress port error
            });
        }
        if (State.grokTabId) {
            chrome.tabs.sendMessage(State.grokTabId, { action: "CANCEL_POLLING" }, () => {
                void chrome.runtime.lastError; // suppress port error
            });
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
