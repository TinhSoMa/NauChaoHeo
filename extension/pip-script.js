// pip-script.js - CHẾ ĐỘ MOVE (DOM thật, Giao diện chuẩn 100%)

console.log("----> PiP Script đã load (High Fidelity Mode)");

let pipWindow = null;
let originalParent = null; 
let geminiContainer = null;
let statusOverlay = null;
let spacerElement = null; // Element giữ chỗ để tránh layout gốc bị giật

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "OPEN_PIP") {
        openPiPWindow()
            .then(() => sendResponse({ status: "OK" }))
            .catch(e => sendResponse({ status: "ERROR", message: e.message }));
        return true;
    } else if (request.action === "CLOSE_PIP") {
        closePiPWindow();
        sendResponse({ status: "OK" });
        return true;
    } else if (request.action === "UPDATE_PROGRESS") {
        // Forward progress update vào PiP window
        if (pipWindow && !pipWindow.closed) {
            updatePiPProgress(request.data);
        }
        return false;
    }
});



async function openPiPWindow() {
    try {
        if (!('documentPictureInPicture' in window)) {
            throw new Error("Trình duyệt không hỗ trợ PiP API (Cần Chrome 116+)");
        }

        if (pipWindow && !pipWindow.closed) {
            pipWindow.close();
        }

        console.log("----> 1. Chuẩn bị container...");
        
        // KIỂM TRA: Đảm bảo đang ở trong một conversation
        const currentUrl = window.location.href;
        const urlPath = new URL(currentUrl).pathname;
        
        // Kiểm tra xem có đang ở trong conversation không
        // Gemini có nhiều định dạng URL:
        // - /app/{id} - conversation (tài khoản mặc định)
        // - /u/{number}/app/{id} - conversation (tài khoản khác, vd: /u/4/app/...)
        // - /app/chat/{id} hoặc /u/{number}/app/chat/{id} - conversation mới
        const isInConversation = 
            urlPath.match(/^\/app\/[a-f0-9]+/) ||           // /app/{id}
            urlPath.match(/^\/u\/\d+\/app\/[a-f0-9]+/) ||   // /u/4/app/{id}
            urlPath.includes('/chat/');                      // bất kỳ URL nào có /chat/
        
        if (!isInConversation) {
            throw new Error("Vui lòng mở một conversation trước khi bật Always On Top. Hiện tại bạn đang ở trang chủ.");
        }
        
        console.log("----> ✓ Đang ở trong conversation:", urlPath);
        
        // LƯU URL HIỆN TẠI để tránh Gemini tạo conversation mới
        const originalUrl = currentUrl;
        console.log("----> Lưu URL hiện tại:", originalUrl);
        
        // Tìm container. Gemini thường dùng <main> hoặc body > xin-app-container
        geminiContainer = document.querySelector('main') || 
                          document.querySelector('[role="main"]') ||
                          document.body.firstElementChild;

        if (!geminiContainer) {
            throw new Error("Không tìm thấy Gemini container");
        }

        originalParent = geminiContainer.parentNode;

        // Tạo spacer để giữ chiều cao cho tab gốc
        spacerElement = document.createElement('div');
        spacerElement.style.cssText = `
            height: 100vh;
            width: 100vw;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 18px;
            text-align: center;
            padding: 20px;
        `;
        spacerElement.innerHTML = `
            <div>
                <div style="font-size: 48px; margin-bottom: 20px;">📌</div>
                <div style="font-weight: 600; margin-bottom: 10px;">Gemini đang chạy trong cửa sổ ghim</div>
                <div style="opacity: 0.7; font-size: 14px;">Cửa sổ luôn hiển thị trên cùng để bạn theo dõi tiến độ</div>
            </div>
        `;

        console.log("----> 2. Đang mở PiP window...");

        // 2. Mở cửa sổ PiP
        pipWindow = await window.documentPictureInPicture.requestWindow({
            width: 1000,
            height: 800,
        });

        console.log("----> 3. Đang sao chép giao diện...");

        // 3. ⚠️ QUAN TRỌNG: SAO CHÉP GIAO DIỆN
        
        // A. Thêm viewport meta tag cho responsive design
        const viewportMeta = pipWindow.document.createElement('meta');
        viewportMeta.name = 'viewport';
        viewportMeta.content = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=5.0';
        pipWindow.document.head.appendChild(viewportMeta);
        console.log("----> ✓ Đã thêm viewport meta tag");
        
        // B. Copy attributes của <HTML> gốc (quan trọng cho Dark mode)
        const htmlAttrs = document.documentElement.attributes;
        for (let i = 0; i < htmlAttrs.length; i++) {
            pipWindow.document.documentElement.setAttribute(
                htmlAttrs[i].name, 
                htmlAttrs[i].value
            );
        }
        console.log("----> ✓ Đã copy HTML attributes (Dark mode, theme, etc.)");

        // C. Copy attributes của <BODY> gốc
        const bodyAttrs = document.body.attributes;
        for (let i = 0; i < bodyAttrs.length; i++) {
            pipWindow.document.body.setAttribute(
                bodyAttrs[i].name, 
                bodyAttrs[i].value
            );
        }
        console.log("----> ✓ Đã copy BODY attributes");

        // D. Copy toàn bộ Style từ <HEAD>
        const headNodes = document.head.children;
        for (let node of headNodes) {
            if (node.tagName === 'STYLE' || 
                (node.tagName === 'LINK' && node.rel === 'stylesheet')) {
                pipWindow.document.head.appendChild(node.cloneNode(true));
            }
        }
        console.log("----> ✓ Đã copy styles");

        // E. Lấy màu nền thực tế (Computed Style)
        const computedStyle = window.getComputedStyle(document.body);
        pipWindow.document.body.style.backgroundColor = computedStyle.backgroundColor;
        pipWindow.document.body.style.color = computedStyle.color;
        pipWindow.document.body.style.fontFamily = computedStyle.fontFamily;
        console.log(`----> ✓ Đã copy computed styles (bg: ${computedStyle.backgroundColor})`);
        
        // F. Thêm responsive CSS cho PiP window
        const responsiveStyle = pipWindow.document.createElement('style');
        responsiveStyle.textContent = `
            * {
                box-sizing: border-box;
            }
            html, body {
                width: 100%;
                height: 100%;
                overflow: auto;
            }
            /* Đảm bảo các element không overflow */
            img, video, iframe {
                max-width: 100%;
                height: auto;
            }
        `;
        pipWindow.document.head.appendChild(responsiveStyle);
        console.log("----> ✓ Đã thêm responsive CSS");

        console.log("----> 4. Đang di chuyển DOM...");

        // 4. DI CHUYỂN DOM
        // Chèn spacer vào chỗ cũ trước khi bưng container đi
        originalParent.insertBefore(spacerElement, geminiContainer);
        
        // Move container sang PiP
        pipWindow.document.body.appendChild(geminiContainer);

        // Tinh chỉnh CSS cho PiP body - Responsive
        pipWindow.document.body.style.margin = '0';
        pipWindow.document.body.style.padding = '0';
        pipWindow.document.body.style.height = '100vh';
        pipWindow.document.body.style.width = '100vw';
        pipWindow.document.body.style.overflow = 'auto';
        pipWindow.document.body.style.position = 'relative';
        
        // Fix cho container của Gemini - Responsive
        if (geminiContainer) {
            geminiContainer.style.height = '100%';
            geminiContainer.style.minHeight = '100vh';
            geminiContainer.style.width = '100%';
            geminiContainer.style.maxWidth = '100%';
            geminiContainer.style.overflow = 'auto';
            geminiContainer.style.boxSizing = 'border-box';
        }

        console.log("----> 5. Đang setup intercept cho dropdowns/modals...");

        // 5. Intercept appendChild/insertBefore để redirect vào PiP
        // Gemini thường append dropdown/modal vào document.body gốc
        // Chúng ta cần redirect chúng vào pipWindow.document.body
        setupDOMIntercept(pipWindow);

        console.log("----> 6. Đang tạo Progress Display...");

        // 6. Tạo Progress Display (iframe progress.html)
        createProgressDisplay(pipWindow);

        console.log("----> ✓ PiP window đã sẵn sàng!");
        console.log("----> 💡 Giao diện giống 100% bản gốc (Dark mode, fonts, colors)");
        console.log("----> 💡 Dropdowns/modals sẽ hiển thị trong PiP");
        console.log("----> 💡 Trạng thái hiển thị từ progress.html");

        // 6.5. KIỂM TRA VÀ KHÔI PHỤC URL (ngăn Gemini tạo conversation mới)
        await new Promise(r => setTimeout(r, 500)); // Đợi DOM ổn định
        
        // Kiểm tra lại URL sau khi mở PiP
        let newUrl = window.location.href;
        if (newUrl !== originalUrl) {
            console.log("----> ⚠️ Phát hiện URL thay đổi!");
            console.log("----> URL cũ:", originalUrl);
            console.log("----> URL mới:", newUrl);
            console.log("----> Đang khôi phục về conversation cũ...");
            
            // Chỉ dùng replaceState, KHÔNG reload trang
            window.history.replaceState(null, '', originalUrl);
            
            console.log("----> ✓ Đã khôi phục URL (không reload)");
        } else {
            console.log("----> ✓ URL không thay đổi, không cần khôi phục");
        }
        
        // Theo dõi navigation events để ngăn Gemini tạo conversation mới
        const navigationBlocker = (e) => {
            const latestUrl = window.location.href;
            if (latestUrl !== originalUrl && pipWindow && !pipWindow.closed) {
                console.log("----> ⚠️ Phát hiện navigation attempt:", latestUrl);
                console.log("----> Blocking và khôi phục về:", originalUrl);
                e.preventDefault();
                e.stopPropagation();
                window.history.replaceState(null, '', originalUrl);
                return false;
            }
        };
        
        // Listen cho các navigation events
        window.addEventListener('popstate', navigationBlocker, true);
        window.addEventListener('hashchange', navigationBlocker, true);
        
        console.log("----> ✓ Đã setup navigation blocker");

        // 7. Xử lý khi đóng
        pipWindow.addEventListener('pagehide', () => {
            console.log("----> PiP đóng, hoàn trả DOM...");
            
            // Cleanup navigation blocker
            window.removeEventListener('popstate', navigationBlocker, true);
            window.removeEventListener('hashchange', navigationBlocker, true);
            console.log("----> ✓ Đã cleanup navigation blocker");
            
            if (originalParent && geminiContainer) {
                // Xóa spacer
                if (spacerElement && spacerElement.parentNode) {
                    spacerElement.parentNode.removeChild(spacerElement);
                }
                // Trả container về
                originalParent.appendChild(geminiContainer);
                // Reset styles
                geminiContainer.style.height = '';
                geminiContainer.style.minHeight = '';
            }
            
            pipWindow = null;
            statusOverlay = null;
            spacerElement = null;
        });

    } catch (error) {
        console.error("----> ❌ Lỗi mở PiP:", error);
        throw error;
    }
}

