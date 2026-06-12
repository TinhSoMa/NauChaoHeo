(() => {
const GEMINI_SCRIPT_VERSION = "2026.05.23.1";

if (window.__geminiScriptVersion === GEMINI_SCRIPT_VERSION) {
    console.log(`----> Gemini Content Script đã ở bản mới nhất v${GEMINI_SCRIPT_VERSION}`);
} else {
    if (typeof window.__geminiScriptCleanup === 'function') {
        try {
            window.__geminiScriptCleanup();
            console.log("----> ♻️ Đã cleanup Gemini script cũ");
        } catch (e) {
            console.warn("----> ⚠️ Cleanup script cũ thất bại:", e?.message || e);
        }
    }

    window.__geminiScriptVersion = GEMINI_SCRIPT_VERSION;
    window._geminiScriptLoaded = true;
    console.log(`----> Gemini Content Script đã load (Optimized Version v${GEMINI_SCRIPT_VERSION})`);

// ============================================
// GLOBAL STATE
// ============================================
let pollingIntervalId = null; // Quản lý interval để có thể hủy khi cần
let activeInputBox = null;
let activeDocument = null;
let requestInFlight = false;
let pendingRequestResponder = null;

function createSafeSendResponse(sendResponse) {
    let responded = false;
    return (payload) => {
        if (responded) return;
        responded = true;
        requestInFlight = false;
        pendingRequestResponder = null;
        try {
            sendResponse(payload);
        } catch (e) {
            console.warn("----> ⚠️ Gửi response thất bại:", e?.message || e);
        }
    };
}

// ============================================
// DOCUMENT CONTEXT MANAGEMENT
// ============================================
/**
 * Lấy document context - Ưu tiên PiP window vì DOM đã được MOVE vào đó
 * Đây là chiến lược MOVE thay vì CLONE để đảm bảo tương tác thực sự
 */
function getPiPWindow() {
    if (window.documentPictureInPicture && window.documentPictureInPicture.window) {
        return window.documentPictureInPicture.window;
    }
    return window.__pipWindow || null;
}

function getDocumentContext() {
    const pipWin = getPiPWindow();
    if (pipWin && pipWin.document) {
        console.log("----> Sử dụng PiP window document (DOM đã được move)");
        return pipWin.document;
    }
    console.log("----> Sử dụng tab gốc document");
    return document;
}

/**
 * Kiểm tra xem có đang dùng PiP không
 */
function isUsingPiP() {
    const pipWin = getPiPWindow();
    return !!(pipWin && pipWin.document && pipWin.document.body && pipWin.document.body.children.length > 0);
}

function getCandidateDocuments() {
    const docs = [];
    const pipWin = getPiPWindow();
    if (pipWin && !pipWin.closed && pipWin.document) {
        docs.push({ doc: pipWin.document, usingPiP: true });
    }
    docs.push({ doc: document, usingPiP: false });

    // Loại bỏ trùng reference document
    const unique = [];
    const seen = new Set();
    for (const item of docs) {
        if (!item?.doc) continue;
        if (seen.has(item.doc)) continue;
        seen.add(item.doc);
        unique.push(item);
    }
    return unique;
}

function resolveComposerContext() {
    for (const candidate of getCandidateDocuments()) {
        const input = findInputBox(candidate.doc, false);
        if (input) {
            return {
                doc: candidate.doc,
                usingPiP: candidate.usingPiP,
                inputBox: input
            };
        }
    }

    const fallbackDoc = getDocumentContext();
    return {
        doc: fallbackDoc,
        usingPiP: fallbackDoc !== document,
        inputBox: findInputBox(fallbackDoc, true)
    };
}

// ============================================
// MESSAGE LISTENERS
// ============================================
const runtimeMessageListener = (request, sender, sendResponse) => {
    if (request.action === "PASTE_AND_SEND") {
        if (requestInFlight) {
            sendResponse({ status: "BUSY", message: "Gemini content script đang xử lý request trước đó" });
            return false;
        }

        requestInFlight = true;
        const safeSendResponse = createSafeSendResponse(sendResponse);
        pendingRequestResponder = safeSendResponse;

        Promise.resolve(handlePasteAndSend(request.prompt, safeSendResponse, request.options || {}))
            .catch((e) => {
                safeSendResponse({ status: "ERROR", message: e?.message || String(e) });
            });
        return true; // Giữ channel mở cho async response
    } else if (request.action === "PING") {
        sendResponse({ status: "ALIVE" });
        return false;
    } else if (request.action === "CANCEL_POLLING") {
        // HỦY NGAY LẬP TỨC khi nhận lệnh từ background
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            activeInputBox = null;
            activeDocument = null;
            console.log("----> [CANCEL_POLLING_ACK] 🛑 ĐÃ HỦY POLLING - Dừng ngay lập tức!");
        }

        if (typeof pendingRequestResponder === 'function') {
            pendingRequestResponder({ status: "CANCELLED", message: "Đã dừng bởi người dùng" });
        } else {
            requestInFlight = false;
            pendingRequestResponder = null;
        }

        sendResponse({ status: "CANCELLED" });
        console.log("----> [CANCEL_POLLING_ACK] Đã phản hồi CANCELLED cho background");
        // Synchronous response - NOT returning true
    } else if (request.action === "UPDATE_PIP_STATUS") {
        // Chuyển tiếp message này đến pip-script.js
        window.postMessage({
            type: "UPDATE_PIP_STATUS",
            data: request.data
        }, "*");
        sendResponse({ status: "OK" });
        return false;
    } else if (request.action === "UPDATE_PROGRESS") {
        sendResponse({ status: "OK" });
        return false;
    } else if (request.action === "GET_SCRIPT_VERSION") {
        sendResponse({ status: "OK", version: GEMINI_SCRIPT_VERSION });
        return false;
    }
    return false;
};

chrome.runtime.onMessage.addListener(runtimeMessageListener);

// ============================================
// MAIN PASTE AND SEND HANDLER
// ============================================
/**
 * Xử lý chính: Paste text vào Gemini và gửi
 * Đây là "Bot" thao tác Gemini - giả lập hành vi người dùng
 */
async function handlePasteAndSend(fullPrompt, sendResponse, requestOptions = {}) {
    try {
        const context = await waitForComposerReady();
        const doc = context.doc;
        const usingPiP = context.usingPiP;
        const normalizedPrompt = normalizePromptToSingleLine(fullPrompt);
        
        console.log(`----> Đang xử lý trong ${usingPiP ? 'PiP window' : 'tab gốc'}`);
        console.log(`----> Độ dài prompt gốc: ${(fullPrompt || '').length} ký tự`);
        console.log(`----> Độ dài prompt sau chuẩn hóa 1 dòng: ${normalizedPrompt.length} ký tự`);
        
        // BƯỚC 1: Tìm ô nhập liệu
        const inputBox = context.inputBox;
        if (!inputBox) {
            activeInputBox = null;
            activeDocument = null;
            sendResponse({ status: "ERROR", message: "Không tìm thấy ô nhập liệu" });
            return;
        }
        activeInputBox = inputBox;
        activeDocument = doc;

        const existingInputTextLength = getInputTextLength(inputBox);
        if (existingInputTextLength > 0) {
            activeInputBox = null;
            activeDocument = null;
            sendResponse({
                status: "ERROR",
                message: `Ô nhập Gemini đang có sẵn nội dung (${existingInputTextLength} ký tự). Dừng để tránh ghi đè prompt.`
            });
            return;
        }

        // BƯỚC 2: Điền dữ liệu vào ô Contenteditable
        // Kỹ thuật 1: Các framework hiện đại (React/Angular) không nhận diện việc gán value trực tiếp
        // Phải dispatch event 'input' để framework biết có thay đổi
        await fillInputBox(inputBox, normalizedPrompt, usingPiP);

        // Đợi UI cập nhật
        await sleep(1500);

        // BƯỚC 3: Tìm và gửi prompt với nhiều chiến lược fallback
        // Chụp mốc response trước khi gửi để tránh nhầm response cũ là response mới.
        const baselineResponseSignature = getResponseSignature(doc, true);
        const sendTriggered = await triggerSend(doc, inputBox);
        if (!sendTriggered) {
            activeInputBox = null;
            activeDocument = null;
            sendResponse({ status: "ERROR", message: "Không thể kích hoạt gửi prompt tới Gemini" });
            return;
        }
        
        // BƯỚC 4: Chuyển sang chế độ đợi (Polling)
        // Kỹ thuật 2: Phát hiện khi nào Gemini trả lời xong
        waitForReplyCompletion(sendResponse, inputBox, doc, usingPiP, {
            baselineResponseSignature,
            promptSentAt: Date.now(),
            ebookNovelMode: !!requestOptions.ebookNovelMode,
            maxInternalResend: Number.isInteger(requestOptions.maxInternalResend) ? requestOptions.maxInternalResend : 2,
            originalPrompt: normalizedPrompt
        });

    } catch (e) {
        activeInputBox = null;
        activeDocument = null;
        console.error("----> Lỗi:", e);
        sendResponse({ status: "ERROR", message: e.message });
    }
}

function normalizePromptToSingleLine(prompt) {
    return String(prompt || "")
        .replace(/\r?\n|\r/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function buildResponseSignature(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return "";
    const head = normalized.slice(0, 80);
    const tail = normalized.slice(-120);
    return `${normalized.length}:${head}:${tail}`;
}

function buildTurnAwareSignature(turnId, text) {
    const textSig = buildResponseSignature(text);
    if (!textSig) return "";
    return `${String(turnId || "no-turn")}::${textSig}`;
}

function getResponseSignature(docOverride = null, silent = true) {
    const data = extractGeminiResponseData(docOverride, silent);
    return data?.signature || "";
}

async function waitForComposerReady(maxWaitMs = 120000, intervalMs = 500) {
    const startAt = Date.now();
    let attempt = 0;

    while (Date.now() - startAt < maxWaitMs) {
        attempt++;
        const context = resolveComposerContext();
        const doc = context.doc;
        const inputBox = context.inputBox;
        const stopButton = findVisibleStopButton(doc);

        if (!stopButton && isInputBoxReady(inputBox)) {
            if (attempt > 1) {
                console.log(`----> ✓ Gemini đã sẵn sàng nhận prompt (đợi ${attempt} lượt)`);    
            }
            return context;
        }

        if (attempt % 6 === 0) {
            console.log(`----> Đang chờ Gemini hoàn tất phản hồi trước đó... (${attempt})`);
        }

        await sleep(intervalMs);
    }

    throw new Error("Gemini chưa sẵn sàng để gửi prompt mới (timeout chờ hết phản hồi trước đó)");
}

// ============================================
// DOM SELECTORS
// ============================================
/**
 * Tìm ô nhập liệu của Gemini
 * Gemini sử dụng contenteditable div thay vì textarea
 */
function findInputBox(doc, logWhenMissing = true) {
    const preferredSelectors = [
        'rich-textarea .ql-editor[contenteditable="true"][role="textbox"]',
        'input-area-v2 .ql-editor[contenteditable="true"][role="textbox"]',
        'div.text-input-field_textarea-inner .ql-editor[contenteditable="true"][role="textbox"]',
        'rich-textarea .ql-editor[contenteditable="true"]',
        'input-area-v2 .ql-editor[contenteditable="true"]',
        '[data-test-id="textarea-inner"] .ql-editor[contenteditable="true"]'
    ];
    const preferredCandidates = [];
    for (const selector of preferredSelectors) {
        const matches = doc.querySelectorAll(selector);
        for (const el of matches) {
            if (!preferredCandidates.includes(el)) {
                preferredCandidates.push(el);
            }
        }
    }

    const preferred = preferredCandidates.find((el) => isElementVisible(el));
    if (preferred) {
        return preferred;
    }

    const fallback = Array.from(doc.querySelectorAll(
        'div[contenteditable="true"][role="textbox"], div[contenteditable="true"].ql-editor, rich-textarea div[contenteditable="true"]'
    ))
        .find((el) => isElementVisible(el));
    if (fallback) {
        console.log("----> Tìm thấy ô nhập liệu qua fallback selector");
        return fallback;
    }

    const unstableButUsable = preferredCandidates.find((el) => {
        if (!el || !el.isConnected) return false;
        return !!el.closest('rich-textarea, input-area-v2, [data-test-id="textarea-inner"]');
    });
    if (unstableButUsable) {
        if (logWhenMissing) {
            console.warn("----> Tìm thấy ô nhập liệu nhưng chưa visible ổn định (PiP/layout đang đồng bộ)");
        }
        return unstableButUsable;
    }

    if (logWhenMissing) {
        console.error("----> Không tìm thấy ô nhập liệu!");
    }
    return null;
}

function isInputBoxReady(inputBox) {
    if (!inputBox || !inputBox.isConnected) return false;
    if (isElementVisible(inputBox)) return true;
    return !!inputBox.closest('rich-textarea, input-area-v2, [data-test-id="textarea-inner"]');
}

function isElementVisible(el) {
    if (!el) return false;
    const style = (el.ownerDocument?.defaultView || window).getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isElementActuallyVisible(el) {
    if (!isElementVisible(el)) return false;
    const doc = el.ownerDocument || document;
    const win = doc.defaultView || window;
    const rect = el.getBoundingClientRect();
    const vw = win.innerWidth || doc.documentElement.clientWidth || 0;
    const vh = win.innerHeight || doc.documentElement.clientHeight || 0;
    if (!vw || !vh) return false;

    // Phải nằm trong viewport thực tế.
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw) {
        return false;
    }

    // Điểm trung tâm phải không bị phần tử khác che.
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 1), Math.max(vw - 1, 1));
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 1), Math.max(vh - 1, 1));
    const topEl = doc.elementFromPoint(cx, cy);
    if (!topEl) return false;
    return topEl === el || el.contains(topEl);
}

