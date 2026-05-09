if (!window._grokScriptLoaded) {
window._grokScriptLoaded = true;
console.log("----> Grok Content Script đã load (Optimized Version)");

// ============================================
// GLOBAL STATE
// ============================================
let pollingIntervalId = null; // Quản lý interval để có thể hủy khi cần

// ============================================
// CLIPBOARD INTERCEPTOR (Grok)
// ============================================
function injectClipboardInterceptor() {
    const script = document.createElement('script');
    script.textContent = `
        const originalWriteText = navigator.clipboard.writeText;
        navigator.clipboard.writeText = async function(text) {
            window.postMessage({ type: 'GROK_COPIED_TEXT', text: text }, '*');
            return originalWriteText.apply(this, arguments);
        };
    `;
    document.documentElement.appendChild(script);
    script.remove();
}
injectClipboardInterceptor();

let lastCopiedText = null;
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GROK_COPIED_TEXT') {
        lastCopiedText = event.data.text;
    }
});

// ============================================
// STRIP ?rid= FROM URL (Grok thêm sau mỗi response)
// ============================================
(function () {
    function stripRid(url) {
        try {
            const u = new URL(url, window.location.href);
            if (u.searchParams.has('rid')) {
                u.searchParams.delete('rid');
                return u.toString();
            }
        } catch (_) {}
        return url;
    }

    const _pushState = history.pushState.bind(history);
    history.pushState = function (state, title, url) {
        return _pushState(state, title, url ? stripRid(url) : url);
    };

    const _replaceState = history.replaceState.bind(history);
    history.replaceState = function (state, title, url) {
        return _replaceState(state, title, url ? stripRid(url) : url);
    };

    console.log("----> ✓ Đã setup URL cleaner (loại bỏ ?rid= của Grok)");
})();

const GROK_SELECTORS = {
    input: [
        '.tiptap',
        '.ProseMirror',
        'div[contenteditable="true"]',
        'textarea',
        '[role="textbox"]'
    ],
    sendButton: [
        'button[type="submit"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="send"]',
        'button[aria-label*="Gửi"]',
        'form button'
    ],
    stopButton: [
        'button[aria-label*="Stop"]',
        'button[aria-label*="Dừng"]'
    ],
    response: [
        '.prose',
        '.markdown',
        '.markdown-body',
        '[data-testid*="message"]',
        '[class*="message"]',
        '[class*="response"]',
        'article',
        '[role="article"]'
    ]
};

// ============================================
// DOCUMENT CONTEXT MANAGEMENT
// ============================================
function getDocumentContext() {
    if (window.documentPictureInPicture && window.documentPictureInPicture.window) {
        const pipDoc = window.documentPictureInPicture.window.document;
        // Chỉ dùng PiP document nếu input thực sự được MOVE vào đó
        const hasInput = GROK_SELECTORS.input.some(sel => pipDoc.querySelector(sel));
        if (hasInput) {
            console.log("----> Sử dụng PiP window document (DOM đã được move)");
            return pipDoc;
        }
    }
    console.log("----> Sử dụng tab gốc document");
    return document;
}

function isUsingPiP() {
    if (!window.documentPictureInPicture || !window.documentPictureInPicture.window) return false;
    const pipDoc = window.documentPictureInPicture.window.document;
    // PiP chỉ tính là active nếu input thực sự được MOVE vào đó (Gemini mode)
    return GROK_SELECTORS.input.some(sel => pipDoc.querySelector(sel));
}

// ============================================
// MESSAGE LISTENERS
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "PASTE_AND_SEND") {
        handlePasteAndSend(request.prompt, sendResponse);
        return true;
    } else if (request.action === "PING") {
        sendResponse({ status: "ALIVE" });
        return true;
    } else if (request.action === "CANCEL_POLLING") {
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            console.log("----> 🛑 ĐÃ HỦY POLLING - Dừng ngay lập tức!");
        }
        sendResponse({ status: "CANCELLED" });
        // Synchronous response - NOT returning true
    } else if (request.action === "UPDATE_PIP_STATUS") {
        window.postMessage({
            type: "UPDATE_PIP_STATUS",
            data: request.data
        }, "*");
        sendResponse({ status: "OK" });
        return true;
    } else if (request.action === "UPDATE_PROGRESS") {
        // Prevent background console errors when UPDATE_PROGRESS is sent but PiP is not active
        sendResponse({ status: "OK" });
        return true;
    }
});

