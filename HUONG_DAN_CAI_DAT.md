# Hướng dẫn cài đặt NauChaoHeo

## 1. Giới thiệu

**NauChaoHeo** là ứng dụng desktop cá nhân hỗ trợ dịch phụ đề, xử lý video, tải video, chuyển văn bản thành giọng nói (TTS) và dịch truyện/ebook, sử dụng AI.

**Công nghệ sử dụng:**
- **Electron 39** — khung ứng dụng desktop
- **React 19** + **TypeScript 5** — giao diện người dùng
- **Vite 6** + **electron-vite** — build tool
- **Zustand** — quản lý state
- **Tailwind CSS 4** — styling
- **better-sqlite3** — database
- **Go** — TTS worker (edge-tts)
- **Python 3.12** — các worker phụ trợ (Gemini Web API, Grok UI, edge-tts, ebook, memory context, audio merge)

**GitHub:** https://github.com/TinhSoMa/NauChaoHeo

---

## 2. Yêu cầu hệ thống

- **Hệ điều hành:** Windows 10/11 x64 (ưu tiên). macOS/Linux có hỗ trợ nhưng Python runtime worker chỉ hoạt động trên Windows.
- **Dung lượng ổ cứng trống:** ~2 GB (bao gồm Python runtime + dependencies)
- **Internet:** Cần tải dependencies lần đầu

---

## 3. Cài đặt môi trường

> ⚠️ Nếu bạn đã có các công cụ này rồi, hãy kiểm tra phiên bản và bỏ qua bước tương ứng.

### 3.1. Git

Tải và cài đặt Git từ: https://git-scm.com/downloads

**Hoặc cài tự động bằng PowerShell (nếu máy chưa có Git):**

```powershell
# Tải Git installer
$url = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\Git-64-bit.exe" -UseBasicParsing
# Cài đặt (chạy với tư cách Admin nếu cần)
Start-Process -FilePath "$env:TEMP\Git-64-bit.exe" -ArgumentList "/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS" -Wait -NoNewWindow
```

Sau khi cài, **làm mới PATH** rồi kiểm tra:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
git --version
```

Kết quả mong đợi: `git version 2.x.x`

> ⚠️ **Lưu ý:** Sau khi cài bất kỳ công cụ nào, bạn cần làm mới PATH trong PowerShell hiện tại bằng lệnh `$env:Path = ...` như trên, hoặc mở terminal mới.

### 3.2. Node.js

Tải và cài đặt Node.js bản **LTS** (>= 20) từ: https://nodejs.org/

Kiểm tra:

```powershell
node --version
npm --version
```

Kết quả mong đợi: `v20.x.x` trở lên (node) và `10.x.x` trở lên (npm).

### 3.3. Go

Tải và cài đặt Go phiên bản **1.24+** từ: https://go.dev/dl/

**Hoặc cài tự động bằng PowerShell:**

```powershell
# Tải Go MSI (~70MB, có thể mất 1-2 phút)
Invoke-WebRequest -Uri "https://go.dev/dl/go1.24.2.windows-amd64.msi" -OutFile "$env:TEMP\go.msi" -UseBasicParsing
# Cài đặt (chạy với tư cách Admin nếu cần)
Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$env:TEMP\go.msi`" /quiet /norestart" -Wait -NoNewWindow
```

Sau khi cài, làm mới PATH và kiểm tra:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
go version
```

Kết quả mong đợi: `go version go1.24.x windows/amd64`

> ⚠️ File tải Go ~70MB, nên dùng timeout >= 180s nếu chạy script tự động.

### 3.4. Python

Tải và cài đặt **Python 3.12.x** từ: https://www.python.org/downloads/

> ⚠️ **QUAN TRỌNG:** Trong quá trình cài đặt, **phải tick** ô "Add Python to PATH" (hoặc "Add to environment variables").

**Hoặc cài tự động bằng PowerShell (tự động thêm PATH):**

```powershell
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe" -OutFile "$env:TEMP\python.exe" -UseBasicParsing
Start-Process -FilePath "$env:TEMP\python.exe" -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0" -Wait -NoNewWindow
```

Sau khi cài, làm mới PATH và kiểm tra:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
python --version
```

Kết quả mong đợi: `Python 3.12.x`

### 3.5. FFmpeg

Tải FFmpeg từ: https://ffmpeg.org/download.html (bản Windows builds từ gyan.dev hoặc BtbN)

Sau khi tải, giải nén và thêm thư mục `bin` vào biến môi trường PATH.

Kiểm tra:

```powershell
ffmpeg -version
```

> 💡 **Hoặc bạn có thể dùng FFmpeg có sẵn trong dự án** (sẽ được copy tự động khi build), nhưng để chạy development bạn nên cài riêng.