function isButtonEnabled(button) {
    if (!button) return false;
    if (button.disabled) return false;
    const ariaDisabled = button.getAttribute('aria-disabled');
    return ariaDisabled !== 'true';
}

function isActionMenuButton(button) {
    if (!button) return false;
    const className = String(button.className || '').toLowerCase();
    const dataTestId = (button.getAttribute('data-test-id') || '').toLowerCase();
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    const hasPopupMenu = (button.getAttribute('aria-haspopup') || '').toLowerCase() === 'menu';
    const hasMoreIcon = !!button.querySelector('mat-icon[fonticon="more_horiz"]');

    return (
        className.includes('conversation-actions-menu-button') ||
        className.includes('menu-trigger') ||
        dataTestId.includes('actions-menu-button') ||
        dataTestId.includes('actions-menu') ||
        ariaLabel.includes('lựa chọn khác') ||
        ariaLabel.includes('other options') ||
        ariaLabel.includes('more options') ||
        hasPopupMenu ||
        hasMoreIcon
    );
}

function looksLikeSendButton(button) {
    if (!button) return false;
    const type = (button.getAttribute('type') || '').toLowerCase();
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    const dataTestId = (button.getAttribute('data-test-id') || '').toLowerCase();
    const icon = (button.querySelector('mat-icon')?.getAttribute('fonticon') || '').toLowerCase();
    return (
        type === 'submit' ||
        ariaLabel.includes('send') ||
        ariaLabel.includes('gửi') ||
        ariaLabel.includes('submit') ||
        icon.includes('send') ||
        icon.includes('arrow_upward') ||
        dataTestId.includes('send')
    );
}

