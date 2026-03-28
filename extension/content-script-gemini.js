if (!window._geminiScriptLoaded) {
window._geminiScriptLoaded = true;
console.log("----> Gemini Content Script đã load (Optimized Version)");

// ============================================
// GLOBAL STATE
// ============================================
let pollingIntervalId = null; // Quản lý interval để có thể hủy khi cần

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

// ============================================
// MESSAGE LISTENERS
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
    }
});

// ============================================
// MAIN PASTE AND SEND HANDLER
// ============================================
/**
 * Xử lý chính: Paste text vào Gemini và gửi
 * Đây là "Bot" thao tác Gemini - giả lập hành vi người dùng
 */
async function handlePasteAndSend(fullPrompt, sendResponse) {
    try {
        const doc = getDocumentContext();
        const usingPiP = isUsingPiP();
        
        console.log(`----> Đang xử lý trong ${usingPiP ? 'PiP window' : 'tab gốc'}`);
        console.log(`----> Độ dài prompt: ${fullPrompt.length} ký tự`);
        
        // BƯỚC 1: Tìm ô nhập liệu
        const inputBox = findInputBox(doc);
        if (!inputBox) {
            sendResponse({ status: "ERROR", message: "Không tìm thấy ô nhập liệu" });
            return;
        }

        // BƯỚC 2: Điền dữ liệu vào ô Contenteditable
        // Kỹ thuật 1: Các framework hiện đại (React/Angular) không nhận diện việc gán value trực tiếp
        // Phải dispatch event 'input' để framework biết có thay đổi
        await fillInputBox(inputBox, fullPrompt, usingPiP);

        // Đợi UI cập nhật
        await sleep(1500);

        // BƯỚC 3: Tìm và click nút Gửi
        const sendButton = findSendButton(doc);
        
        if (sendButton && !sendButton.disabled) {
            sendButton.click();
            console.log("----> ✓ Đã click nút Gửi");
        } else {
            console.log("----> ⚠️ Chưa thấy nút Gửi, nhưng vẫn tiếp tục đợi...");
        }
        
        // BƯỚC 4: Chuyển sang chế độ đợi (Polling)
        // Kỹ thuật 2: Phát hiện khi nào Gemini trả lời xong
        waitForReplyCompletion(sendResponse);

    } catch (e) {
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
function findInputBox(doc) {
    // Selector chính cho Gemini
    const inputBox = doc.querySelector('div[contenteditable="true"][role="textbox"]');
    
    if (!inputBox) {
        console.error("----> Không tìm thấy ô nhập liệu!");
        // Thử các selector khác
        const fallback = doc.querySelector('div[contenteditable="true"]');
        if (fallback) {
            console.log("----> Tìm thấy ô nhập liệu qua fallback selector");
            return fallback;
        }
    }
    
    return inputBox;
}

/**
 * Tìm nút Gửi (Send button)
 * Gemini có thể dùng aria-label khác nhau tùy ngôn ngữ
 */
function findSendButton(doc) {
    // Thử các selector khác nhau
    const selectors = [
        'button[aria-label*="Send"]',
        'button[aria-label*="Gửi"]',
        'button[aria-label*="send"]',
        'button[type="submit"]'
    ];
    
    for (const selector of selectors) {
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
    
    // Điền text - dùng execCommand từ đúng document (PiP hoặc tab gốc)
    const ownerDoc = inputBox.ownerDocument || document;
    if (usingPiP) {
        console.log("----> Dán text vào PiP window (DOM đã được move)");
    } else {
        console.log("----> Dán text vào tab gốc");
    }
    try {
        const success = ownerDoc.execCommand('insertText', false, text);
        if (!success) {
            inputBox.textContent = text;
        }
    } catch (e) {
        inputBox.textContent = text;
    }

    // QUAN TRỌNG: Kích hoạt sự kiện để framework biết đã có chữ
    // Dispatch nhiều event để đảm bảo framework nhận diện
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
function waitForReplyCompletion(sendResponse) {
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
        const usingPiP = isUsingPiP();
        const doc = getDocumentContext();
        
        console.log(`----> [${checkCount}/${maxChecks}] Kiểm tra trạng thái Gemini (${usingPiP ? 'PiP' : 'Tab gốc'})...`);
        
        // Tìm nút Send
        const sendButton = findSendButton(doc);
        
        // Kiểm tra xem Gemini có đang generate không
        // Cách 1: Nút Send không có hoặc bị disabled
        const isGenerating = !sendButton || sendButton.disabled;
        
        // Cách 2: Tìm nút Stop (xuất hiện khi đang generate)
        const stopButton = doc.querySelector('button[aria-label*="Stop"]') || 
                          doc.querySelector('button[aria-label*="Dừng"]');
        
        if (isGenerating || stopButton) {
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
                const responseText = extractGeminiResponse();
                
                if (responseText && responseText.length > 50) { // Đảm bảo có nội dung thực sự
                    clearInterval(pollingIntervalId);
                    pollingIntervalId = null;
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
function extractGeminiResponse() {
    try {
        const doc = getDocumentContext();
        
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

// ============================================
// INITIALIZATION LOG
// ============================================
console.log("----> Content Script Gemini đã sẵn sàng!");
console.log("----> Hỗ trợ: PiP Mode (MOVE strategy), Polling mechanism, Multi-selector extraction");
} // End of window._geminiScriptLoaded check