function closePiPWindow() {
    if (pipWindow && !pipWindow.closed) {
        pipWindow.close();
    }
}

// Hàm setup intercept để redirect dropdowns/modals vào PiP
function setupDOMIntercept(win) {
    // Theo dõi khi Gemini append element vào document.body gốc
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                // Chỉ xử lý element nodes
                if (node.nodeType !== 1) return;
                
                // Kiểm tra xem có phải dropdown/modal/overlay không
                // Gemini thường dùng các class như: dropdown, menu, modal, overlay, dialog
                const isOverlay = node.classList && (
                    node.classList.contains('dropdown') ||
                    node.classList.contains('menu') ||
                    node.classList.contains('modal') ||
                    node.classList.contains('overlay') ||
                    node.classList.contains('dialog') ||
                    node.classList.contains('popup') ||
                    node.getAttribute('role') === 'menu' ||
                    node.getAttribute('role') === 'dialog' ||
                    node.getAttribute('role') === 'listbox'
                );
                
                if (isOverlay) {
                    console.log("----> 🔄 Phát hiện dropdown/modal, đang redirect vào PiP...");
                    console.log("----> Element:", node.className || node.tagName);
                    
                    // Remove khỏi document.body gốc
                    if (node.parentNode === document.body) {
                        document.body.removeChild(node);
                    }
                    
                    // Append vào PiP window
                    if (win && !win.closed) {
                        win.document.body.appendChild(node);
                        console.log("----> ✓ Đã redirect vào PiP");
                    }
                }
            });
        });
    });
    
    // Bắt đầu observe document.body gốc
    observer.observe(document.body, {
        childList: true,
        subtree: false // Chỉ observe direct children của body
    });
    
    console.log("----> ✓ DOM intercept đã được setup");
    
    // Cleanup khi PiP đóng
    win.addEventListener('pagehide', () => {
        observer.disconnect();
        console.log("----> DOM intercept đã được cleanup");
    });
}