function findVisibleStopButton(doc) {
    const candidates = [
        'button[data-test-id*="stop"]',
        'button[aria-label*="Stop"]',
        'button[aria-label*="Dừng"]'
    ];

    for (const selector of candidates) {
        const button = doc.querySelector(selector);
        if (button && isElementVisible(button)) {
            return button;
        }
    }

    const iconFallback = doc.querySelector(
        'button mat-icon[fonticon="stop"], ' +
        'button mat-icon[fonticon="square"], ' +
        'div.stop-icon mat-icon[fonticon="stop"]'
    );
    if (iconFallback && isElementVisible(iconFallback)) {
        const clickable = iconFallback.closest('button, div.stop-icon, div.blue-circle') || iconFallback;
        if (isElementVisible(clickable)) {
            return clickable;
        }
    }

    return null;
}

function looksLikeCopyButton(button) {
    if (!button) return false;
    const dataTestId = (button.getAttribute('data-test-id') || '').toLowerCase();
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    const icon = (button.querySelector('mat-icon')?.getAttribute('fonticon') || '').toLowerCase();
    return (
        dataTestId === 'copy-button' ||
        ariaLabel.includes('sao chép') ||
        ariaLabel.includes('copy') ||
        icon.includes('content_copy')
    );
}

function findCopyButton(doc) {
    if (!doc) return null;

    const primary = doc.querySelector('button[data-test-id="copy-button"]');
    if (primary && isElementVisible(primary) && isButtonEnabled(primary)) {
        return primary;
    }

    const candidates = Array.from(doc.querySelectorAll('button'))
        .filter((button) => looksLikeCopyButton(button) && isElementVisible(button));

    const enabled = candidates.find((button) => isButtonEnabled(button));
    if (enabled) return enabled;

    return candidates[0] || null;
}

function getInputTextLength(inputBox) {
    if (!inputBox) return 0;
    const text = (inputBox.innerText || inputBox.textContent || '').trim();
    return text.length;
}

/**
 * Tìm nút Gửi (Send button)
 * Gemini có thể dùng aria-label khác nhau tùy ngôn ngữ
 */
function findSendButton(doc, inputBox = null, logWhenMissing = true) {
    // UI Gemini mới: ưu tiên cụm send-button-container + icon arrow_upward
    const selectors = [
        'div.send-button-container button[aria-label*="Gửi"]',
        'div.send-button-container button[aria-label*="Send"]',
        'div.send-button-container button[data-test-id*="send"]',
        'div.send-button-container button:has(mat-icon[fonticon="arrow_upward"])'
    ];

    const candidates = [];
    const seen = new Set();

    // Ưu tiên scope gần ô input để tránh bắt nhầm nút Send không liên quan
    const scopedRoots = [];
    if (inputBox) {
        let current = inputBox;
        let depth = 0;
        while (current && depth < 10) {
            scopedRoots.push(current);
            if (current.tagName === 'BODY') break;
            current = current.parentElement;
            depth++;
        }
    }

    for (const root of scopedRoots) {
        if (!root) continue;
        for (const selector of selectors) {
            const matches = root.querySelectorAll(selector);
            for (const button of matches) {
                if (!seen.has(button)) {
                    seen.add(button);
                    if (!isActionMenuButton(button) && looksLikeSendButton(button)) {
                        candidates.push({ button, selector, scope: 'scoped' });
                    }
                }
            }
        }
    }

    // Fallback: tìm toàn document (new-only selectors)
    for (const selector of selectors) {
        const matches = doc.querySelectorAll(selector);
        for (const button of matches) {
            if (!seen.has(button)) {
                seen.add(button);
                if (!isActionMenuButton(button) && looksLikeSendButton(button)) {
                    candidates.push({ button, selector, scope: 'document' });
                }
            }
        }
    }

    // Ưu tiên button nhìn thấy + enabled
    const best = candidates.find(({ button }) => isElementActuallyVisible(button) && isButtonEnabled(button));
    if (best) {
        const dataTestId = best.button.getAttribute('data-test-id') || '';
        const ariaLabel = best.button.getAttribute('aria-label') || '';
        console.log(`----> Tìm thấy nút Send: ${best.selector} (${best.scope}) | data-test-id=${dataTestId} | aria-label=${ariaLabel}`);
        return best.button;
    }

    // Nếu không có button enabled, trả button nhìn thấy đầu tiên để polling vẫn hoạt động
    const visible = candidates.find(({ button }) => isElementActuallyVisible(button));
    if (visible) {
        const dataTestId = visible.button.getAttribute('data-test-id') || '';
        const ariaLabel = visible.button.getAttribute('aria-label') || '';
        console.log(`----> Tìm thấy nút Send (visible, có thể đang disabled): ${visible.selector} (${visible.scope}) | data-test-id=${dataTestId} | aria-label=${ariaLabel}`);
        return visible.button;
    }
    
    if (logWhenMissing) {
        console.warn("----> Không tìm thấy nút Send!");
    }
    return null;
}

function simulateEnterOnInput(inputBox, withCtrl = false) {
    const eventOptions = {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        ctrlKey: withCtrl
    };
    inputBox.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
    inputBox.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
    inputBox.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
}

function submitNearestForm(inputBox) {
    const form = inputBox.closest('form');
    if (!form) {
        return false;
    }

    try {
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
        form.dispatchEvent(submitEvent);
        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
        }
        return true;
    } catch (e) {
        console.warn("----> ⚠️ Gửi qua form thất bại:", e?.message || e);
        return false;
    }
}

