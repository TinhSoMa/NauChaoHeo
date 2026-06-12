console.log("----> Story Content Script ready");

// Message Listeners
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_CONTENT") {
        const data = getStoryContent();
        sendResponse(data);
        return true;
    } 
    else if (request.action === "CLICK_NEXT") {
        const success = clickNextChapter();
        sendResponse({ success: success });
        return true;
    }
});

// Detect Website
function detectWebsite() {
    const hostname = window.location.hostname;
    
    if (hostname.includes('69shuba') || hostname.includes('69shu')) {
        return '69shuba';
    } else if (hostname.includes('novel543')) {
        return 'novel543';
    } else if (hostname.includes('thienloitruc')) {
        return 'thienloitruc';
    }
    
    return 'unknown';
}

// Get Story Content
function getStoryContent() {
    try {
        const website = detectWebsite();
        console.log(`----> Getting content from: ${website}`);
        
        if (website === '69shuba') {
            return extractFrom69shuba();
        } 
        else if (website === 'novel543') {
            return extractFromNovel543();
        }
        else if (website === 'thienloitruc') {
            return extractFromThienLoiTruc();
        }
        else {
            return { error: "Website not supported" };
        }
        
    } catch (e) {
        console.error("----> Error getting content:", e);
        return { error: e.message };
    }
}

// Extract from 69shuba
function extractFrom69shuba() {
    console.log("----> Using selector for 69shuba");
    
    const titleElement = document.querySelector('h1');
    const title = titleElement ? titleElement.innerText.trim() : "Unknown Title";
    
    const contentElement = document.querySelector('.txtnav');
    
    if (!contentElement) {
        return { error: 'Content not found on 69shuba' };
    }

    const rawText = contentElement.innerText || contentElement.textContent;
    
    console.log(`----> Got: ${title}`);
    console.log(`----> Length: ${rawText.length} chars`);
    
    return {
        title: title,
        content: rawText.trim(),
        website: '69shuba'
    };
}

// Extract from novel543
function extractFromNovel543() {
    console.log("----> Using selector for novel543");
    
    const titleElement = document.querySelector('.chapter-content h1');
    const title = titleElement ? titleElement.innerText.trim() : "Unknown Title";
    
    const contentDiv = document.querySelector('.chapter-content .content');
    
    if (!contentDiv) {
        return { error: 'Content not found on novel543' };
    }
    
    const paragraphs = contentDiv.querySelectorAll('p');
    
    const validParagraphs = Array.from(paragraphs).filter(p => {
        const text = p.innerText.trim();
        
        if (text.length === 0) return false;
        if (text.includes('溫馨提示')) return false;
        if (text.includes('登錄用戶')) return false;
        if (p.querySelector('.gadBlock')) return false;
        if (p.querySelector('.adBlock')) return false;
        
        return true;
    });
    
    const rawText = validParagraphs.map(p => p.innerText.trim()).join('\n\n');
    
    console.log(`----> Got: ${title}`);
    console.log(`----> Valid paragraphs: ${validParagraphs.length}`);
    console.log(`----> Length: ${rawText.length} chars`);
    
    return {
        title: title,
        content: rawText,
        website: 'novel543'
    };
}

// Extract from Thien Loi Truc
function extractFromThienLoiTruc() {
    console.log("----> Using selector for thienloitruc (Angular app)");
    
    let title = "Unknown Title";
    
    // Try multiple selectors for title
    const titleSelectors = [
        '.novel-title h1',
        '.novel-title',
        'h1',
        'h2', 
        'h3',
        '.reader-title',
        '.chapter-title'
    ];
    
    for (let selector of titleSelectors) {
        const titleElement = document.querySelector(selector);
        if (titleElement) {
            title = titleElement.innerText.trim();
            console.log(`----> Found title with selector: ${selector}`);
            break;
        }
    }
    
    // Strategy: Tìm .reader-content, sau đó BỎ QUA app-donate-qr
    const readerContent = document.querySelector('.reader-content');
    if (!readerContent) {
        return { error: 'Content not found on thienloitruc (no .reader-content)' };
    }
    
    // Remove app-donate-qr component if exists
    const donateBox = readerContent.querySelector('app-donate-qr');
    if (donateBox) {
        console.log("----> Removing donate box from content");
    }
    
    // Get all direct p and div children, excluding app-donate-qr
    let textContent = '';
    const children = readerContent.children;
    
    for (let child of children) {
        // Skip app-donate-qr
        if (child.tagName.toLowerCase() === 'app-donate-qr') {
            continue;
        }
        
        // Get text from this element
        const text = child.innerText || child.textContent;
        if (text && text.trim().length > 0) {
            textContent += text.trim() + '\n\n';
        }
    }
    
    if (!textContent || textContent.trim().length === 0) {
        return { error: 'No valid content found after filtering donate box' };
    }
    
    console.log(`----> Got: ${title}`);
    console.log(`----> Length: ${textContent.length} chars`);
    
    return {
        title: title,
        content: textContent.trim(),
        website: 'thienloitruc'
    };
}

// Click Next Chapter
function clickNextChapter() {
    try {
        console.log("----> Looking for Next button...");
        
        const website = detectWebsite();
        
        // Special handling for thienloitruc (Angular app)
        if (website === 'thienloitruc') {
            console.log("----> Searching for Next button on thienloitruc (Angular)...");
            
            const buttons = document.querySelectorAll('button');
            
            for (let button of buttons) {
                const icon = button.querySelector('mat-icon');
                if (icon) {
                    const iconText = icon.innerText || icon.textContent;
                    if (iconText.includes('navigate_next')) {
                        console.log("----> Found Next button (navigate_next icon), clicking...");
                        button.click();
                        return true;
                    }
                }
            }
            
            // Fallback: find button with aria-label or matTooltip
            for (let button of buttons) {
                const ariaLabel = button.getAttribute('aria-label') || '';
                const tooltip = button.getAttribute('mattooltip') || '';
                
                if (ariaLabel.toLowerCase().includes('next') || 
                    tooltip.toLowerCase().includes('next') ||
                    tooltip.includes('tiếp theo')) {
                    console.log("----> Found Next button (aria-label/tooltip), clicking...");
                    button.click();
                    return true;
                }
            }
            
            console.warn("----> Next button not found on thienloitruc!");
            return false;
        }
        
        // Handle other websites (69shuba, novel543)
        const links = document.querySelectorAll('a');
        
        for (let link of links) {
            const linkText = link.innerText || link.textContent;
            
            if (linkText.includes("下一章")) {
                console.log("----> Found Next button, clicking...");
                link.click();
                return true;
            }
        }
        
        const alternativeTexts = ["下一页", "Next", "next", "下一頁"];
        
        for (let link of links) {
            const linkText = link.innerText || link.textContent;
            
            for (let altText of alternativeTexts) {
                if (linkText.includes(altText)) {
                    console.log(`----> Found Next button (${altText}), clicking...`);
                    link.click();
                    return true;
                }
            }
        }
        
        console.warn("----> Next button not found!");
        return false;
        
    } catch (e) {
        console.error("----> Error clicking next:", e);
        return false;
    }
}

console.log("----> Content Script Story ready!");
console.log("----> Supported websites: 69shuba.com, novel543.com, thienloitruc.com");
