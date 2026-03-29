const GEMINI_SCRIPT_VERSION = "2026.03.29.4";

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
        handlePasteAndSend(request.prompt, sendResponse);
        return true; // Giữ channel mở cho async response
    } else if (request.action === "PING") {
        sendResponse({ status: "ALIVE" });
        return true;
    } else if (request.action === "CANCEL_POLLING") {
        // HỦY NGAY LẬP TỨC khi nhận lệnh từ background
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            activeInputBox = null;
            activeDocument = null;
            console.log("----> 🛑 ĐÃ HỦY POLLING - Dừng ngay lập tức!");
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
        return true;
    } else if (request.action === "UPDATE_PROGRESS") {
        sendResponse({ status: "OK" });
        return true;
    } else if (request.action === "GET_SCRIPT_VERSION") {
        sendResponse({ status: "OK", version: GEMINI_SCRIPT_VERSION });
        return true;
    }
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
        const context = resolveComposerContext();
        const doc = context.doc;
        const usingPiP = context.usingPiP;
        
        console.log(`----> Đang xử lý trong ${usingPiP ? 'PiP window' : 'tab gốc'}`);
        console.log(`----> Độ dài prompt: ${fullPrompt.length} ký tự`);
        
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

        // BƯỚC 2: Điền dữ liệu vào ô Contenteditable
        // Kỹ thuật 1: Các framework hiện đại (React/Angular) không nhận diện việc gán value trực tiếp
        // Phải dispatch event 'input' để framework biết có thay đổi
        await fillInputBox(inputBox, fullPrompt, usingPiP);

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
    return (
        type === 'submit' ||
        ariaLabel.includes('send') ||
        ariaLabel.includes('gửi') ||
        dataTestId.includes('send')
    );
}

/**
 * Tìm nút Gửi (Send button)
 * Gemini có thể dùng aria-label khác nhau tùy ngôn ngữ
 */