async function waitForGenerationStart(doc, inputBox, label, expectedPromptLength = 0, baselineResponseSignature = "") {
    // Poll vài giây để chịu được UI lag/chậm render trạng thái generating.
    const maxChecks = 20; // ~6s
    const intervalMs = 300;

    for (let i = 0; i < maxChecks; i++) {
        await sleep(intervalMs);

        if (isGeminiGenerating(doc, inputBox)) {
            console.log(`----> ✓ Gemini đã bắt đầu xử lý sau ${label}`);
            return true;
        }

        // Fallback đáng tin cậy hơn input-cleared:
        // chỉ coi là đã nhận prompt khi response bắt đầu khác mốc trước gửi.
        if (baselineResponseSignature) {
            const currentResponseSignature = getResponseSignature(doc, true);
            if (currentResponseSignature && currentResponseSignature !== baselineResponseSignature) {
                console.log(`----> ✓ Gemini đã nhận prompt sau ${label} (response đã thay đổi)`);
                return true;
            }
        }
    }

    console.log(`----> [debug] Gemini chưa bắt đầu sau ${label}`);
    return false;
}

async function confirmPromptAccepted(doc, inputBox, baselineResponseSignature, label, maxWaitMs = 15000, intervalMs = 500) {
    const checks = Math.max(1, Math.floor(maxWaitMs / intervalMs));
    for (let i = 0; i < checks; i++) {
        await sleep(intervalMs);

        if (isGeminiGenerating(doc, inputBox)) {
            console.log(`----> ✓ Gemini đã xác nhận nhận prompt sau ${label} (thấy Stop)`);
            return true;
        }

        const currentResponseSignature = getResponseSignature(doc, true);
        if (currentResponseSignature && currentResponseSignature !== baselineResponseSignature) {
            console.log(`----> ✓ Gemini đã xác nhận nhận prompt sau ${label} (response đổi)`);
            return true;
        }
    }
    return false;
}

function isGeminiGenerating(doc, inputBox = null) {
    const stopButton = findVisibleStopButton(doc);
    return !!stopButton;
}

function robustClickButton(button) {
    if (!button) return;
    button.focus();
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function clearInputBoxSafely(inputBox) {
    if (!inputBox) return;
    try {
        inputBox.focus();
        inputBox.textContent = '';
        inputBox.innerText = '';
        inputBox.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward',
            data: null
        }));
        inputBox.dispatchEvent(new Event('input', { bubbles: true }));
        inputBox.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
        // no-op
    }
}

async function readClipboardWithPolling(maxChecks = 6, intervalMs = 250) {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        return { ok: false, reason: 'CLIPBOARD_API_NOT_AVAILABLE' };
    }

    for (let i = 0; i < maxChecks; i++) {
        try {
            const text = await navigator.clipboard.readText();
            const normalized = (text || '').trim();
            if (normalized.length > 50) {
                return { ok: true, text: normalized };
            }
        } catch (e) {
            if (i === maxChecks - 1) {
                return { ok: false, reason: e?.message || 'CLIPBOARD_READ_FAILED' };
            }
        }
        await sleep(intervalMs);
    }

    return { ok: false, reason: 'CLIPBOARD_EMPTY_OR_TOO_SHORT' };
}

function waitForCopyEventText(doc, timeoutMs = 2500) {
    return new Promise((resolve) => {
        let settled = false;
        let timerId = null;

        const cleanup = () => {
            if (timerId) {
                clearTimeout(timerId);
                timerId = null;
            }
            try {
                doc.removeEventListener('copy', onCopy, true);
            } catch (e) {
                // no-op
            }
        };

        const finish = (result) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(result);
        };

        const onCopy = (event) => {
            try {
                const text = event?.clipboardData?.getData('text/plain') || '';
                const normalized = text.trim();
                if (normalized.length > 50) {
                    finish({ ok: true, text: normalized, source: 'copy_event' });
                    return;
                }
            } catch (e) {
                // fallback timeout/readText path
            }
        };

        doc.addEventListener('copy', onCopy, true);
        timerId = setTimeout(() => {
            finish({ ok: false, reason: 'COPY_EVENT_TIMEOUT' });
        }, timeoutMs);
    });
}

async function tryCopyGeminiResponse(doc) {
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const copyButton = findCopyButton(doc);
        if (!copyButton) {
            await sleep(300);
            continue;
        }
        if (!isButtonEnabled(copyButton)) {
            await sleep(250);
            continue;
        }

        const copyEventPromise = waitForCopyEventText(doc, 2500);
        robustClickButton(copyButton);
        console.log(`----> Đã click copy-button (lần ${attempt}/${maxAttempts})`);

        const copyEventResult = await copyEventPromise;
        if (copyEventResult.ok) {
            console.log("----> ✓ Lấy response từ copy event");
            return { ok: true, text: copyEventResult.text, source: 'gemini_copy_button' };
        }

        const clipboard = await readClipboardWithPolling(6, 250);
        if (clipboard.ok) {
            console.log("----> ✓ Lấy response từ clipboard qua copy-button");
            return { ok: true, text: clipboard.text, source: 'gemini_copy_button' };
        }

        console.warn(`----> ⚠️ Đọc clipboard chưa thành công: ${clipboard.reason}`);
        await sleep(250);
    }

    return { ok: false, reason: 'COPY_BUTTON_FLOW_FAILED' };
}

async function triggerSend(doc, inputBox) {
    inputBox.focus();
    const promptLength = getInputTextLength(inputBox);
    const baselineResponseSignature = getResponseSignature(doc, true);

    // Không dùng Enter vì Gemini UI hiện tại không bind Enter ổn định trong luồng này.
    // Ưu tiên click nút gửi, sau đó fallback submit form.
    const preferredSendButton = doc.querySelector(
        'div.send-button-container button[aria-label*="Gửi"], ' +
        'div.send-button-container button[aria-label*="Send"], ' +
        'div.send-button-container button[data-test-id*="send"], ' +
        'div.send-button-container button:has(mat-icon[fonticon="arrow_upward"])'
    );
    const sendButton = preferredSendButton || findSendButton(doc, inputBox, false);

    if (sendButton && isElementVisible(sendButton) && isButtonEnabled(sendButton)) {
        robustClickButton(sendButton);
        console.log("----> Đã click nút Gửi (chuỗi mouse events)");

        if (await waitForGenerationStart(doc, inputBox, "click Send", promptLength, baselineResponseSignature)) {
            return true;
        }
        if (await confirmPromptAccepted(doc, inputBox, baselineResponseSignature, "click Send")) {
            return true;
        }
    }

    const submittedByForm = submitNearestForm(inputBox);
    if (submittedByForm) {
        console.log("----> Đã fallback submit form gần input");
        if (await waitForGenerationStart(doc, inputBox, "submit form", promptLength, baselineResponseSignature)) {
            return true;
        }
        if (await confirmPromptAccepted(doc, inputBox, baselineResponseSignature, "submit form")) {
            return true;
        }
    }

    // Retry thêm vài nhịp để chịu được UI lag nặng sau nhiều chapter.
    for (let retry = 1; retry <= 3; retry++) {
        await sleep(800 + retry * 300);
        const retryButton = findSendButton(doc, inputBox, false);
        if (retryButton && isElementVisible(retryButton) && isButtonEnabled(retryButton)) {
            robustClickButton(retryButton);
            console.log(`----> Retry click Send lần ${retry}/3`);
            if (await waitForGenerationStart(doc, inputBox, `retry click Send ${retry}`, promptLength, baselineResponseSignature)) {
                return true;
            }
            if (await confirmPromptAccepted(doc, inputBox, baselineResponseSignature, `retry click Send ${retry}`, 12000, 500)) {
                return true;
            }
        }

        if (submitNearestForm(inputBox)) {
            console.log(`----> Retry submit form lần ${retry}/3`);
            if (await waitForGenerationStart(doc, inputBox, `retry submit form ${retry}`, promptLength, baselineResponseSignature)) {
                return true;
            }
            if (await confirmPromptAccepted(doc, inputBox, baselineResponseSignature, `retry submit form ${retry}`, 12000, 500)) {
                return true;
            }
        }
    }

    console.warn("----> ❌ Không kích hoạt được gửi prompt (click Send + submit form đều thất bại)");
    return false;
}

