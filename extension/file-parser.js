// Module để đọc và phân tích file txt thành các chương

class FileParser {
    constructor() {
        this.chapters = [];
        this.currentIndex = 0;
    }

    /**
     * Phân tích file txt thành các chương
     * @param {string} content - Nội dung file txt
     * @returns {Array} - Mảng các chương
     */
    parseChapters(content) {
        this.chapters = [];
        this.currentIndex = 0;

        // Tối ưu: Compile regex một lần
        const patterns = {
            // Pattern: "第X章 Tên chương" - ví dụ: "第1章 车队第一铁律"
            chapter1: /^第(\d+)章\s*(.+)$/,
            // Pattern lọc quảng cáo
            ads: /溫馨提示|登錄用戶|VIP會員|點擊查看|避免下次找不到/
        };
        
        const lines = content.split('\n');
        let currentChapter = null;
        let chapterContent = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip dòng trống và quảng cáo
            if (!line || patterns.ads.test(line)) {
                continue;
            }
            
            // Thử match pattern "第X章 Tên chương"
            const match1 = line.match(patterns.chapter1);
            
            if (match1) {
                // Lưu chương trước đó (nếu có)
                this._saveCurrentChapter(currentChapter, chapterContent);
                
                // Tạo chương mới
                const [, numStr, title] = match1;
                const chapterNumber = parseInt(numStr);
                
                currentChapter = {
                    number: chapterNumber,
                    title: `第${chapterNumber}章 ${title.trim()}`,
                    fullTitle: line,
                    content: '',
                    startLine: i
                };
                chapterContent = [line];
            } else if (currentChapter) {
                // Nội dung chương
                chapterContent.push(line);
            }
        }

        // Lưu chương cuối cùng
        this._saveCurrentChapter(currentChapter, chapterContent);

        console.log(`📖 Phân tích hoàn tất: ${this.chapters.length} chương`);
        return this.chapters;
    }

    /**
     * Helper: Lưu chương hiện tại
     */
    _saveCurrentChapter(chapter, content) {
        if (chapter && content.length > 0) {
            chapter.content = content.join('\n').trim();
            this.chapters.push(chapter);
        }
    }

    /**
     * Lấy chương hiện tại
     */
    getCurrentChapter() {
        if (this.currentIndex >= this.chapters.length) {
            return null;
        }
        return this.chapters[this.currentIndex];
    }

    /**
     * Chuyển sang chương tiếp theo
     */
    nextChapter() {
        if (this.currentIndex < this.chapters.length - 1) {
            this.currentIndex++;
            return true;
        }
        return false;
    }

    /**
     * Đặt lại về chương đầu tiên
     */
    reset() {
        this.currentIndex = 0;
    }

    /**
     * Kiểm tra xem còn chương nào không
     */
    hasNext() {
        return this.currentIndex < this.chapters.length - 1;
    }

    /**
     * Lấy tổng số chương
     */
    getTotalChapters() {
        return this.chapters.length;
    }

    /**
     * Lấy chương tại index
     */
    getChapter(index) {
        if (index >= 0 && index < this.chapters.length) {
            return this.chapters[index];
        }
        return null;
    }
}

// Export để sử dụng trong background script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileParser;
}
