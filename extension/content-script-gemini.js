(() => {
const GEMINI_SCRIPT_VERSION = "2026.03.30.1";

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

        Promise.resolve(handlePasteAndSend(request.prompt, safeSendResponse))
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
            console.log("----> 🛑 ĐÃ HỦY POLLING - Dừng ngay lập tức!");
        }

        if (typeof pendingRequestResponder === 'function') {
            pendingRequestResponder({ status: "CANCELLED", message: "Đã dừng bởi người dùng" });
        } else {
            requestInFlight = false;
            pendingRequestResponder = null;
        }

        sendResponse({ status: "CANCELLED" });
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
async function handlePasteAndSend(fullPrompt, sendResponse) {
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
        const sendTriggered = await triggerSend(doc, inputBox);
        if (!sendTriggered) {
            activeInputBox = null;
            activeDocument = null;
            sendResponse({ status: "ERROR", message: "Không thể kích hoạt gửi prompt tới Gemini" });
            return;
        }
        
        // BƯỚC 4: Chuyển sang chế độ đợi (Polling)
        // Kỹ thuật 2: Phát hiện khi nào Gemini trả lời xong
        waitForReplyCompletion(sendResponse, inputBox, doc, usingPiP);

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

async function waitForComposerReady(maxWaitMs = 120000, intervalMs = 500) {
    const startAt = Date.now();
    let attempt = 0;

    while (Date.now() - startAt < maxWaitMs) {
        attempt++;
        const context = resolveComposerContext();
        const doc = context.doc;
        const inputBox = context.inputBox;
        const stopButton = findVisibleStopButton(doc);

        if (!stopButton && inputBox && isElementVisible(inputBox)) {
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
    const preferred = Array.from(doc.querySelectorAll('div[contenteditable="true"][role="textbox"]'))
        .find((el) => isElementVisible(el));
    if (preferred) {
        return preferred;
    }

    const fallback = Array.from(doc.querySelectorAll('div[contenteditable="true"]'))
        .find((el) => isElementVisible(el));
    if (fallback) {
        console.log("----> Tìm thấy ô nhập liệu qua fallback selector");
        return fallback;
    }

    if (logWhenMissing) {
        console.error("----> Không tìm thấy ô nhập liệu!");
    }
    return null;
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
    const hasMoreIcon = !!button.querySelector('mat-icon[fonticon="more_vert"]');

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
        'button[aria-label*="Stop"]',
        'button[aria-label*="Dừng"]',
        'button[data-test-id*="stop"]',
        'button[data-test-id*="Stop"]'
    ];

    for (const selector of candidates) {
        const button = doc.querySelector(selector);
        if (button && isElementVisible(button)) {
            return button;
        }
    }

    return null;
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
    // Thử các selector khác nhau
    const selectors = [
        'button[aria-label*="Send"]',
        'button[aria-label*="Gửi"]',
        'button[aria-label*="send"]',
        'button[type="submit"]'
    ];

    const candidates = [];
    const seen = new Set();

    // Ưu tiên scope gần ô input để tránh bắt nhầm nút Send không liên quan
    const scopedRoots = [];
    if (inputBox) {
        let current = inputBox;
        let depth = 0;
        while (current && depth < 8) {
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

    // Fallback: tìm toàn document
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
    const best = candidates.find(({ button }) => isElementVisible(button) && isButtonEnabled(button));
    if (best) {
        const dataTestId = best.button.getAttribute('data-test-id') || '';
        const ariaLabel = best.button.getAttribute('aria-label') || '';
        console.log(`----> Tìm thấy nút Send: ${best.selector} (${best.scope}) | data-test-id=${dataTestId} | aria-label=${ariaLabel}`);
        return best.button;
    }

    // Nếu không có button enabled, trả button nhìn thấy đầu tiên để polling vẫn hoạt động
    const visible = candidates.find(({ button }) => isElementVisible(button));
    if (visible) {
        const dataTestId = visible.button.getAttribute('data-test-id') || '';
        const ariaLabel = visible.button.getAttribute('aria-label') || '';
        console.log(`----> Tìm thấy nút Send (visible): ${visible.selector} (${visible.scope}) | data-test-id=${dataTestId} | aria-label=${ariaLabel}`);
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

async function waitForGenerationStart(doc, inputBox, label, expectedPromptLength = 0) {
    // Poll vài giây để chịu được UI lag/chậm render trạng thái generating.
    const maxChecks = 12; // ~3.6s
    const intervalMs = 300;
    const threshold = expectedPromptLength > 0
        ? Math.max(8, Math.floor(expectedPromptLength * 0.02))
        : 8;

    for (let i = 0; i < maxChecks; i++) {
        await sleep(intervalMs);

        if (isGeminiGenerating(doc, inputBox)) {
            console.log(`----> ✓ Gemini đã bắt đầu xử lý sau ${label}`);
            return true;
        }

        // Fallback khi Gemini đổi UI và nút Send/Stop không bắt được bằng selector.
        // Nếu input gần như trống thì coi như prompt đã được nhận.
        const remainingLength = getInputTextLength(inputBox);
        if (remainingLength <= threshold) {
            console.log(`----> ✓ Prompt đã được nhận sau ${label} (input còn ${remainingLength} ký tự)`);
            return true;
        }
    }

    console.log(`----> [debug] Gemini chưa bắt đầu sau ${label}`);
    return false;
}

function isGeminiGenerating(doc, inputBox = null) {
    const stopButton = findVisibleStopButton(doc);
    if (stopButton) {
        return true;
    }

    const sendButton = findSendButton(doc, inputBox || activeInputBox, false);
    if (!sendButton) {
        return false;
    }
    return !isButtonEnabled(sendButton);
}

function robustClickButton(button) {
    if (!button) return;
    button.focus();
    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function triggerSend(doc, inputBox) {
    inputBox.focus();
    const promptLength = getInputTextLength(inputBox);

    // Chỉ dùng Enter để gửi prompt (theo yêu cầu), nhưng thử 2 lần để chống miss khi UI lag.
    simulateEnterOnInput(inputBox, false);
    if (await waitForGenerationStart(doc, inputBox, "Enter lần 1", promptLength)) {
        return true;
    }

    await sleep(200);
    simulateEnterOnInput(inputBox, false);
    if (await waitForGenerationStart(doc, inputBox, "Enter lần 2", promptLength)) {
        return true;
    }

    // Fallback: click nút gửi khi Enter bị miss do lag UI
    const preferredSendButton = doc.querySelector(
        'button.send-button.submit[aria-label*="Gửi"], ' +
        'button.send-button.submit[aria-label*="Send"], ' +
        'button.send-button.submit[aria-label*="tin nhắn"], ' +
        'button.send-button.submit'
    );
    const sendButton = preferredSendButton || findSendButton(doc, inputBox, false);

    if (sendButton && isElementVisible(sendButton) && isButtonEnabled(sendButton)) {
        robustClickButton(sendButton);
        console.log("----> Đã fallback click nút Gửi (chuỗi mouse events) sau khi Enter thất bại");

        if (await waitForGenerationStart(doc, inputBox, "fallback click Send", promptLength)) {
            return true;
        }
    }

    console.warn("----> ❌ Không kích hoạt được gửi prompt (Enter x2 + fallback click Send đều thất bại)");
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
function waitForReplyCompletion(sendResponse, inputBox = null, contextDoc = null, contextUsingPiP = false) {
    console.log("----> Đang đợi Gemini trả lời...");
    
    let checkCount = 0;
    const maxChecks = 120; // Đợi tối đa 6 phút (120 * 3s)
    const checkIntervalMs = 3000; // Kiểm tra mỗi 3 giây
    
    let hasStartedGenerating = false; // Flag để biết Gemini đã bắt đầu generate chưa
    let stableResponseChecks = 0;
    let lastResponseSignature = '';

    // Clear interval cũ nếu còn tồn tại (tránh memory leak)
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }

    // Gán vào biến global để có thể hủy từ bên ngoài
    pollingIntervalId = setInterval(() => {
        checkCount++;
        const doc = contextDoc || activeDocument || getDocumentContext();
        const usingPiP = contextUsingPiP || doc !== document;
        
        console.log(`----> [${checkCount}/${maxChecks}] Kiểm tra trạng thái Gemini (${usingPiP ? 'PiP' : 'Tab gốc'})...`);
        
        // Tìm nút Send
        const sendButton = findSendButton(doc, inputBox || activeInputBox, false);
        
        // Kiểm tra xem Gemini có đang generate không
        // Ưu tiên Stop button, sau đó fallback theo trạng thái nút Send nếu tìm được.
        const stopButton = findVisibleStopButton(doc);
        const isGenerating = !!stopButton || (!!sendButton && !isButtonEnabled(sendButton));
        
        if (isGenerating) {
            hasStartedGenerating = true;
            stableResponseChecks = 0;
            lastResponseSignature = '';
            console.log(`----> [${checkCount}] Gemini đang xử lý... (${stopButton ? 'có nút Stop' : 'nút Send disabled'})`);
            return; // Tiếp tục đợi
        }

        // Không thấy tín hiệu generate nữa, kiểm tra response có ổn định chưa.
        const responseText = extractGeminiResponse(doc, true);
        const responseLength = responseText ? responseText.length : 0;
        const hasMeaningfulResponse = responseLength > 50;
        const responseSignature = hasMeaningfulResponse
            ? `${responseLength}:${responseText.slice(-120)}`
            : '';

        if (responseSignature && responseSignature === lastResponseSignature) {
            stableResponseChecks++;
        } else {
            stableResponseChecks = responseSignature ? 1 : 0;
            lastResponseSignature = responseSignature;
        }
        
        // Điều kiện hoàn thành:
        // 1) Có nút Send enabled (đường đi chuẩn), hoặc
        // 2) Không có nút Send nhưng response đã ổn định >= 2 lần check liên tiếp.
        const sendReady = !!sendButton && isButtonEnabled(sendButton);
        const doneByStableResponse = !sendButton && hasMeaningfulResponse && stableResponseChecks >= 2;

        if ((hasStartedGenerating || checkCount > 3) && (sendReady || doneByStableResponse)) {
            if (!hasMeaningfulResponse) {
                console.log(`----> [${checkCount}] ⚠️ Đã có tín hiệu hoàn thành nhưng response quá ngắn (${responseLength} ký tự), đợi thêm...`);
            } else {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
                activeInputBox = null;
                activeDocument = null;
                console.log(`----> [${checkCount}] ✓ Gemini đã hoàn thành (${doneByStableResponse ? 'fallback theo độ ổn định response' : 'nút Send sẵn sàng'})`);

                sendResponse({
                    status: "DONE",
                    text: responseText
                });
            }
        } else if (!sendButton) {
            console.log(`----> [${checkCount}] Chưa tìm thấy nút Send, theo dõi độ ổn định response... (${responseLength} ký tự)`);
        }

        // Timeout sau maxChecks lần kiểm tra
        if (checkCount >= maxChecks) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            activeInputBox = null;
            activeDocument = null;
            console.error("----> ❌ Timeout: Quá thời gian chờ!");
            sendResponse({ status: "TIMEOUT", message: "Quá thời gian chờ" });
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
    try {
        const doc = docOverride || activeDocument || getDocumentContext();
        
        // PHƯƠNG PHÁP 1: Tìm tất cả các message-content
        const allMessages = doc.querySelectorAll('message-content');
        
        if (allMessages.length > 0) {
            // Lấy message cuối cùng (response mới nhất)
            const lastMessage = allMessages[allMessages.length - 1];
            const textContent = lastMessage.innerText || lastMessage.textContent;
            
            if (textContent && textContent.trim().length > 0) {
                if (!silent) {
                    console.log("----> ✓ Đã lấy response từ message-content");
                }
                return textContent.trim();
            }
        }
        
        // PHƯƠNG PHÁP 2: Fallback - tìm theo data-test-id
        const modelResponse = doc.querySelector('[data-test-id="model-response"]');
        if (modelResponse) {
            const text = modelResponse.innerText || modelResponse.textContent;
            if (text && text.trim().length > 0) {
                if (!silent) {
                    console.log("----> ✓ Đã lấy response từ data-test-id");
                }
                return text.trim();
            }
        }
        
        // PHƯƠNG PHÁP 3: Tìm div chứa markdown content
        const markdownContent = doc.querySelector('.markdown-content');
        if (markdownContent) {
            const text = markdownContent.innerText || markdownContent.textContent;
            if (text && text.trim().length > 0) {
                if (!silent) {
                    console.log("----> ✓ Đã lấy response từ markdown-content");
                }
                return text.trim();
            }
        }
        
        // PHƯƠNG PHÁP 4: Tìm theo class chứa "response" hoặc "message"
        const responseContainers = doc.querySelectorAll('[class*="response"], [class*="message"]');
        if (responseContainers.length > 0) {
            const lastContainer = responseContainers[responseContainers.length - 1];
            const text = lastContainer.innerText || lastContainer.textContent;
            if (text && text.trim().length > 0) {
                if (!silent) {
                    console.log("----> ✓ Đã lấy response từ class selector");
                }
                return text.trim();
            }
        }
        
        if (!silent) {
            console.warn("----> ⚠️ Không tìm thấy response content");
        }
        return null;
        
    } catch (error) {
        console.error("----> ❌ Lỗi khi extract response:", error);
        return null;
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