// ============================================
// INPUT FILLING
// ============================================
/**
 * Điền text vào ô input
 * Kỹ thuật: Phải dispatch event để framework (React/Angular) nhận diện
 */
async function fillInputBox(inputBox, text, usingPiP) {
    // Focus vào ô input
    inputBox.focus();
    
    // Xóa nội dung cũ (nếu có)
    inputBox.textContent = '';
    
    // Đợi một chút
    await sleep(300);
    
    // Điền text - ưu tiên mô phỏng paste/input giống người dùng thật
    const ownerDoc = inputBox.ownerDocument || document;
    const ownerWin = ownerDoc.defaultView || window;
    if (usingPiP) {
        console.log("----> Dán text vào PiP window (DOM đã được move)");
    } else {
        console.log("----> Dán text vào tab gốc");
    }

    let inserted = false;

    try {
        if (inputBox.isContentEditable) {
            const selection = ownerWin.getSelection ? ownerWin.getSelection() : null;
            if (selection) {
                const range = ownerDoc.createRange();
                range.selectNodeContents(inputBox);
                range.deleteContents();
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }

            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', text);
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
            });
            const accepted = inputBox.dispatchEvent(pasteEvent);
            if (!accepted) {
                inserted = true;
            }
        }
    } catch (e) {
        // Fallback ở dưới sẽ xử lý tiếp
    }

    try {
        if (!inserted) {
            const success = ownerDoc.execCommand('insertText', false, text);
            inserted = !!success;
        }
    } catch (e) {
        // fallback cuối cùng
    }

    if (!inserted) {
        inputBox.textContent = text;
    }

    // QUAN TRỌNG: Kích hoạt sự kiện để framework biết đã có chữ
    // Dispatch nhiều event để đảm bảo framework nhận diện
    inputBox.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text.slice(-1)
    }));
    inputBox.dispatchEvent(new Event('input', { bubbles: true }));
    inputBox.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Đợi thêm để UI cập nhật
    await sleep(500);
    
    console.log(`----> ✓ Đã điền ${text.length} ký tự vào ô input`);
}

// ============================================
// POLLING MECHANISM
// ============================================
/**
 * Đợi Gemini trả lời xong
 * Kỹ thuật 2: Polling - Kiểm tra liên tục trạng thái của nút Send
 * 
 * Logic:
 * - Khi Gemini đang viết: Nút Send biến mất hoặc bị disable
 * - Khi Gemini viết xong: Nút Send hiện lại và enabled
 */