// Hàm tạo Progress Display - Inject HTML trực tiếp vào PiP window
function createProgressDisplay(win) {
    const doc = win.document;
    
    // Tạo container cho progress display
    const container = doc.createElement('div');
    container.id = 'progress-display-container';
    container.style.cssText = `
        position: fixed;
        top: 0;
        right: 0;
        width: clamp(280px, 30vw, 400px);
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(10px);
        z-index: 2147483646;
        box-sizing: border-box;
        transition: transform 0.3s ease;
        border-left: 1px solid rgba(255, 255, 255, 0.1);
        overflow-y: auto;
        overflow-x: hidden;
        padding: 20px;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    
    // Inject CSS styles từ progress.html (compact design)
    const progressStyles = doc.createElement('style');
    progressStyles.textContent = `
        * { box-sizing: border-box; }
        #progress-display-container .header {
            font-size: clamp(16px, 4vw, 22px);
            font-weight: bold;
            text-align: center;
            padding: clamp(5px, 1vw, 10px) 0;
            margin-bottom: clamp(8px, 2vw, 12px);
        }
        #progress-display-container .progress-container {
            background: rgba(255, 255, 255, 0.15);
            border-radius: clamp(6px, 1.5vw, 10px);
            padding: clamp(10px, 2vw, 15px);
            backdrop-filter: blur(10px);
            margin-bottom: clamp(8px, 2vw, 12px);
        }
        #progress-display-container .progress-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: clamp(6px, 1.5vw, 10px);
        }
        #progress-display-container .progress-label {
            font-size: clamp(11px, 2.5vw, 14px);
            opacity: 0.9;
        }
        #progress-display-container .progress-percent {
            font-size: clamp(14px, 3vw, 18px);
            font-weight: bold;
        }
        #progress-display-container .progress-bar {
            width: 100%;
            height: clamp(16px, 3vw, 24px);
            background: rgba(255, 255, 255, 0.25);
            border-radius: clamp(8px, 1.5vw, 12px);
            overflow: hidden;
        }
        #progress-display-container .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #8BC34A);
            transition: width 0.4s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: clamp(9px, 2vw, 12px);
            box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.3);
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.8; }
        }
        #progress-display-container .stats {
            display: flex;
            gap: clamp(6px, 1.5vw, 10px);
            margin-top: clamp(8px, 2vw, 12px);
        }
        #progress-display-container .stat-item {
            flex: 1;
            background: rgba(255, 255, 255, 0.15);
            padding: clamp(6px, 1.5vw, 10px);
            border-radius: clamp(4px, 1vw, 8px);
            text-align: center;
        }
        #progress-display-container .stat-label {
            font-size: clamp(9px, 2vw, 11px);
            opacity: 0.8;
            margin-bottom: clamp(2px, 0.5vw, 4px);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        #progress-display-container .stat-value {
            font-size: clamp(16px, 4vw, 22px);
            font-weight: bold;
            color: #8BC34A;
        }
        #progress-display-container .current-chapter {
            background: rgba(255, 255, 255, 0.15);
            border-radius: clamp(6px, 1.5vw, 10px);
            padding: clamp(8px, 2vw, 12px);
            margin-bottom: clamp(8px, 2vw, 12px);
        }
        #progress-display-container .chapter-label {
            font-size: clamp(9px, 2vw, 11px);
            opacity: 0.8;
            margin-bottom: clamp(3px, 0.8vw, 5px);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        #progress-display-container .chapter-name {
            font-size: clamp(12px, 2.8vw, 16px);
            font-weight: 600;
            word-wrap: break-word;
            line-height: 1.3;
        }
        #progress-display-container .status {
            background: rgba(255, 255, 255, 0.15);
            border-radius: clamp(6px, 1.5vw, 10px);
            padding: clamp(8px, 2vw, 12px);
            text-align: center;
            font-size: clamp(11px, 2.5vw, 14px);
            font-weight: 500;
            transition: all 0.3s ease;
        }
        #progress-display-container .status.translating {
            background: rgba(76, 175, 80, 0.3);
            box-shadow: 0 0 15px rgba(76, 175, 80, 0.2);
        }
        #progress-display-container .status.waiting {
            background: rgba(255, 152, 0, 0.3);
            box-shadow: 0 0 15px rgba(255, 152, 0, 0.2);
        }
        #progress-display-container .status.error {
            background: rgba(244, 67, 54, 0.3);
            box-shadow: 0 0 15px rgba(244, 67, 54, 0.2);
        }
        @media (max-width: 800px) {
            #progress-display-container { width: clamp(250px, 40vw, 350px); }
        }
        @media (max-width: 600px) {
            #progress-display-container {
                width: 100%;
                height: auto !important;
                max-height: 300px;
                top: auto !important;
                bottom: 0;
                border-left: none;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding: 10px;
            }
        }
        @media (max-width: 400px) {
            #progress-display-container { padding: 8px; }
        }
    `;
    doc.head.appendChild(progressStyles);
    
    // Tạo HTML content (clone từ progress.html)
    container.innerHTML = `
        <div class="header">🎬 Tiến độ dịch subtitle</div>
        
        <div class="progress-container">
            <div class="progress-header">
                <span class="progress-label">Tiến độ</span>
                <span class="progress-percent" id="pip-progressPercent">0%</span>
            </div>
            
            <div class="progress-bar">
                <div class="progress-fill" id="pip-progressFill" style="width: 0%">
                    <span id="pip-progressText">0%</span>
                </div>
            </div>
            
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-label">Đã dịch</div>
                    <div class="stat-value" id="pip-completedCount">0</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Tổng số</div>
                    <div class="stat-value" id="pip-totalCount">50</div>
                </div>
            </div>
        </div>
        
        <div class="current-chapter">
            <div class="chapter-label">Batch hiện tại</div>
            <div class="chapter-name" id="pip-currentChapter">Đang khởi động...</div>
        </div>
        
        <div class="status" id="pip-status">Sẵn sàng</div>
    `;
    
    // Tạo nút toggle
    const toggleBtn = doc.createElement('button');
    toggleBtn.id = 'progress-toggle';
    toggleBtn.textContent = '◀';
    toggleBtn.style.cssText = `
        position: absolute;
        left: -30px;
        top: 50%;
        transform: translateY(-50%);
        width: 30px;
        height: 60px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        border: none;
        border-radius: 5px 0 0 5px;
        cursor: pointer;
        font-size: 18px;
        z-index: 1;
        transition: all 0.3s ease;
        box-shadow: -2px 0 10px rgba(0, 0, 0, 0.3);
    `;
    
    let isHidden = false;
    toggleBtn.onclick = () => {
        isHidden = !isHidden;
        if (isHidden) {
            container.style.transform = 'translateX(100%)';
            toggleBtn.textContent = '▶';
        } else {
            container.style.transform = 'translateX(0)';
            toggleBtn.textContent = '◀';
        }
    };
    
    container.appendChild(toggleBtn);
    doc.body.appendChild(container);
    statusOverlay = container;
    
    console.log("----> ✓ Progress Display đã được tạo (HTML injection, có thể ẩn/hiện)");
}

// Hàm cập nhật progress trong PiP window
function updatePiPProgress(data) {
    if (!pipWindow || pipWindow.closed || !statusOverlay) {
        console.log("----> ⚠️ PiP window chưa mở hoặc đã đóng");
        return;
    }
    
    try {
        const doc = pipWindow.document;
        const { completed, total, currentChapter, status } = data;
        
        // Update progress bar
        const percentage = Math.round((completed / total) * 100);
        const progressFill = doc.getElementById('pip-progressFill');
        const progressText = doc.getElementById('pip-progressText');
        const progressPercent = doc.getElementById('pip-progressPercent');
        if (progressFill && progressText) {
            progressFill.style.width = percentage + '%';
            progressText.textContent = percentage + '%';
        }
        if (progressPercent) {
            progressPercent.textContent = percentage + '%';
        }
        
        // Update stats
        const completedEl = doc.getElementById('pip-completedCount');
        const totalEl = doc.getElementById('pip-totalCount');
        if (completedEl) completedEl.textContent = completed;
        if (totalEl) totalEl.textContent = total;
        
        // Update current chapter
        if (currentChapter) {
            const chapterEl = doc.getElementById('pip-currentChapter');
            if (chapterEl) chapterEl.textContent = currentChapter;
        }
        
        // Update status
        const statusEl = doc.getElementById('pip-status');
        if (statusEl) {
            statusEl.textContent = status || 'Đang dịch...';
            
            // Update status color
            statusEl.className = 'status';
            if (status && status.includes('dịch')) {
                statusEl.classList.add('translating');
            } else if (status && status.includes('đợi')) {
                statusEl.classList.add('waiting');
            } else if (status && (status.includes('lỗi') || status.includes('Lỗi'))) {
                statusEl.classList.add('error');
            }
        }
        
        console.log(`----> ✓ Progress updated in PiP: ${completed}/${total} - ${currentChapter}`);
    } catch (error) {
        console.error("----> ❌ Lỗi update progress:", error);
    }
}
