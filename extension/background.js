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
// VALIDATION
// ============================================
function validateTranslationCount(expectedCount, responseObject, rawText) {
    const indexes = [];
    if (responseObject && Array.isArray(responseObject.translations)) {
        for (const item of responseObject.translations) {
            if (item && typeof item.index === 'number') {
                indexes.push(item.index);
            }
        }
    }
    if (indexes.length === 0 && rawText) {
        const matches = rawText.match(/"index"\s*:\s*(\d+)/g);
        if (matches && matches.length > 0) {
            for (const m of matches) {
                const num = parseInt(m.replace(/^\D+/, ''), 10);
                if (!Number.isNaN(num)) indexes.push(num);
            }
        }
    }
    const unique = Array.from(new Set(indexes)).sort((a, b) => a - b);
    const missing = [];
    for (let i = 1; i <= expectedCount; i++) {
        if (!unique.includes(i)) missing.push(i);
    }
    const ok = missing.length === 0 && unique.length === expectedCount;
    return { ok, uniqueCount: unique.length, missing };
}

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
        if (!text) return { ok: true, data: null, rawText: '{"status": "error", "message": "Rỗng"}' };
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
        }
        let jsonObj = null;
        try {
            jsonObj = JSON.parse(cleaned);
        } catch (e) {
            Utils.log(`Cảnh báo: AI trả về JSON lỗi cú pháp, nhưng vẫn được lưu RAW text.`, 'warning');
        }
        // LUÔN LUÔN trả về OK để ép hệ thống nhận Raw Text, không bắt lỗi cú pháp dừng tiến trình
        return { ok: true, data: jsonObj, rawText: cleaned };
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
        const data = await chrome.storage.local.get(['batchFiles', 'currentBatchIndex']);
        const batchFiles = data.batchFiles || [];
        const currentIndex = data.currentBatchIndex || 0;

        if (currentIndex >= batchFiles.length) {
            Utils.log("Đã hết file để xử lý.");
            State.isRunning = false;
            await chrome.storage.local.set({ isRunning: false });
            return;
        }

        const batchData = batchFiles[currentIndex];

        if (batchData.completed) {
            Utils.log(`Batch ${batchData.name} đã completed, bỏ qua...`);
            await BatchProcessor.moveToNextBatch(currentIndex);
            processLoop();
            return;
        }

        Utils.log(`\n=== Bắt đầu xử lý: ${batchData.name} (Batch ${currentIndex + 1}/${batchFiles.length}) ===`);
        await Utils.sendProgressUpdate(`Đang dịch batch ${currentIndex + 1}/${batchFiles.length}: ${batchData.name}`);

        Utils.log("BƯỚC 1: Đánh dấu file đang chạy...");
        const filesForStatus = await chrome.storage.local.get('batchFiles').then(d => d.batchFiles || []);
        if (filesForStatus[currentIndex]) {
            filesForStatus[currentIndex].status = 'translating';
            await chrome.storage.local.set({ batchFiles: filesForStatus });
        }

        let responseObject;
        let rawResponseText = null;
        const expectedCount = batchData.lines.length;
        const MAX_RETRY = 2;
        let retryCount = 0;

        while (true) {
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
                rawResponseText = JSON.stringify(responseObject);

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
                    // Object này giờ có thể bị null nếu AI sinh sai JSON, nhưng không quan trọng vì mình sẽ lưu `rawText`.
                    responseObject = parsed.data || {};
                    rawResponseText = parsed.rawText;
                } else {
                    // Sẽ không bao giờ rơi vào if này nữa vì parseGeminiJson luôn ok:true
                    Utils.log(`❌ Không thể parse JSON từ ${providerName}. Dừng lại để tránh mất dữ liệu.`, 'error');
                    Utils.log(`Parse error: ${parsed.error}`, 'error');
                    Utils.log(`Response preview: ${(parsed.responseText || result.text || '').slice(0, 200)}`, 'error');
                    throw new Error(`PARSE_FAILED: ${providerName} trả về nội dung không hợp lệ. Kiểm tra console để xem response.`);
                }
            }

            const validation = validateTranslationCount(expectedCount, responseObject, rawResponseText);
            if (validation.ok) {
                break;
            }

            const receivedCount = validation.uniqueCount;
            Utils.log(`ERROR_COUNT_MISMATCH: nhận ${receivedCount}/${expectedCount}`, 'error');
            Utils.log(`Thiếu index: ${validation.missing.join(', ') || 'không rõ'}`, 'error');

            if (retryCount >= MAX_RETRY) {
                Utils.log(`Fail cuối sau ${retryCount} retry. Đánh dấu lỗi và chuyển batch kế.`, 'error');
                const filesData = await chrome.storage.local.get(['batchFiles']);
                const batchFiles = filesData.batchFiles || [];
                const fileIdx = (batchData.index !== undefined ? batchData.index : currentIndex);
                if (batchFiles[fileIdx]) {
                    batchFiles[fileIdx].completed = false;
                    batchFiles[fileIdx].status = 'error';
                    batchFiles[fileIdx].errorReason = 'ERROR_COUNT_MISMATCH';
                    batchFiles[fileIdx].missingIndices = validation.missing;
                    batchFiles[fileIdx].retryCount = retryCount;
                    if (rawResponseText) batchFiles[fileIdx].rawText = rawResponseText;
                    await chrome.storage.local.set({ batchFiles });
                }
                await BatchProcessor.moveToNextBatch(batchData.index);
                Utils.log("✓ Đã chuyển batch (do lỗi thiếu index)", 'warning');
                if (!State.copyOnlyMode) {
                    Utils.log(`BƯỚC 5: Nghỉ ${State.promptDelay} giây tránh rate limit...`);
                    await Utils.sendProgressUpdate(`Đang nghỉ ${State.promptDelay} giây...`);
                    await Utils.sleep(State.promptDelay * 1000);
                } else {
                    await Utils.sleep(1000);
                }
                Utils.log("BƯỚC 6: Tiếp tục với batch tiếp theo...\n");
                processLoop();
                return;
            }

            retryCount += 1;
            Utils.log(`Retry ${retryCount}/${MAX_RETRY} sau ${State.promptDelay}s...`, 'warning');
            await Utils.sendProgressUpdate(`Thiếu index → chờ ${State.promptDelay}s rồi retry...`);
            await Utils.sleep(State.promptDelay * 1000);
        }

        Utils.log("BƯỚC 3: Lưu kết quả vào bộ nhớ...");
        await Utils.sendProgressUpdate("Đang lưu kết quả...");

        const batchResult = {
            batchIndex: currentIndex + 1,
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

        Utils.log("BƯỚC 4: Rút script & đánh dấu chỉ mục...");
        await Utils.sendProgressUpdate("Đang chuyển sang batch tiếp theo...");
        await BatchProcessor.moveToNextBatch(currentIndex);
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
const downloadNameByUrl = new Map();

function sanitizeFilenamePart(input) {
    if (!input) return "";
    // Replace characters that are invalid in Windows filenames
    return String(input).replace(/[\\\/:*?"<>|]+/g, "_").trim();
}

function isSpecialProject(name) {
    return !name || name === "Mixed_Files" || name === "Unknown_Project" || name === "Khong_Ro_Ten";
}

function sortProjectNames(projectsMap) {
    const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
    const names = Object.keys(projectsMap);
    return names.sort((a, b) => {
        const aSpecial = isSpecialProject(a);
        const bSpecial = isSpecialProject(b);
        if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
        return collator.compare(a, b);
    });
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    try {
        if (item.byExtensionId !== chrome.runtime.id) return;
        const desired = downloadNameByUrl.get(item.url);
        if (!desired) return;
        suggest({ filename: desired, conflictAction: "uniquify" });
        downloadNameByUrl.delete(item.url);
    } catch (e) {
        // No-op: if anything goes wrong, let Chrome handle the default name
    }
});

async function downloadFullStory() {
    Utils.log("Bắt đầu tải JSONL...");
    const data = await chrome.storage.local.get(['batchFiles', 'batchCount']);
    const batchFiles = data.batchFiles || [];
    const count = data.batchCount || 0;

    const completedFiles = batchFiles.filter(f => f.completed && (f.rawText || f.result));
    if (completedFiles.length === 0) {
        Utils.log("Chưa có nội dung. Hãy chạy dịch trước.", 'warning');
        return;
    }

    // Nhóm các file theo projectName
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
        
        // Tạo JSONL cho project hiện tại
        const jsonl = projectItems.map((item, idx) => {
            const f = item.file;
            
            let finalResponseStr = "";
            if (f.rawText) {
                // CHỈ xài chuỗi RAW AI trả về, không sử dụng JSON.parse để tránh lỗi. Đồng thời ép trên 1 dòng.
                finalResponseStr = f.rawText.replace(/\r?\n|\r/g, " ");
            } else {
                // Xử lý đồ cũ nếu lỡ không có rawText
                finalResponseStr = JSON.stringify(f.result);
            }
            
            // Xây dựng chuỗi tĩnh chuẩn JSONL
            return `{"batchIndex": ${idx + 1}, "response": ${finalResponseStr}}`;
        }).join('\n');

        const docUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(jsonl);
        
        let filename;
        if (pName === "Mixed_Files" || pName === "Unknown_Project" || pName === "Khong_Ro_Ten") {
            // Nếu là tập tin chắp vá từ chế độ Chọn file lẻ hoặc trước bản cập nhật
            filename = `${prefix}${orderPrefix}SubtitleBatch_${projectItems.length}batch_${date}.jsonl`;
        } else {
            // Cấu trúc thư mục mới: NauChaoHeo_Translations/[0324]/caption_output/
            filename = `NauChaoHeo_Translations/${pName}/caption_output/${prefix}${orderPrefix}SubtitleBatch_${pName}_${date}.jsonl`;
        }

        try {
            downloadNameByUrl.set(docUrl, filename);
            chrome.downloads.download({
                url: docUrl,
                filename: filename,
                saveAs: false // Không saveAs để tự chui vào đúng folder mà không spam popup
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    Utils.log(`Lỗi tải thư mục ${pName}: ${chrome.runtime.lastError.message}`, 'error');
                } else {
                    Utils.log(`Đã bắt đầu tải thư mục ${pName}`, 'success');
                }
            });
            // Thêm delay nhẹ giữa các lượt download để tránh Chrome rate-limit
            await Utils.sleep(400);
        } catch (error) {
            Utils.log(`Exception tải ${pName}: ${error}`, 'error');
        }
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
            const firstPendingIndex = batchFiles.findIndex(f => !f.completed);
            const nextIndex = firstPendingIndex >= 0 ? firstPendingIndex : batchFiles.length;
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