function waitForReplyCompletion(sendResponse, inputBox = null, contextDoc = null, contextUsingPiP = false, options = {}) {
    console.log("----> Đang đợi Gemini trả lời...");
    if (options?.ebookNovelMode) {
        waitForReplyCompletionEbookNovel(sendResponse, inputBox, contextDoc, contextUsingPiP, options);
        return;
    }
    
    let checkCount = 0;
    const maxChecks = 120; // Đợi tối đa 6 phút (120 * 3s)
    const checkIntervalMs = 3000; // Kiểm tra mỗi 3 giây
    
    let hasStartedGenerating = false; // Flag để biết Gemini đã bắt đầu generate chưa
    let generatingStartedAt = 0;
    let stableResponseChecks = 0;
    let lastResponseSignature = '';
    let noStopChecks = 0;
    let hasSeenResponseChange = false;
    let firstResponseChangeAt = 0;
    let lastResponseChangeAt = 0;
    let latestChangedResponseSignature = "";
    let latestChangedResponseText = "";
    let responseDomObserver = null;
    let lastResponseDomMutationAt = Date.now();
    const baselineResponseSignature = options?.baselineResponseSignature || "";
    const promptSentAt = options?.promptSentAt || Date.now();

    // Clear interval cũ nếu còn tồn tại (tránh memory leak)
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }

    const attachResponseDomObserver = (doc) => {
        if (!doc || responseDomObserver) return;
        try {
            responseDomObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    const target = mutation.target;
                    if (isResponseDomNode(target)) {
                        lastResponseDomMutationAt = Date.now();
                        return;
                    }
                    if (mutation.addedNodes) {
                        for (const node of mutation.addedNodes) {
                            if (isResponseDomNode(node)) {
                                lastResponseDomMutationAt = Date.now();
                                return;
                            }
                        }
                    }
                }
            });
            responseDomObserver.observe(doc.body, {
                subtree: true,
                childList: true,
                characterData: true
            });
        } catch (e) {
            console.warn("----> ⚠️ Không attach được response DOM observer:", e?.message || e);
        }
    };

    const cleanupResponseDomObserver = () => {
        if (responseDomObserver) {
            responseDomObserver.disconnect();
            responseDomObserver = null;
        }
    };

    // Gán vào biến global để có thể hủy từ bên ngoài
    pollingIntervalId = setInterval(async () => {
        checkCount++;
        const doc = contextDoc || activeDocument || getDocumentContext();
        const usingPiP = contextUsingPiP || doc !== document;
        attachResponseDomObserver(doc);
        
        console.log(`----> [${checkCount}/${maxChecks}] Kiểm tra trạng thái Gemini (${usingPiP ? 'PiP' : 'Tab gốc'})...`);
        
        // Tìm nút Send
        const sendButton = findSendButton(doc, inputBox || activeInputBox, false);
        
        // Kiểm tra xem Gemini có đang generate không
        // Chỉ tin vào Stop button. Nút Send có thể disabled ngay cả khi đã xong
        // do input rỗng, nên không dùng làm tín hiệu "đang generate".
        const stopButton = findVisibleStopButton(doc);
        const isGenerating = !!stopButton;
        
        if (isGenerating) {
            hasStartedGenerating = true;
            if (!generatingStartedAt) {
                generatingStartedAt = Date.now();
            }
            noStopChecks = 0;
            stableResponseChecks = 0;
            lastResponseSignature = '';
            console.log(`----> [${checkCount}] Gemini đang xử lý... (có nút Stop)`);
            return; // Tiếp tục đợi
        }

        noStopChecks++;

        // Không thấy tín hiệu generate nữa, kiểm tra response có ổn định chưa.
        const responseData = extractGeminiResponseData(doc, true);
        const responseText = responseData?.text || "";
        const responseLength = responseText.length;

        const hasMeaningfulResponse = responseLength > 50;
        const hasInputCleared = (getInputTextLength(inputBox || activeInputBox || null) <= 2);
        const responseSignature = hasMeaningfulResponse
            ? (responseData?.signature || "")
            : '';
        const responseChangedNow = !!responseSignature && responseSignature !== baselineResponseSignature;

        if (responseChangedNow) {
            if (responseSignature !== latestChangedResponseSignature) {
                latestChangedResponseSignature = responseSignature;
                latestChangedResponseText = responseText || "";
                lastResponseChangeAt = Date.now();
            }
            hasSeenResponseChange = true;
            if (!firstResponseChangeAt) {
                firstResponseChangeAt = Date.now();
            }
        }

        const effectiveResponseSignature = hasSeenResponseChange
            ? latestChangedResponseSignature
            : responseSignature;
        const effectiveResponseText = hasSeenResponseChange
            ? latestChangedResponseText
            : (responseText || "");
        const effectiveResponseLength = effectiveResponseText.length;
        const effectiveHasMeaningfulResponse = effectiveResponseLength > 50;
        const responseChangedLocked = hasSeenResponseChange;

        if (effectiveResponseSignature && effectiveResponseSignature === lastResponseSignature) {
            stableResponseChecks++;
        } else {
            stableResponseChecks = effectiveResponseSignature ? 1 : 0;
            lastResponseSignature = effectiveResponseSignature;
        }
        
        // Điều kiện hoàn thành (siết chặt để tránh false-finish khi UI lag):
        // 1) Có nút Send visible + enabled, response ổn định >= 3 lượt, không thấy Stop >= 3 lượt, input đã được clear.
        // 2) Fallback cực chặt khi không tìm thấy nút Send: response ổn định >= 4 lượt và không thấy Stop >= 5 lượt.
        const sendReady = !stopButton && !!sendButton && isElementVisible(sendButton);
        const doneByStableResponse = !sendButton && effectiveHasMeaningfulResponse && responseChangedLocked && stableResponseChecks >= 4 && noStopChecks >= 5 && hasInputCleared;
        const doneBySendReadyStable = sendReady && effectiveHasMeaningfulResponse && responseChangedLocked && stableResponseChecks >= 3 && noStopChecks >= 3 && hasInputCleared;
        const generationElapsedMs = generatingStartedAt ? (Date.now() - generatingStartedAt) : 0;
        const minElapsedReached = generationElapsedMs >= 4000 || !hasStartedGenerating;
        const elapsedSinceSendMs = Date.now() - promptSentAt;
        const minPostSendDelayReached = elapsedSinceSendMs >= 2500;
        const responseChangedElapsedMs = firstResponseChangeAt ? (Date.now() - firstResponseChangeAt) : 0;
        const responseQuietElapsedMs = lastResponseChangeAt ? (Date.now() - lastResponseChangeAt) : 0;
        const responseDomQuietElapsedMs = Date.now() - lastResponseDomMutationAt;
        const copyButton = findCopyButton(doc);
        const hasCopyReadySignal = !!(copyButton && isButtonEnabled(copyButton));
        const doneByStableResponseStrict = doneByStableResponse &&
            hasSeenResponseChange &&
            stableResponseChecks >= 5 &&
            responseChangedElapsedMs >= 12000 &&
            responseQuietElapsedMs >= 9000 &&
            responseDomQuietElapsedMs >= 7000 &&
            (hasCopyReadySignal || noStopChecks >= 8);
        const doneBySendReadyStrict = doneBySendReadyStable &&
            responseQuietElapsedMs >= 6000 &&
            responseDomQuietElapsedMs >= 5000;

        // Gate kiểm tra tuần tự để tránh "chốt done" khi một điều kiện vẫn chưa đủ.
        let gateBlockedReason = "";
        if (!(hasStartedGenerating || checkCount > 3)) {
            gateBlockedReason = "chưa qua gate khởi động";
        } else if (!minElapsedReached) {
            gateBlockedReason = `chưa qua gate thời gian generate (${generationElapsedMs}ms)`;
        } else if (!minPostSendDelayReached) {
            gateBlockedReason = `chưa qua gate trễ hậu gửi (${elapsedSinceSendMs}ms)`;
        } else if (!responseChangedLocked) {
            gateBlockedReason = "chưa qua gate response mới";
        } else if (!hasInputCleared) {
            gateBlockedReason = "chưa qua gate input clear";
        } else if (!effectiveHasMeaningfulResponse) {
            gateBlockedReason = `chưa qua gate độ dài response (${effectiveResponseLength})`;
        } else if (sendReady) {
            if (!doneBySendReadyStable) {
                gateBlockedReason = "chưa qua gate send-ready stable";
            } else if (responseQuietElapsedMs < 6000) {
                gateBlockedReason = `chưa qua gate send-ready quiet (${responseQuietElapsedMs}ms)`;
            }
        } else {
            if (!doneByStableResponse) {
                gateBlockedReason = "chưa qua gate fallback stable";
            } else if (!hasSeenResponseChange) {
                gateBlockedReason = "chưa qua gate seen response change";
            } else if (stableResponseChecks < 5) {
                gateBlockedReason = `chưa qua gate stable count (${stableResponseChecks})`;
            } else if (responseChangedElapsedMs < 12000) {
                gateBlockedReason = `chưa qua gate changed elapsed (${responseChangedElapsedMs}ms)`;
            } else if (responseQuietElapsedMs < 9000) {
                gateBlockedReason = `chưa qua gate quiet elapsed (${responseQuietElapsedMs}ms)`;
            } else if (responseDomQuietElapsedMs < 7000) {
                gateBlockedReason = `chưa qua gate DOM quiet elapsed (${responseDomQuietElapsedMs}ms)`;
            } else if (!(hasCopyReadySignal || noStopChecks >= 8)) {
                gateBlockedReason = "chưa qua gate copyReady/noStop";
            }
        }

        const passedSequentialGates = gateBlockedReason === "";
        if (passedSequentialGates && (doneBySendReadyStrict || doneByStableResponseStrict)) {
            if (!effectiveHasMeaningfulResponse) {
                console.log(`----> [${checkCount}] ⚠️ Đã có tín hiệu hoàn thành nhưng response quá ngắn (${effectiveResponseLength} ký tự), đợi thêm...`);
            } else {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
                cleanupResponseDomObserver();
                activeInputBox = null;
                activeDocument = null;
                console.log(`----> [${checkCount}] ✓ Gemini đã hoàn thành (${doneByStableResponseStrict ? 'fallback nghiêm ngặt theo độ ổn định response' : 'nút Send + response ổn định'})`);

                // TẠM TẮT copy-button flow do PiP thường không có focused document cho Clipboard API.
                // const copied = await tryCopyGeminiResponse(doc);
                // if (copied.ok) {
                //     sendResponse({
                //         status: "DONE",
                //         text: copied.text,
                //         source: copied.source
                //     });
                //     return;
                // }
                // console.warn(`----> ⚠️ Copy-button thất bại (${copied.reason}), fallback sang DOM extraction`);
                const fallbackText = extractGeminiResponse(doc, false);
                sendResponse({
                    status: "DONE",
                    text: latestChangedResponseText || fallbackText || responseText,
                    source: "dom_fallback"
                });
            }
        } else if (gateBlockedReason) {
            console.log(`----> [${checkCount}] Gate block: ${gateBlockedReason}`);
        } else if (!sendButton) {
            console.log(`----> [${checkCount}] Chưa tìm thấy nút Send, theo dõi response mới... (${responseLength} ký tự, changedNow=${responseChangedNow}, changedLocked=${responseChangedLocked}, noStop=${noStopChecks}, stable=${stableResponseChecks}, quietMs=${responseQuietElapsedMs}, domQuietMs=${responseDomQuietElapsedMs}, changedMs=${responseChangedElapsedMs}, copyReady=${hasCopyReadySignal}, cleared=${hasInputCleared})`);
        } else {
            console.log(`----> [${checkCount}] Có nút Send nhưng chưa đủ điều kiện (changedNow=${responseChangedNow}, changedLocked=${responseChangedLocked}, noStop=${noStopChecks}, stable=${stableResponseChecks}, quietMs=${responseQuietElapsedMs}, domQuietMs=${responseDomQuietElapsedMs}, len=${responseLength}, cleared=${hasInputCleared}, enabled=${isButtonEnabled(sendButton)})`);
        }

        // Timeout sau maxChecks lần kiểm tra
        if (checkCount >= maxChecks) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            cleanupResponseDomObserver();
            activeInputBox = null;
            activeDocument = null;
            console.error("----> ❌ Timeout: Quá thời gian chờ!");
            sendResponse({ status: "TIMEOUT", message: "Quá thời gian chờ" });
        }

    }, checkIntervalMs);
}