// ============================================
// MAIN PASTE AND SEND HANDLER
// ============================================
async function handlePasteAndSend(fullPrompt, sendResponse) {
    try {
        const doc = getDocumentContext();
        const usingPiP = isUsingPiP();

        console.log(`----> Đang xử lý trong ${usingPiP ? 'PiP window' : 'tab gốc'}`);
        console.log(`----> Độ dài prompt: ${fullPrompt.length} ký tự`);

        const inputBox = findInputBox(doc);
        if (!inputBox) {
            sendResponse({ status: "ERROR", message: "Không tìm thấy ô nhập liệu" });
            return;
        }

        await fillInputBox(inputBox, fullPrompt, usingPiP);
        await sleep(1500);

        const sendButton = findSendButton(doc);
        if (sendButton && !sendButton.disabled) {
            sendButton.click();
            console.log("----> ✓ Đã click nút Gửi");
        } else {
            console.log("----> ⚠️ Chưa thấy nút Gửi có thể click được, thử dùng Enter fallback...");
            const enterEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13
            });
            inputBox.dispatchEvent(enterEvent);
            console.log("----> ✓ Đã gửi phím Enter");
        }

        waitForReplyCompletion(sendResponse);
    } catch (e) {
        console.error("----> Lỗi:", e);
        sendResponse({ status: "ERROR", message: e.message });
    }
}

// ============================================
// DOM SELECTORS
// ============================================
function findInputBox(doc) {
    for (const selector of GROK_SELECTORS.input) {
        const el = doc.querySelector(selector);
        if (el) {
            console.log(`----> Tìm thấy ô nhập liệu: ${selector}`);
            return el;
        }
    }
    console.error("----> Không tìm thấy ô nhập liệu!");
    return null;
}

function findSendButton(doc) {
    for (const selector of GROK_SELECTORS.sendButton) {
        const button = doc.querySelector(selector);
        if (button) {
            console.log(`----> Tìm thấy nút Send: ${selector}`);
            return button;
        }
    }
    console.warn("----> Không tìm thấy nút Send!");
    return null;
}

// ============================================
// INPUT FILLING
// ============================================
async function fillInputBox(inputBox, text, usingPiP) {
    const win = usingPiP && window.documentPictureInPicture ? window.documentPictureInPicture.window : window;
    const doc = getDocumentContext();

    inputBox.focus();
    await sleep(300);

    const isTextarea = inputBox.tagName.toLowerCase() === 'textarea';

    if (isTextarea) {
        console.log("----> Xử lý input dưới dạng React Textarea");
        inputBox.value = '';
        inputBox.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(100);

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
        if (nativeInputValueSetter && nativeInputValueSetter.set) {
            nativeInputValueSetter.set.call(inputBox, text);
        } else {
            inputBox.value = text;
        }

        inputBox.dispatchEvent(new Event('input', { bubbles: true }));
        inputBox.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        console.log("----> Xử lý input dưới dạng ContentEditable");
        inputBox.focus();
        await sleep(100);

        const selection = win.getSelection();
        if (selection) {
            const range = doc.createRange();
            range.selectNodeContents(inputBox);
            if (inputBox.textContent.trim().length > 0) {
                selection.removeAllRanges();
                selection.addRange(range);
                doc.execCommand('delete', false, null);
            } else {
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }

        console.log(`----> Dán text vào ${usingPiP ? 'PiP window' : 'tab gốc'} (Pasting qua ClipboardEvent)`);
        try {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData("text/plain", text);
            const pasteEvent = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
            });
            
            const notHandled = inputBox.dispatchEvent(pasteEvent);
            if (notHandled) {
                console.log("----> Fallback sang execCommand");
                const success = doc.execCommand('insertText', false, text);
                if (!success) {
                    inputBox.textContent = text;
                }
            } else {
                console.log("----> Paste event đã được editor xử lý");
            }
        } catch (e) {
            console.log("Lỗi:", e);
            inputBox.textContent = text;
        }

        inputBox.dispatchEvent(new Event('input', { bubbles: true }));
        inputBox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    await sleep(500);
    console.log(`----> ✓ Đã điền ${text.length} ký tự vào ô input`);
}