function findSendButton(doc, inputBox = null) {
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
    
    console.warn("----> Không tìm thấy nút Send!");
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

async function waitForGenerationStart(doc, inputBox, label) {
    await sleep(900);
    if (isGeminiGenerating(doc, inputBox)) {
        console.log(`----> ✓ Gemini đã bắt đầu xử lý sau ${label}`);
        return true;
    }
    console.log(`----> [debug] Gemini chưa bắt đầu sau ${label}`);
    return false;
}

function isGeminiGenerating(doc, inputBox = null) {
    const stopButton = doc.querySelector('button[aria-label*="Stop"]') ||
        doc.querySelector('button[aria-label*="Dừng"]');
    if (stopButton && isElementVisible(stopButton)) {
        return true;
    }

    const sendButton = findSendButton(doc, inputBox || activeInputBox);
    return !sendButton || !isButtonEnabled(sendButton);
}

async function triggerSend(doc, inputBox) {
    inputBox.focus();

    // Ưu tiên hành vi bàn phím như người dùng thật để tránh lệ thuộc selector nút
    simulateEnterOnInput(inputBox, false);
    if (await waitForGenerationStart(doc, inputBox, "Enter")) {
        return true;
    }

    simulateEnterOnInput(inputBox, true);
    if (await waitForGenerationStart(doc, inputBox, "Ctrl+Enter")) {
        return true;
    }

    if (submitNearestForm(inputBox)) {
        if (await waitForGenerationStart(doc, inputBox, "form submit")) {
            return true;
        }
    }

    const sendButton = findSendButton(doc, inputBox);
    if (sendButton && isButtonEnabled(sendButton)) {
        sendButton.focus();
        sendButton.click();
        console.log("----> ✓ Đã click nút Gửi");

        if (await waitForGenerationStart(doc, inputBox, "click Send")) {
            return true;
        }
    }

    // Click chuột thật để tránh trường hợp .click() bị framework chặn
    if (sendButton && isButtonEnabled(sendButton)) {
        sendButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        sendButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        sendButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        console.log("----> ✓ Đã gửi chuỗi sự kiện chuột tới nút Gửi");

        if (await waitForGenerationStart(doc, inputBox, "mouse events")) {
            return true;
        }
    }

    console.warn("----> ❌ Không kích hoạt được gửi prompt (Enter/Ctrl+Enter/form/click đều thất bại)");
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
        const sendButton = findSendButton(doc, inputBox || activeInputBox);
        
        // Kiểm tra xem Gemini có đang generate không
        // Cách 1: Nút Send không có hoặc bị disabled
        const isGenerating = !sendButton || sendButton.disabled;
        
        // Cách 2: Tìm nút Stop (xuất hiện khi đang generate)
        const stopButton = doc.querySelector('button[aria-label*="Stop"]') || 
                  doc.querySelector('button[aria-label*="Dừng"]');
        
        if (isGenerating || (stopButton && isElementVisible(stopButton))) {
            hasStartedGenerating = true;
            console.log(`----> [${checkCount}] Gemini đang xử lý... (${stopButton ? 'có nút Stop' : 'nút Send disabled'})`);
            return; // Tiếp tục đợi
        }
        
        // Nếu có nút Send và KHÔNG bị disabled → Gemini có thể đã xong
        if (sendButton && !sendButton.disabled) {
            // Chỉ coi là xong nếu đã từng bắt đầu generate
            // Tránh trường hợp false positive ngay từ đầu
            if (hasStartedGenerating || checkCount > 3) {
                console.log(`----> [${checkCount}] ✓ Tìm thấy nút Send sẵn sàng! Gemini có thể đã dịch xong.`);
                
                // Lấy response
                const responseText = extractGeminiResponse(doc);
                
                if (responseText && responseText.length > 50) { // Đảm bảo có nội dung thực sự
                    clearInterval(pollingIntervalId);
                    pollingIntervalId = null;
                    activeInputBox = null;
                    activeDocument = null;
                    console.log("----> ✓ Đã hoàn thành! Độ dài response:", responseText.length);
                    
                    sendResponse({ 
                        status: "DONE",
                        text: responseText
                    });
                } else {
                    console.log(`----> [${checkCount}] ⚠️ Nút Send có nhưng response quá ngắn (${responseText ? responseText.length : 0} ký tự), đợi thêm...`);
                }
            } else {
                console.log(`----> [${checkCount}] Nút Send có nhưng chưa chắc đã bắt đầu generate, đợi thêm...`);
            }
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
function extractGeminiResponse(docOverride = null) {
    try {
        const doc = docOverride || activeDocument || getDocumentContext();
        
        // PHƯƠNG PHÁP 1: Tìm tất cả các message-content
        const allMessages = doc.querySelectorAll('message-content');
        
        if (allMessages.length > 0) {
            // Lấy message cuối cùng (response mới nhất)
            const lastMessage = allMessages[allMessages.length - 1];
            const textContent = lastMessage.innerText || lastMessage.textContent;
            
            if (textContent && textContent.trim().length > 0) {
                console.log("----> ✓ Đã lấy response từ message-content");
                return textContent.trim();
            }
        }
        
        // PHƯƠNG PHÁP 2: Fallback - tìm theo data-test-id
        const modelResponse = doc.querySelector('[data-test-id="model-response"]');
        if (modelResponse) {
            const text = modelResponse.innerText || modelResponse.textContent;
            if (text && text.trim().length > 0) {
                console.log("----> ✓ Đã lấy response từ data-test-id");
                return text.trim();
            }
        }
        
        // PHƯƠNG PHÁP 3: Tìm div chứa markdown content
        const markdownContent = doc.querySelector('.markdown-content');
        if (markdownContent) {
            const text = markdownContent.innerText || markdownContent.textContent;
            if (text && text.trim().length > 0) {
                console.log("----> ✓ Đã lấy response từ markdown-content");
                return text.trim();
            }
        }
        
        // PHƯƠNG PHÁP 4: Tìm theo class chứa "response" hoặc "message"
        const responseContainers = doc.querySelectorAll('[class*="response"], [class*="message"]');
        if (responseContainers.length > 0) {
            const lastContainer = responseContainers[responseContainers.length - 1];
            const text = lastContainer.innerText || lastContainer.textContent;
            if (text && text.trim().length > 0) {
                console.log("----> ✓ Đã lấy response từ class selector");
                return text.trim();
            }
        }
        
        console.warn("----> ⚠️ Không tìm thấy response content");
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