function waitForReplyCompletionEbookNovel(sendResponse, inputBox = null, contextDoc = null, contextUsingPiP = false, options = {}) {
    console.log("----> [Novel] Đang đợi Gemini trả lời theo sequencer tuần tự...");

    const PHASE = {
        WAIT_CHANGE: "WAIT_CHANGE",
        WAIT_STABLE_3: "WAIT_STABLE_3",
        CHECK_STOP: "CHECK_STOP",
        FORCE_STOP_DONE_OR_RESEND: "FORCE_STOP_DONE_OR_RESEND"
    };

    const maxChecks = 120;
    const checkIntervalMs = 3000;
    const maxInternalResend = Number.isInteger(options?.maxInternalResend) ? options.maxInternalResend : 2;
    const originalPrompt = String(options?.originalPrompt || "").trim();
    let promptToken = 0;
    let resendAttempt = 0;
    let checkCount = 0;
    let phase = PHASE.WAIT_CHANGE;
    let stableCount = 0;
    let noChangeCount = 0;
    let isTickRunning = false;
    let latestChangedResponseText = "";
    let latestChangedResponseSignature = "";
    let baselineResponseSignature = options?.baselineResponseSignature || "";
    let lastResponseLength = -1;
    let phaseStartedAt = Date.now();

    const resetForNextPromptAttempt = (newBaselineSignature) => {
        promptToken += 1;
        phase = PHASE.WAIT_CHANGE;
        stableCount = 0;
        noChangeCount = 0;
        lastResponseLength = -1;
        latestChangedResponseText = "";
        latestChangedResponseSignature = "";
        baselineResponseSignature = newBaselineSignature || "";
        phaseStartedAt = Date.now();
    };

    const stopAndCleanup = () => {
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
        }
        activeInputBox = null;
        activeDocument = null;
    };

    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }

    pollingIntervalId = setInterval(async () => {
        if (isTickRunning) return;
        isTickRunning = true;
        try {
            checkCount++;
            const doc = contextDoc || activeDocument || getDocumentContext();
            const effectiveInput = inputBox || activeInputBox;
            const usingPiP = contextUsingPiP || doc !== document;
            const stopControl = findVisibleStopButton(doc);
            const stopVisible = !!stopControl;
            const responseData = extractGeminiResponseData(doc, true);
            const rawResponseText = responseData?.text || "";
            const responseText = rawResponseText.trim();
            const responseSignature = responseData?.signature || "";
            const responseLength = responseText.length;
            const responseChangedNow = !!responseSignature && responseSignature !== baselineResponseSignature;
            const hasEndMarker = /hết chương/i.test(responseText);
            const hasInputCleared = getInputTextLength(effectiveInput) <= 2;

            if (responseChangedNow) {
                latestChangedResponseText = responseText;
                latestChangedResponseSignature = responseSignature;
                noChangeCount = 0;
            } else {
                noChangeCount += 1;
            }

            if (lastResponseLength >= 0 && responseLength === lastResponseLength) {
                stableCount += 1;
            } else {
                stableCount = 1;
                lastResponseLength = responseLength;
            }

            console.log(`----> [Novel][${checkCount}/${maxChecks}] phase=${phase} token=${promptToken} len=${responseLength} stable=${stableCount} stop=${stopVisible} changed=${responseChangedNow} end=${hasEndMarker} resend=${resendAttempt}`);

            if (checkCount >= maxChecks) {
                stopAndCleanup();
                sendResponse({ status: "TIMEOUT", message: "Quá thời gian chờ (novel sequencer)" });
                return;
            }

            if (phase === PHASE.WAIT_CHANGE) {
                if (responseChangedNow) {
                    phase = PHASE.WAIT_STABLE_3;
                    stableCount = 1;
                    phaseStartedAt = Date.now();
                } else if (Date.now() - phaseStartedAt > 45000) {
                    stopAndCleanup();
                    sendResponse({ status: "ERROR", reason: "RESPONSE_NOT_CHANGED_TIMEOUT", message: "RESPONSE_NOT_CHANGED_TIMEOUT" });
                }
                return;
            }

            if (phase === PHASE.WAIT_STABLE_3) {
                if (stableCount >= 3) {
                    phase = PHASE.CHECK_STOP;
                    phaseStartedAt = Date.now();
                }
                return;
            }

            if (phase === PHASE.CHECK_STOP) {
                if (!stopVisible) {
                    stopAndCleanup();
                    sendResponse({
                        status: "DONE",
                        text: latestChangedResponseText || responseText,
                        source: "novel_sequencer_no_stop"
                    });
                    return;
                }
                phase = PHASE.FORCE_STOP_DONE_OR_RESEND;
                phaseStartedAt = Date.now();
                return;
            }

            if (phase === PHASE.FORCE_STOP_DONE_OR_RESEND) {
                if (hasEndMarker) {
                    robustClickButton(stopControl);
                    await sleep(200);
                    clearInputBoxSafely(effectiveInput);
                    stopAndCleanup();
                    sendResponse({
                        status: "DONE",
                        reason: "STUCK_STOP_WITH_END_MARKER_HANDLED",
                        text: latestChangedResponseText || responseText,
                        source: "novel_sequencer_force_stop_done"
                    });
                    return;
                }

                if (stableCount >= 3) {
                    if (resendAttempt >= maxInternalResend || !originalPrompt || !effectiveInput) {
                        robustClickButton(stopControl);
                        await sleep(200);
                        clearInputBoxSafely(effectiveInput);
                        stopAndCleanup();
                        sendResponse({
                            status: "ERROR",
                            reason: "STUCK_STOP_NO_END_MARKER_RETRY_EXHAUSTED",
                            message: "STUCK_STOP_NO_END_MARKER_RETRY_EXHAUSTED"
                        });
                        return;
                    }

                    resendAttempt += 1;
                    robustClickButton(stopControl);
                    await sleep(300);
                    clearInputBoxSafely(effectiveInput);
                    await sleep(200);
                    await fillInputBox(effectiveInput, originalPrompt, usingPiP);
                    await sleep(500);
                    const newBaselineSignature = getResponseSignature(doc, true);
                    const sent = await triggerSend(doc, effectiveInput);
                    if (!sent) {
                        stopAndCleanup();
                        sendResponse({
                            status: "ERROR",
                            reason: "STUCK_STOP_NO_END_MARKER_RETRY_EXHAUSTED",
                            message: "Không gửi lại được prompt trong novel sequencer"
                        });
                        return;
                    }
                    resetForNextPromptAttempt(newBaselineSignature);
                }
                return;
            }

        } catch (e) {
            stopAndCleanup();
            sendResponse({ status: "ERROR", message: e?.message || String(e) });
        } finally {
            isTickRunning = false;
        }
    }, checkIntervalMs);
}