// ============================================
// POLLING MECHANISM
// ============================================
function waitForReplyCompletion(sendResponse) {
    console.log("----> Đang đợi Grok trả lời...");

    let checkCount = 0;
    const maxChecks = 120;
    const checkIntervalMs = 3000;
    let hasStartedGenerating = false;
    let noStopChecks = 0;
    let stableResponseChecks = 0;
    let lastResponseSignature = "";

    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }

    let isExtracting = false;

    pollingIntervalId = setInterval(async () => {
        if (isExtracting) return;
        checkCount++;
        const usingPiP = isUsingPiP();
        const doc = getDocumentContext();

        console.log(`----> [${checkCount}/${maxChecks}] Kiểm tra trạng thái Grok (${usingPiP ? 'PiP' : 'Tab gốc'})...`);

        // Kiểm tra giới hạn tin nhắn (Rate Limit)
        const rateLimitSvg = doc.querySelector('svg.text-warning');
        if (rateLimitSvg) {
            const container = rateLimitSvg.closest('.flex');
            if (container && (container.textContent.toLowerCase().includes('giới hạn') || container.textContent.toLowerCase().includes('limit'))) {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
                console.error("----> ❌ Lỗi: Grok đã đạt giới hạn tin nhắn.");
                sendResponse({ status: "ERROR", message: "Grok đã đạt giới hạn tin nhắn (Rate Limit)." });
                return;
            }
        }

        let stopButton = null;
        for (const selector of GROK_SELECTORS.stopButton) {
            stopButton = doc.querySelector(selector);
            if (stopButton) break;
        }

        if (stopButton) {
            hasStartedGenerating = true;
            noStopChecks = 0;
            stableResponseChecks = 0;
            lastResponseSignature = "";
            console.log(`----> [${checkCount}] Grok đang xử lý... (có nút Stop)`);
            return;
        }

        noStopChecks++;

        if (hasStartedGenerating || checkCount > 3) {
            console.log(`----> [${checkCount}] Không thấy nút Stop. Kiểm tra độ ổn định response...`);

            isExtracting = true;
            const responseText = await extractGrokResponse();
            const responseLength = responseText ? responseText.length : 0;
            const responseSignature = responseLength > 50
                ? `${responseLength}:${String(responseText).slice(-120)}`
                : "";
            if (responseSignature && responseSignature === lastResponseSignature) {
                stableResponseChecks++;
            } else {
                stableResponseChecks = responseSignature ? 1 : 0;
                lastResponseSignature = responseSignature;
            }

            if (responseText && responseLength > 50 && noStopChecks >= 2 && stableResponseChecks >= 2) {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
                console.log(`----> ✓ Đã hoàn thành! len=${responseLength}, noStop=${noStopChecks}, stable=${stableResponseChecks}`);

                sendResponse({
                    status: "DONE",
                    text: responseText
                });
            } else {
                console.log(`----> [${checkCount}] ⚠️ Chưa ổn định (len=${responseLength}, noStop=${noStopChecks}, stable=${stableResponseChecks}), đợi thêm...`);
                isExtracting = false;
            }
        } else {
            console.log(`----> [${checkCount}] Chưa thấy nút Stop, tiếp tục thăm dò...`);
        }

        if (checkCount >= maxChecks) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
            console.error("----> ❌ Timeout: Quá thời gian chờ!");
            sendResponse({ status: "TIMEOUT", message: "Quá thời gian chờ" });
        }

    }, checkIntervalMs);
}

// ============================================
// RESPONSE EXTRACTION
// ============================================
function extractGrokResponse() {
    return new Promise(async (resolve) => {
        try {
            const doc = getDocumentContext();

            for (const selector of GROK_SELECTORS.response) {
                const nodes = doc.querySelectorAll(selector);
                if (nodes.length === 0) continue;
                const lastNode = nodes[nodes.length - 1];

                // 1. TÌM NÚT COPY
                const buttons = lastNode.querySelectorAll('button');
                let copyBtn = null;
                for (const btn of buttons) {
                    if (btn.querySelector('svg') && btn.classList.contains('bg-transparent')) {
                        copyBtn = btn;
                        break;
                    }
                }

                if (copyBtn) {
                    console.log("----> ✓ Tìm thấy nút Copy, đang bấm để lấy text...");
                    lastCopiedText = null;
                    copyBtn.click();
                    
                    let wait = 0;
                    while (!lastCopiedText && wait < 500) {
                        await sleep(50);
                        wait += 50;
                    }

                    if (lastCopiedText) {
                        console.log("----> ✓ Đã lấy response chuẩn từ nút Copy!");
                        return resolve(lastCopiedText.trim());
                    }
                }

                // 2. FALLBACK ƯU TIÊN THẺ PRE
                const pre = lastNode.querySelector('pre');
                if (pre) {
                    console.log("----> ✓ Fallback: Đã lấy response từ thẻ <pre>");
                    return resolve(pre.textContent.trim());
                }

                // 3. FALLBACK INNER TEXT
                const text = lastNode.innerText || lastNode.textContent;
                if (text && text.trim().length > 0) {
                    console.log(`----> ✓ Đã lấy response từ selector: ${selector} (InnerText)`);
                    return resolve(text.trim());
                }
            }

        // Removed the extra }

        console.warn("----> ⚠️ Không tìm thấy response content qua selector chuẩn, thử generic fallback...");
        const paragraphs = doc.querySelectorAll('p');
        if (paragraphs.length > 0) {
            const lastP = paragraphs[paragraphs.length - 1];
            let parent = lastP.parentElement;
            for (let i=0; i<3; i++) {
                if (parent && parent.parentElement && parent.parentElement.tagName !== 'BODY') {
                    parent = parent.parentElement;
                }
            }
            if (parent) {
                const text = parent.innerText || parent.textContent;
                if (text && text.trim().length > 0) {
                    console.log(`----> ✓ Đã lấy response từ generic fallback`);
                    return resolve(text.trim());
                }
            }
        }

        return resolve(null);
    } catch (error) {
        console.error("----> ❌ Lỗi khi extract response:", error);
        return resolve(null);
    }
    });
}

// ============================================
// UTILITIES
// ============================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// INITIALIZATION LOG
// ============================================
console.log("----> Content Script Grok đã sẵn sàng!");
console.log("----> Hỗ trợ: PiP Mode (MOVE strategy), Polling mechanism, Multi-selector extraction");
} // End of window._grokScriptLoaded check
