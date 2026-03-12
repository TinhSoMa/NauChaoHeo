import fs from 'fs';
import path from 'path';

// Set để theo dõi các file tạm (vd: file .ass)
const trackedTempFiles = new Set<string>();

/**
 * Đăng ký một file tạm để theo dõi
 * @param filePath Đường dẫn file cần theo dõi
 */
export function registerTempFile(filePath: string): void {
  trackedTempFiles.add(path.resolve(filePath));
}

/**
 * Hủy theo dõi một file tạm (thường gọi khi file đã được xóa thành công)
 * @param filePath Đường dẫn file cần hủy theo dõi
 */
export function unregisterTempFile(filePath: string): void {
  trackedTempFiles.delete(path.resolve(filePath));
}

/**
 * Hàm gọi khi ứng dụng sắp tắt để dọn dẹp tất cả các file rác còn sót lại trong Set
 */
export function cleanTempFiles(): void {
  console.log(`[GarbageCollector] Đang dọn dẹp ${trackedTempFiles.size} file rác...`);
  
  for (const filePath of trackedTempFiles) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath); // Dùng synchronous để đảm bảo chạy xong trước khi app tắt
        console.log(`[GarbageCollector] Đã xóa file rác: ${filePath}`);
      }
    } catch (e) {
      console.error(`[GarbageCollector] Lỗi khi xóa file rác ${filePath}:`, e);
    }
  }
  
  // Dọn sạch danh sách sau khi quét
  trackedTempFiles.clear();
}