// ============================================
// RESPONSE EXTRACTION
// ============================================
/**
 * Trích xuất nội dung trả lời của Gemini
 * Kỹ thuật 3: Tìm phần tử chứa câu trả lời cuối cùng
 * 
 * Gemini render nhiều message-content, ta lấy cái cuối cùng
 */
function extractGeminiResponse(docOverride = null, silent = false) {
    const data = extractGeminiResponseData(docOverride, silent);
    return data?.text || null;
}

function extractGeminiResponseData(docOverride = null, silent = false) {
    try {
        const doc = docOverride || activeDocument || getDocumentContext();

        const conversationTurns = Array.from(
            doc.querySelectorAll('#chat-history .conversation-container, .chat-history .conversation-container')
        ).filter((turn) => !turn.closest?.('#progress-display-container'));

        const latestTurn = conversationTurns.length > 0 ? conversationTurns[conversationTurns.length - 1] : null;
        const latestTurnId = latestTurn?.id || '';

        if (latestTurn) {
            if (!silent) {
                console.log(`----> [RESP_TURN_FOUND] turn=${latestTurnId || 'no-id'}`);
            }

            const scopedMarkdownBlocks = Array.from(
                latestTurn.querySelectorAll('model-response message-content .markdown, message-content .markdown')
            ).filter((el) => !el.closest?.('#progress-display-container'));

            if (scopedMarkdownBlocks.length > 0) {
                const text = scopedMarkdownBlocks
                    .map((el) => (el.innerText || el.textContent || '').trim())
                    .filter(Boolean)
                    .join('\n')
                    .trim();
                if (text) {
                    const signature = buildTurnAwareSignature(latestTurnId, text);
                    if (!silent) {
                        console.log(`----> [RESP_TURN_CHANGED] source=turn-markdown turn=${latestTurnId || 'no-id'} len=${text.length}`);
                    }
                    return { text, turnId: latestTurnId, signature, source: "turn-markdown" };
                }
            }

            const scopedStructured = Array.from(
                latestTurn.querySelectorAll('model-response structured-content-container .container, structured-content-container .container')
            ).filter((el) => !el.closest?.('#progress-display-container'));
            if (scopedStructured.length > 0) {
                const text = scopedStructured
                    .map((el) => (el.innerText || el.textContent || '').trim())
                    .filter(Boolean)
                    .join('\n')
                    .trim();
                if (text) {
                    const signature = buildTurnAwareSignature(latestTurnId, text);
                    if (!silent) {
                        console.log(`----> [RESP_TURN_CHANGED] source=turn-structured turn=${latestTurnId || 'no-id'} len=${text.length}`);
                    }
                    return { text, turnId: latestTurnId, signature, source: "turn-structured" };
                }
            }

            if (!silent) {
                console.log(`----> [RESP_TURN_EMPTY] turn=${latestTurnId || 'no-id'}`);
            }
        }

        // Fallback có kiểm soát: không quét class wildcard để tránh hút nhầm.
        const fallbackBlocks = Array.from(
            doc.querySelectorAll('message-content .markdown, structured-content-container .container, .presented-response-container .response-content')
        ).filter((el) => !el.closest?.('#progress-display-container'));

        if (fallbackBlocks.length > 0) {
            const last = fallbackBlocks[fallbackBlocks.length - 1];
            const text = (last.innerText || last.textContent || '').trim();
            if (text) {
                const turnId = last.closest('.conversation-container')?.id || '';
                const signature = buildTurnAwareSignature(turnId, text);
                if (!silent) {
                    console.log(`----> [RESP_TURN_FALLBACK] source=fallback-last-block turn=${turnId || 'no-id'} len=${text.length}`);
                }
                return { text, turnId, signature, source: "fallback-last-block" };
            }
        }

        if (!silent) {
            console.warn("----> ⚠️ Không tìm thấy response content (turn-aware)");
        }
        return { text: "", turnId: "", signature: "", source: "none" };

    } catch (error) {
        console.error("----> ❌ Lỗi khi extract response turn-aware:", error);
        return { text: "", turnId: "", signature: "", source: "error" };
    }
}

// ============================================
// UTILITIES
// ============================================
/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isResponseDomNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === "progress-display-container") return false;
    if (node.closest && node.closest("#progress-display-container")) return false;
    if (node.matches && (
        node.matches("message-content") ||
        node.matches("message-content .markdown") ||
        node.matches("structured-content-container") ||
        node.matches(".response-content")
    )) {
        return true;
    }
    if (node.querySelector && (
        node.querySelector("message-content .markdown") ||
        node.querySelector("structured-content-container") ||
        node.querySelector(".response-content")
    )) {
        return true;
    }
    return false;
}

function cleanupGeminiScript() {
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
    if (typeof pendingRequestResponder === 'function') {
        pendingRequestResponder({ status: "ERROR", message: "Content script đang được reload" });
    }
    requestInFlight = false;
    pendingRequestResponder = null;
    activeInputBox = null;
    activeDocument = null;
    try {
        chrome.runtime.onMessage.removeListener(runtimeMessageListener);
    } catch (e) {
        // No-op
    }
}

window.__geminiScriptCleanup = cleanupGeminiScript;

// ============================================
// INITIALIZATION LOG
// ============================================
console.log("----> Content Script Gemini đã sẵn sàng!");
console.log("----> Hỗ trợ: PiP Mode (MOVE strategy), Polling mechanism, Multi-selector extraction");
} // End of versioned Gemini content script loader
})(); // End IIFE wrapper to avoid top-level redeclaration on re-inject