**Hoặc cài tự động bằng PowerShell (tải từ GitHub, thêm vào PATH toàn cục):**

```powershell
# Tải FFmpeg (~70MB, cần timeout >= 180s)
Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile "$env:TEMP\ffmpeg.zip" -UseBasicParsing
# Giải nén
Expand-Archive -Path "$env:TEMP\ffmpeg.zip" -DestinationPath "$env:TEMP\ffmpeg_extract" -Force
# Copy vào thư mục chung
New-Item -ItemType Directory -Path "C:\ProgramData\ffmpeg\bin" -Force
Copy-Item -Path "$env:TEMP\ffmpeg_extract\ffmpeg-master-latest-win64-gpl\bin\*" -Destination "C:\ProgramData\ffmpeg\bin" -Force
# Thêm vào PATH máy (vĩnh viễn)
$oldPath = [System.Environment]::GetEnvironmentVariable("Path","Machine")
$newPath = "$oldPath;C:\ProgramData\ffmpeg\bin"
[System.Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")
```

Sau đó làm mới PATH và kiểm tra:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
ffmpeg -version
```

---

## 4. Tải mã nguồn

Mở Terminal tại thư mục bạn muốn lưu dự án, chạy:

```powershell
git clone https://github.com/TinhSoMa/NauChaoHeo.git
cd NauChaoHeo
```

Sau đó kiểm tra nhánh hiện tại:

```powershell
git branch
```

Bạn sẽ thấy `* main` — đây là nhánh chính.

**Chuyển sang nhánh phát triển (nếu cần):** Dự án đang phát triển ở nhánh `feat/update-capcut-token`.

```powershell
git checkout feat/update-capcut-token
```

---

## 5. Cài đặt dependencies

### 5.1. npm packages

```powershell
npm install
```

Lệnh này sẽ tải toàn bộ dependencies JavaScript:
- **Core:** Electron 39, React 19, React Router 7
- **State:** Zustand
- **UI:** Tailwind CSS 4, Lucide React icons, clsx, tailwind-merge
- **AI/Network:** @google/genai, axios, cheerio, https-proxy-agent, socks-proxy-agent, ws
- **Native:** better-sqlite3 (SQLite database)
- **Build:** electron-vite, Vite 6, TypeScript 5, PostCSS, electron-builder

> **Lưu ý:** Nếu gặp lỗi liên quan đến `better-sqlite3` (native addon), hãy chạy:
> ```powershell
> npx electron-rebuild
> ```

> **⚠️ Lỗi thường gặp: Electron binary không được tải tự động**
>
> `npm install` có thể hoàn thành nhưng Electron binary (~130MB) không được tải xuống, dẫn đến lỗi:
> ```
> Error: Electron failed to install correctly, please delete node_modules/electron and try installing again
> ```
>
> **Cách xử lý:**
>
> 1. Tải thủ công Electron binary từ GitHub:
>    ```powershell
>    $url = "https://github.com/electron/electron/releases/download/v39.8.10/electron-v39.8.10-win32-x64.zip"
>    Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\electron.zip" -UseBasicParsing
>    ```
>
> 2. Xóa thư mục electron và cài lại (dùng mirror để tăng tốc):
>    ```powershell
>    Remove-Item -Recurse -Force node_modules\electron -ErrorAction SilentlyContinue
>    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
>    npm install electron@39.8.10
>    ```
>
> 3. Nếu vẫn lỗi, giải nén thủ công vào `dist` và sửa `path.txt`:
>    ```powershell
>    # Giải nén
>    Expand-Archive -Path "$env:TEMP\electron.zip" -DestinationPath node_modules\electron\dist -Force
>    # Tạo path.txt (dùng -NoNewline để tránh lỗi CRLF)
>    Set-Content -Path "node_modules\electron\path.txt" -Value "electron.exe" -NoNewline
>    ```
>    > ⚠️ **Quan trọng:** Phải dùng `-NoNewline` vì nếu path.txt có ký tự xuống dòng (`\r\n`), Electron sẽ báo lỗi `ENOENT` không tìm thấy file.
>
> 4. Kiểm tra:
>    ```powershell
>    npx electron --version
>    ```
>    Kết quả mong đợi: `v39.8.10`

### 5.2. yt-dlp

Công cụ tải video từ YouTube và các nền tảng khác.

```powershell
npm run prepare:yt-dlp
```

Kết quả: tải `yt-dlp.exe` vào thư mục `resources/yt-dlp/win64/`.

### 5.3. aria2c

Công cụ tải xuống đa luồng.

```powershell
npm run prepare:aria2c
```

Kết quả: tải `aria2c.exe` vào thư mục `resources/aria2c/win64/`.

### 5.4. Go worker (edge-tts)

Build worker chuyển văn bản thành giọng nói (TTS) viết bằng Go.

```powershell
npm run prepare:go-worker
```

Lệnh này sẽ:
1. Tìm Go executable trong PATH (hoặc tại `D:\Program Files\Go\bin\go.exe`)
2. Build file Go tại `src/main/services/tts/go/`
3. Xuất ra `resources/tts/go/edge_tts_worker.exe`

> **Nếu lỗi:** Kiểm tra Go đã cài đúng chưa (`go version`).

### 5.5. Python runtime

> ⚠️ Bước này **chỉ chạy được trên Windows**. Nếu bạn dùng macOS/Linux, có thể bỏ qua (các worker Python sẽ không hoạt động).

```powershell
npm run prepare:python-runtime
```

Script này sẽ:
1. Tải Python 3.12.9 **embedded distribution** từ python.org
2. Giải nén vào `resources/python/win32-x64/runtime/`
3. Cài đặt pip
4. Cài các packages theo `requirements-pycapcut-lock.txt`:
   - `pycapcut` — điều khiển CapCut
   - `ebooklib` — xử lý ebook
   - `imageio`, `numpy`, `pillow` — xử lý ảnh/video
   - `pymediainfo` — thông tin media
   - `uiautomation`, `comtypes` — tự động hóa Windows UI
   - `grok3api` — Grok API (được copy từ thư mục local)
5. Cài thêm các packages cho memory context:
   - `mem0ai[nlp]` — bộ nhớ AI
   - `underthesea` — NLP tiếng Việt
   - `spaCy` model `xx_ent_wiki_sm` — nhận diện thực thể đa ngôn ngữ
6. Chạy smoke test kiểm tra
7. Sao chép license của từng package vào `resources/licenses/python/`

**Thời gian chạy:** có thể mất 5-15 phút tùy tốc độ mạng.

> **Lưu ý:** Nếu bạn đã có Python runtime ở lần chạy trước, script sẽ xóa và tải lại hoàn toàn.

---

## 6. Cấu hình API keys

### 6.1. Gemini API keys

Dự án sử dụng Google Gemini API cho các tính năng AI. Bạn cần tạo file `gemini_keys.json` ở thư mục gốc:

**Cách 1:** Copy từ file mẫu
```powershell
copy gemini_keys_template.json gemini_keys.json
```

**Cách 2:** Copy từ file mẫu khác
```powershell
copy resources\api-keys.example.json gemini_keys.json
```

Sau đó mở file `gemini_keys.json` bằng trình soạn thảo và thay `"AIzaSy..."` bằng API key thật của bạn.

**Để lấy Gemini API key:**
1. Truy cập https://aistudio.google.com/apikey
2. Đăng nhập bằng tài khoản Google
3. Tạo API key mới (miễn phí)
4. Copy key vào file `gemini_keys.json`

Cấu trúc file:

```json
[
  {
    "email": "your-email@gmail.com",
    "projects": [
      { "projectName": "My Project", "apiKey": "AIzaSy..." }
    ]
  }
]
```

### 6.2. API keys khác

Nếu sử dụng các dịch vụ Grok, Gemini Web API (cookie-based), bạn cần cấu hình thêm trong ứng dụng sau khi chạy (phần Settings trong giao diện).

---

## 7. Chạy ứng dụng

```powershell
npm run dev
```

Lệnh này sẽ:
1. Set mã hóa UTF-8 cho terminal (`chcp 65001`)
2. Chạy `electron-vite dev` — khởi động cả 3 layers:
   - **Main process** (`src/main/`) — Node.js backend
   - **Preload** (`src/preload/`) — cầu nối contextBridge
   - **Renderer** (`src/renderer/`) — giao diện React

Cửa sổ ứng dụng sẽ hiện ra. Nếu có lỗi, kiểm tra Terminal để xem log.

---

## 8. Các lệnh hữu ích khác

| Lệnh | Mô tả |
|------|-------|
| `npm run build` | Build ứng dụng (production mode) |
| `npm run preview` / `npm run start` | Chạy bản đã build |
| `npm run build:win` | Build + đóng gói thành file cài đặt Windows (NSIS) |
| `npm run test:extension` | Chạy tất cả tests cho extension |
| `npm run test:extension:background` | Chạy test riêng cho background logic của extension |
| `npm run bench:edge-tts-worker` | Benchmark TTS worker |

---

## 9. Cấu trúc thư mục chính

```
NauChaoHeo/
├── src/
│   ├── main/              # Electron main process (Node.js)
│   ├── preload/           # Context bridge
│   ├── renderer/          # Giao diện React
│   └── shared/            # Code dùng chung
├── resources/             # Tài nguyên đóng gói
│   ├── ffmpeg/            # FFmpeg binaries
│   ├── yt-dlp/            # yt-dlp
│   ├── aria2c/            # aria2c
│   ├── python/            # Python runtime
│   ├── tts/               # Go TTS worker
│   └── fonts/             # Fonts
├── extension/             # Browser extensions
├── scripts/               # Scripts build/prepare
├── tests/                 # Extension tests
└── package.json           # Dependencies & scripts
```

---

## 10. Khắc phục sự cố thường gặp

### Lỗi `better-sqlite3` khi chạy

```
Error: The module '...better-sqlite3.node' was compiled against a different Node.js version
```

**Giải pháp:** Chạy rebuild native module:

```powershell
npx electron-rebuild
```

### Lỗi `go not found` khi chạy `prepare:go-worker`

**Giải pháp:**
- Kiểm tra Go đã được thêm vào PATH chưa
- Hoặc cài Go vào đường dẫn mặc định `D:\Program Files\Go`

### Lỗi Python runtime không hoạt động

**Giải pháp:**
- Chạy lại `npm run prepare:python-runtime`
- Đảm bảo không có ứng dụng nào đang dùng file trong `resources/python/`
- Nếu lỗi tải từ python.org, hãy kiểm tra tường lửa

### Lỗi khi chạy `npm run dev` trên macOS/Linux

- Bỏ qua bước `prepare:python-runtime`
- Python worker sẽ không hoạt động, các tính năng khác vẫn dùng được
- Một số script PowerShell có thể không tương thích

### Lỗi thiếu FFmpeg

**Giải pháp:** Cài FFmpeg và thêm vào PATH, hoặc kiểm tra thư mục `resources/ffmpeg/win64/` có file `ffmpeg.exe` không.

### Lỗi `ENOENT` hoặc `electron.exe` không tìm thấy sau khi cài

```
Error: spawn ...\electron.exe ENOENT
```

**Nguyên nhân:** File `node_modules/electron/path.txt` có ký tự xuống dòng CRLF (`\r\n`) khiến Electron đọc sai đường dẫn.

**Giải pháp:** Ghi lại path.txt với `-NoNewline`:
```powershell
Set-Content -Path "node_modules\electron\path.txt" -Value "electron.exe" -NoNewline
```

### Các vấn đề thường gặp khi cài đặt trên máy mới (fresh install)

Dưới đây là tổng hợp các vấn đề đã gặp khi cài từ đầu trên một máy Windows mới, giúp bạn xử lý nhanh hơn ở lần sau:

| Vấn đề | Mô tả | Cách xử lý |
|--------|-------|------------|
| **PATH không được làm mới** | Sau khi cài Git/Go/Python/FFmpeg, PATH trong PowerShell hiện tại không cập nhật | Dùng lệnh `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")` hoặc mở terminal mới |
| **Download timeout** | File lớn (Go ~70MB, FFmpeg ~70MB, Electron ~130MB, Python ~30MB) dễ bị timeout | Dùng timeout >= 180s cho các lệnh tải; nếu mạng chậm có thể dùng mirror `npmmirror.com` |
| **Không có winget/chocolatey** | Máy Windows sạch không có sẵn package manager | Dùng `Invoke-WebRequest` + tải trực tiếp từ GitHub/python.org như hướng dẫn ở trên |
| **Electron binary không tự tải** | `npm install` thành công nhưng `electron.exe` không có trong `node_modules/electron/dist/` | Làm theo hướng dẫn ở mục 5.1: tải tay hoặc dùng `ELECTRON_MIRROR` |
| **`path.txt` lỗi CRLF** | `Set-Content` mặc định thêm `\r\n` vào cuối file, gây lỗi ENOENT | Luôn dùng `-NoNewline` khi ghi file path.txt |
| **`electron-vite` lỗi "Electron uninstall"** | Xảy ra khi Electron binary không có trong dist | Cài lại Electron đúng cách (mục 5.1) |
| **Nhánh Git sai** | Sau clone, mặc định ở `main` nhưng code mới nhất ở `feat/update-capcut-token` | Chạy `git checkout feat/update-capcut-token` |
| **Quên cấu hình API key** | Ứng dụng chạy được nhưng không có AI key | Tạo file `gemini_keys.json` và điền API key thật (mục 6.1) |
| **Script PowerShell không chạy** | Policy mặc định có thể chặn script | Chạy `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` trước khi chạy script |

---

## 11. Liên hệ

- **GitHub Issues:** https://github.com/TinhSoMa/NauChaoHeo/issues
- **Tác giả:** TinhSoMa

---

*Chúc bạn cài đặt thành công!*
