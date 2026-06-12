import logging
import random
import re
import string
import time
from typing import Optional
import os
import shutil
import subprocess
import atexit
import signal
import sys

from selenium.webdriver.common.keys import Keys
from selenium.webdriver import ActionChains
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.webdriver import WebDriver as ChromeWebDriver
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as ec
from selenium.common.exceptions import SessionNotCreatedException, TimeoutException, StaleElementReferenceException

from grok3api.logger import logger

class WebDriverSingleton:
    """Singleton quản lý ChromeDriver."""
    _instance = None
    _driver: Optional[ChromeWebDriver] = None
    TIMEOUT = 30

    USE_XVFB = True
    xvfb_display: Optional[int] = None

    BASE_URL = "https://grok.com/"
    CHROME_VERSION = None
    WAS_FATAL = False
    def_proxy = "socks4://98.178.72.21:10919"

    execute_script = None
    add_cookie = None
    get_cookies = None
    get = None

    need_proxy: bool = False
    max_proxy_tries = 1
    proxy_try = 0
    proxy: Optional[str] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(WebDriverSingleton, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        self._hide_unnecessary_logs()
        self._patch_chrome_del()
        atexit.register(self.close_driver)
        self._register_signal_handlers()
        self.anonymous: bool = False
        self.profile_dir: Optional[str] = None
        self.profile_name: Optional[str] = None
        self._last_ui_response_text: Optional[str] = None
        self._last_ui_response_signature: Optional[str] = None
        self._ui_submit_locked: bool = False
        self._last_ui_error: Optional[str] = None
        self._cloudflare_detected: bool = False

    def _register_signal_handlers(self):
        """Đăng ký signal để thoát sạch trên Windows/Unix."""
        try:
            signal.signal(signal.SIGINT, self._signal_handler)
            if hasattr(signal, "SIGTERM"):
                signal.signal(signal.SIGTERM, self._signal_handler)
            if hasattr(signal, "SIGBREAK"):
                signal.signal(signal.SIGBREAK, self._signal_handler)
        except Exception as e:
            logger.debug(f"Không thể đăng ký signal handler: {e}")

    def _should_preserve_cookies(self) -> bool:
        if self.anonymous:
            return False
        value = os.getenv("GROK_PRESERVE_COOKIES", "1").strip().lower()
        return value not in {"0", "false", "no", "off"}

    def _resolve_profile_dir(self) -> str:
        override = os.getenv("GROK_CHROME_PROFILE_DIR")
        if override:
            return override
        return os.path.join(os.getcwd(), ".grok3api_profile")

    def _apply_profile_options(self, chrome_options: Options) -> tuple[str, str]:
        profile_dir = self._resolve_profile_dir()
        os.makedirs(profile_dir, exist_ok=True)
        profile_name = os.getenv("GROK_CHROME_PROFILE_NAME", "Default")
        chrome_options.add_argument(f"--user-data-dir={profile_dir}")
        if profile_name:
            chrome_options.add_argument(f"--profile-directory={profile_name}")
        logger.info(f"Sử dụng Chrome profile: {profile_dir} ({profile_name})")
        return profile_dir, profile_name

    def _resolve_system_profile_dir(self) -> Optional[str]:
        if sys.platform.startswith("win"):
            local_app = os.getenv("LOCALAPPDATA")
            if local_app:
                return os.path.join(local_app, "Google", "Chrome", "User Data")
            home = os.path.expanduser("~")
            return os.path.join(home, "AppData", "Local", "Google", "Chrome", "User Data")
        if sys.platform == "darwin":
            home = os.path.expanduser("~")
            return os.path.join(home, "Library", "Application Support", "Google", "Chrome")
        home = os.path.expanduser("~")
        return os.path.join(home, ".config", "google-chrome")

    def _has_profile_dirs(self, path: str) -> bool:
        if not path or not os.path.isdir(path):
            return False
        try:
            for entry in os.scandir(path):
                if entry.is_dir() and (entry.name == "Default" or entry.name.startswith("Profile ") or entry.name.startswith("Guest Profile")):
                    return True
        except Exception:
            return False
        return False

    def _profile_sort_key(self, name: str) -> tuple:
        if name == "Default":
            return (0, 0, name)
        match = re.match(r"Profile (\d+)", name)
        if match:
            return (1, int(match.group(1)), name)
        if name.startswith("Guest Profile"):
            return (2, 0, name)
        return (3, 0, name)

    def _validate_profile_name(self, name: str) -> str:
        if name is None:
            raise ValueError("Profile name không được để trống")
        cleaned = name.strip()
        if not cleaned:
            raise ValueError("Profile name không được để trống")
        if cleaned in {".", ".."}:
            raise ValueError("Profile name không hợp lệ")
        invalid_chars = set('\\/:*?"<>|')
        if any(ch in invalid_chars for ch in cleaned):
            raise ValueError("Profile name chứa ký tự không hợp lệ: \\ / : * ? \" < > |")
        return cleaned

    def _next_profile_name(self, profiles: list[str]) -> str:
        max_index = 0
        for name in profiles:
            match = re.match(r"Profile (\d+)", name)
            if match:
                try:
                    idx = int(match.group(1))
                    if idx > max_index:
                        max_index = idx
                except Exception:
                    continue
        return f"Profile {max_index + 1}"

    def list_profiles(self, profile_dir: Optional[str] = None) -> tuple[str, list[str]]:
        target_dir = profile_dir or os.getenv("GROK_CHROME_PROFILE_DIR")
        if not target_dir:
            default_dir = os.path.join(os.getcwd(), ".grok3api_profile")
            system_dir = self._resolve_system_profile_dir()
            if self._has_profile_dirs(default_dir):
                target_dir = default_dir
            elif system_dir and self._has_profile_dirs(system_dir):
                target_dir = system_dir
            elif os.path.isdir(default_dir):
                target_dir = default_dir
            else:
                target_dir = system_dir or default_dir

        profiles: list[str] = []
        if target_dir and os.path.isdir(target_dir):
            try:
                for entry in os.scandir(target_dir):
                    if not entry.is_dir():
                        continue
                    name = entry.name
                    if name == "Default" or name.startswith("Profile ") or name.startswith("Guest Profile"):
                        profiles.append(name)
            except Exception as e:
                logger.warning(f"Không thể đọc danh sách profile từ {target_dir}: {e}")
        profiles = sorted(list(set(profiles)), key=self._profile_sort_key)
        return target_dir, profiles

    def create_profile(self,
                       profile_name: Optional[str] = None,
                       profile_dir: Optional[str] = None,
                       allow_existing: bool = True) -> tuple[str, str]:
        target_dir = profile_dir or self._resolve_profile_dir()
        os.makedirs(target_dir, exist_ok=True)

        if profile_name is None:
            _, existing = self.list_profiles(target_dir)
            profile_name = self._next_profile_name(existing)

        profile_name = self._validate_profile_name(profile_name)
        profile_path = os.path.join(target_dir, profile_name)

        if os.path.isdir(profile_path):
            if allow_existing:
                return target_dir, profile_name
            raise FileExistsError(f"Profile '{profile_name}' đã tồn tại trong {target_dir}")

        os.makedirs(profile_path, exist_ok=True)
        return target_dir, profile_name

    def _hide_unnecessary_logs(self):
        """Ẩn các log không cần thiết."""
        try:
            uc_logger = logging.getLogger("undetected_chromedriver")
            for handler in uc_logger.handlers[:]:
                uc_logger.removeHandler(handler)
            uc_logger.setLevel(logging.CRITICAL)

            selenium_logger = logging.getLogger("selenium")
            for handler in selenium_logger.handlers[:]:
                selenium_logger.removeHandler(handler)
            selenium_logger.setLevel(logging.CRITICAL)

            urllib3_con_logger = logging.getLogger("urllib3.connectionpool")
            for handler in urllib3_con_logger.handlers[:]:
                urllib3_con_logger.removeHandler(handler)
            urllib3_con_logger.setLevel(logging.CRITICAL)


            logging.getLogger("selenium.webdriver").setLevel(logging.CRITICAL)
            logging.getLogger("selenium.webdriver.remote.remote_connection").setLevel(logging.CRITICAL)
        except KeyboardInterrupt:
            raise
        except Exception as e:
            logging.debug(f"Lỗi khi ẩn log (_hide_unnecessary_logs): {e}")

    def _patch_chrome_del(self):
        """Vá phương thức __del__ cho uc.Chrome."""
        def safe_del(self):
            try:
                try:
                    if hasattr(self, 'service') and self.service.process:
                        self.service.process.kill()
                        logger.debug("Tiến trình dịch vụ ChromeDriver đã được kết thúc.")
                except Exception as e:
                    logger.debug(f"Lỗi khi kết thúc tiến trình dịch vụ: {e}")
                try:
                    self.quit()
                    logger.debug("ChromeDriver đã được đóng qua quit().")
                except Exception as e:
                    logger.debug(f"uc.Chrome.__del__: khi gọi quit(): {e}")
            except Exception as e:
                logger.error(f"uc.Chrome.__del__: {e}")
        try:
            uc.Chrome.__del__ = safe_del
        except:
            pass

    def _is_driver_alive(self, driver):
        """Kiểm tra driver còn hoạt động không."""
        try:
            driver.title
            return True
        except:
            return False

    def _setup_driver(self, driver, wait_loading: bool, timeout: int):
        """Thiết lập driver: thu nhỏ, tải URL gốc và chờ ô nhập."""
        self._minimize()

        driver.get(self.BASE_URL)
        patch_fetch_for_statsig(driver)
        if self.check_cloudflare():
            logger.warning("Phát hiện Cloudflare challenge. Hãy hoàn tất trong trình duyệt.")
            if os.getenv("GROK_WAIT_CLOUDFLARE", "0").strip().lower() in {"1", "true", "yes", "on"}:
                self.wait_for_cloudflare_clear(timeout=min(self.TIMEOUT, 120))

        page = driver.page_source
        if not page is None and isinstance(page, str) and 'This service is not available in your region' in page:
            if self.proxy_try > self.max_proxy_tries:
                raise ValueError("Không thể vượt qua chặn theo vùng")

            self.need_proxy = True
            self.close_driver()
            self.init_driver(wait_loading=wait_loading, proxy=self.def_proxy)
            self.proxy_try += 1


        if wait_loading:
            logger.debug("Đang chờ tải trang với implicit wait...")
            try:
                WebDriverWait(driver, timeout).until(
                    ec.any_of(
                        ec.presence_of_element_located((By.XPATH, "//div[contains(@class, 'relative')]//textarea")),
                        ec.presence_of_element_located((By.CSS_SELECTOR, "div[contenteditable='true']"))
                    )
                )
                time.sleep(2)
                # statsig_id = driver.execute_script("""
                #     for (let key in localStorage) {
                #         if (key.startsWith('statsig.stable_id')) {
                #             return localStorage.getItem(key);
                #         }
                #     }
                #     return null;
                # """)
                # print(f"statsig.stable_id: {statsig_id}")
                self.proxy_try = 0
                logger.debug("Đã tìm thấy ô nhập.")
            except Exception:
                logger.debug("Không tìm thấy ô nhập")

    def wait_for_page_ready(self, timeout: Optional[int] = None) -> bool:
        """Chờ trang load xong và input sẵn sàng trước khi gửi."""
        if not self._driver:
            logger.warning("Browser not ready: driver chưa khởi tạo.")
            return False
        wait_time = timeout if timeout is not None else min(self.TIMEOUT, 30)
        try:
            def _ready(drv):
                try:
                    state = drv.execute_script("return document.readyState")
                    if state != "complete":
                        return False
                    return drv.execute_script("""
                        return !!(
                            document.querySelector("textarea[aria-label='Ask Grok anything']") ||
                            document.querySelector("textarea[placeholder='What do you want to know?']") ||
                            document.querySelector("div.relative textarea") ||
                            document.querySelector("div.tiptap.ProseMirror[contenteditable='true']") ||
                            document.querySelector("div[contenteditable='true']")
                        );
                    """)
                except Exception:
                    return False

            WebDriverWait(self._driver, wait_time).until(_ready)
            return True
        except Exception:
            logger.warning("Browser not ready (page load timeout).")
            return False

    def init_driver(self, wait_loading: bool = True, use_xvfb: bool = True, timeout: Optional[int] = None, proxy: Optional[str] = None, anonymous: bool = False):
        """Khởi chạy ChromeDriver và kiểm tra/thiết lập URL gốc với tối đa ba lần thử."""
        logger.info("Khởi tạo ChromeDriver...")
        driver_timeout = timeout if timeout is not None else self.TIMEOUT
        self.TIMEOUT = driver_timeout
        self.anonymous = anonymous
        if proxy is None:
            if self.need_proxy:
                proxy = self.def_proxy
        else:
            self.proxy = proxy

        self.USE_XVFB = use_xvfb
        attempts = 0
        max_attempts = 3

        def _create_driver():
            chrome_options = Options()
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-blink-features=AutomationControlled")
            chrome_options.add_argument("--disable-gpu")
            chrome_options.add_argument("--disable-dev-shm-usage")
            #chrome_options.add_argument("--auto-open-devtools-for-tabs")
            profile_dir = None
            profile_name = None
            if anonymous:
                chrome_options.add_argument("--incognito")
            else:
                profile_dir, profile_name = self._apply_profile_options(chrome_options)

            caps = DesiredCapabilities.CHROME
            caps['goog:loggingPrefs'] = {'browser': 'ALL'}

            if proxy:
                logger.debug(f"Thêm proxy vào tùy chọn: {proxy}")
                chrome_options.add_argument(f"--proxy-server={proxy}")

            kwargs = dict(
                options=chrome_options,
                headless=False,
                use_subprocess=True,
                version_main=self.CHROME_VERSION,
                desired_capabilities=caps,
            )
            if profile_dir:
                kwargs["user_data_dir"] = profile_dir
            new_driver = uc.Chrome(**kwargs)
            new_driver.set_script_timeout(driver_timeout)
            if anonymous:
                logger.info("Chrome đã khởi chạy (incognito=on)")
            else:
                logger.info(f"Chrome đã khởi chạy (incognito=off, profile={profile_name})")
            self.profile_dir = profile_dir
            self.profile_name = profile_name
            return new_driver

        while attempts < max_attempts:
            try:
                if self.USE_XVFB:
                    self._safe_start_xvfb()

                if self._driver and self._is_driver_alive(self._driver):
                    if self.anonymous != anonymous:
                        logger.info("Chế độ ẩn danh thay đổi, khởi tạo lại ChromeDriver...")
                        self.close_driver()
                        self._driver = _create_driver()
                        self._setup_driver(self._driver, wait_loading, driver_timeout)
                        self.WAS_FATAL = False

                        self.execute_script = self._driver.execute_script
                        self.add_cookie = self._driver.add_cookie
                        self.get_cookies = self._driver.get_cookies
                        self.get = self._driver.get
                        return
                    self._minimize()
                    if anonymous:
                        logger.info("Dùng lại ChromeDriver đang chạy (ẩn danh).")
                    else:
                        logger.info("Dùng lại ChromeDriver đang chạy (không ẩn danh).")
                        if not self.profile_name:
                            self.profile_name = os.getenv("GROK_CHROME_PROFILE_NAME", "Default")
                        if not self.profile_dir:
                            self.profile_dir = self._resolve_profile_dir()
                    current_url = self._driver.current_url
                    if current_url != self.BASE_URL:
                        logger.debug(f"URL hiện tại ({current_url}) không khớp URL gốc ({self.BASE_URL}), đang chuyển...")
                        self._driver.get(self.BASE_URL)
                        if wait_loading:
                            logger.debug("Đang chờ tải trang với implicit wait...")
                            try:
                                WebDriverWait(self._driver, driver_timeout).until(
                                    ec.any_of(
                                        ec.presence_of_element_located((By.XPATH, "//div[contains(@class, 'relative')]//textarea")),
                                        ec.presence_of_element_located((By.CSS_SELECTOR, "div[contenteditable='true']"))
                                    )
                                )
                                time.sleep(2)
                                wait_loading = False
                                logger.debug("Đã tìm thấy ô nhập.")
                            except Exception:
                                logger.error("Không tìm thấy ô nhập.")
                    self.WAS_FATAL = False
                    logger.debug("Driver còn hoạt động, mọi thứ ổn.")

                    self.execute_script = self._driver.execute_script
                    self.add_cookie = self._driver.add_cookie
                    self.get_cookies = self._driver.get_cookies
                    self.get = self._driver.get

                    return

                logger.debug(f"Thử lần {attempts + 1}: tạo driver mới...")

                self.close_driver()
                self._driver = _create_driver()
                self._setup_driver(self._driver, wait_loading, driver_timeout)
                self.WAS_FATAL = False

                logger.debug("Trình duyệt đã khởi chạy")

                self.execute_script = self._driver.execute_script
                self.add_cookie = self._driver.add_cookie
                self.get_cookies = self._driver.get_cookies
                self.get = self._driver.get

                return

            except SessionNotCreatedException as e:
                self.close_driver()
                error_message = str(e)
                match = re.search(r"Current browser version is (\d+)", error_message)
                if match:
                    current_version = int(match.group(1))
                else:
                    current_version = self._get_chrome_version()
                self.CHROME_VERSION = current_version
                logger.debug(f"Không tương thích giữa trình duyệt và driver, thử cài lại driver cho Chrome {self.CHROME_VERSION}...")
                self._driver = _create_driver()
                self._setup_driver(self._driver, wait_loading, driver_timeout)
                logger.debug(f"Đã thiết lập phiên bản driver thành {self.CHROME_VERSION}.")
                self.WAS_FATAL = False

                self.execute_script = self._driver.execute_script
                self.add_cookie = self._driver.add_cookie
                return

            except Exception as e:
                logger.error(f"Lỗi ở lần thử {attempts + 1}: {e}")
                attempts += 1
                self.close_driver()
                if attempts == max_attempts:
                    logger.fatal(f"Tất cả {max_attempts} lần thử đều thất bại: {e}")
                    self.WAS_FATAL = True
                    raise e
                logger.debug("Chờ 1 giây trước lần thử tiếp theo...")
                time.sleep(1)


    def restart_session(self):
        """Khởi động lại phiên, xóa cookies, localStorage, sessionStorage và tải lại trang."""
        try:
            if not self._should_preserve_cookies():
                self._driver.delete_all_cookies()
                self._driver.execute_script("localStorage.clear();")
                self._driver.execute_script("sessionStorage.clear();")
            self._driver.get(self.BASE_URL)
            patch_fetch_for_statsig(self._driver)
            WebDriverWait(self._driver, self.TIMEOUT).until(
                ec.any_of(
                    ec.presence_of_element_located((By.XPATH, "//div[contains(@class, 'relative')]//textarea")),
                    ec.presence_of_element_located((By.CSS_SELECTOR, "div[contenteditable='true']"))
                )
            )
            time.sleep(2)
            logger.debug("Trang đã tải, phiên đã được làm mới.")
        except Exception as e:
            logger.debug(f"Lỗi khi khởi động lại phiên: {e}")

    def set_cookies(self, cookies_input):
        """Thiết lập cookies trong driver."""
        if cookies_input is None:
            return
        current_url = self._driver.current_url
        if not current_url.startswith("http"):
            raise Exception("Trước khi đặt cookie, cần mở trang web trong driver!")

        if isinstance(cookies_input, str):
            cookie_string = cookies_input.strip().rstrip(";")
            cookies = cookie_string.split("; ")
            for cookie in cookies:
                if "=" not in cookie:
                    continue
                name, value = cookie.split("=", 1)
                self._driver.add_cookie({
                    "name": name,
                    "value": value,
                    "path": "/"
                })
        elif isinstance(cookies_input, dict):
            if "name" in cookies_input and "value" in cookies_input:
                cookie = cookies_input.copy()
                cookie.setdefault("path", "/")
                self._driver.add_cookie(cookie)
            else:
                for name, value in cookies_input.items():
                    self._driver.add_cookie({
                        "name": name,
                        "value": value,
                        "path": "/"
                    })
        elif isinstance(cookies_input, list):
            for cookie in cookies_input:
                if isinstance(cookie, dict) and "name" in cookie and "value" in cookie:
                    cookie = cookie.copy()
                    cookie.setdefault("path", "/")
                    self._driver.add_cookie(cookie)
                else:
                    raise ValueError("Mỗi dict trong danh sách phải có 'name' và 'value'")
        else:
            raise TypeError("cookies_input phải là chuỗi, dict hoặc danh sách dict")

    def close_driver(self):
        """Đóng driver."""
        if self._driver:
            self._driver.quit()
            logger.debug("Trình duyệt đã đóng.")
        self._driver = None

    def set_proxy(self, proxy: str):
        """Đổi proxy cho phiên driver hiện tại."""
        self.close_driver()
        self.init_driver(use_xvfb=self.USE_XVFB, timeout=self.TIMEOUT, proxy=proxy, anonymous=self.anonymous)

    def _minimize(self):
        """Thu nhỏ cửa sổ trình duyệt."""
        try:
            self._driver.minimize_window()
        except Exception:
            pass

    def _safe_start_xvfb(self):
        """Khởi chạy Xvfb trên DISPLAY riêng và lưu vào biến môi trường."""
        if not sys.platform.startswith("linux"):
            return

        if shutil.which("Xvfb") is None:
            logger.error("Xvfb chưa được cài! Cài bằng lệnh: sudo apt install xvfb")
            raise RuntimeError("Thiếu Xvfb")

        if self.xvfb_display is None:
            display_number = 99
            while True:
                result = subprocess.run(["pgrep", "-f", f"Xvfb :{display_number}"], capture_output=True, text=True)
                if not result.stdout.strip():
                    break
                display_number += 1
            self.xvfb_display = display_number

        display_var = f":{self.xvfb_display}"
        os.environ["DISPLAY"] = display_var

        result = subprocess.run(["pgrep", "-f", f"Xvfb {display_var}"], capture_output=True, text=True)
        if result.stdout.strip():
            logger.debug(f"Xvfb đã chạy trên display {display_var}.")
            return

        logger.debug(f"Đang khởi chạy Xvfb trên display {display_var}...")
        subprocess.Popen(["Xvfb", display_var, "-screen", "0", "1024x768x24"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        for _ in range(10):
            time.sleep(1)
            result = subprocess.run(["pgrep", "-f", f"Xvfb {display_var}"], capture_output=True, text=True)
            if result.stdout.strip():
                logger.debug(f"Xvfb đã khởi chạy thành công trên display {display_var}.")
                return

        raise RuntimeError(f"Xvfb không khởi chạy trên display {display_var} trong 10 giây!")

    def _get_chrome_version(self):
        """Xác định phiên bản Chrome hiện tại."""
        if "win" in sys.platform.lower():
            try:
                import winreg
                reg_path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, reg_path) as key:
                    chrome_path, _ = winreg.QueryValueEx(key, "")

                output = subprocess.check_output([chrome_path, "--version"], shell=True, text=True).strip()
                version = re.search(r"(\d+)\.", output).group(1)
                return int(version)
            except Exception as e:
                logger.debug(f"Không thể lấy phiên bản Chrome từ registry: {e}")

            chrome_paths = [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            ]

            for path in chrome_paths:
                if os.path.exists(path):
                    try:
                        output = subprocess.check_output([path, "--version"], shell=True, text=True).strip()
                        version = re.search(r"(\d+)\.", output).group(1)
                        return int(version)
                    except Exception as e:
                        logger.debug(f"Lỗi khi lấy phiên bản Chrome từ đường dẫn {path}: {e}")
                        continue

            logger.error("Không tìm thấy Chrome hoặc phiên bản Chrome trên Windows.")
            return None
        else:
            cmd = r'google-chrome --version'
            try:
                output = subprocess.check_output(cmd, shell=True, text=True).strip()
                version = re.search(r"(\d+)\.", output).group(1)
                return int(version)
            except Exception as e:
                logger.error(f"Lỗi khi lấy phiên bản Chrome: {e}")
                return None

    def _signal_handler(self, sig, frame):
        """Xử lý tín hiệu để kết thúc đúng cách."""
        try:
            logger.debug("Đang dừng...")
            self.close_driver()
        finally:
            # Thoát cưỡng bức để tránh kẹt do thread nền của selenium/uc
            os._exit(0)

    def _mask_statsig(self, statsig_id: Optional[str]) -> str:
        if not statsig_id:
            return "None"
        if len(statsig_id) <= 10:
            return statsig_id
        return f"{statsig_id[:6]}...{statsig_id[-4:]}"

    def refresh_statsig_via_ui(self, timeout: Optional[int] = None) -> Optional[str]:
        """Làm mới x-statsig-id bằng UI (gửi 1 ký tự ẩn)."""
        try:
            old_id = self._driver.execute_script("return window.__xStatsigId;")
            logger.info(f"Refresh statsig qua UI (cũ={self._mask_statsig(old_id)})")
            self._initiate_answer(refresh_statsig_only=True)
            wait_time = timeout if timeout is not None else min(self.TIMEOUT, 15)
            end_at = time.time() + wait_time
            while time.time() < end_at:
                new_id = self._driver.execute_script("return window.__xStatsigId;")
                if new_id and new_id != old_id:
                    logger.info(f"Đã refresh statsig qua UI (mới={self._mask_statsig(new_id)})")
                    return new_id
                time.sleep(0.3)
            logger.warning("Refresh statsig qua UI nhưng không thấy id mới")
            return None
        except Exception as e:
            logger.error(f"Lỗi khi refresh statsig qua UI: {e}")
            return None

    def get_statsig(self, restart_session=False, try_index = 0) -> Optional[str]:
        statsig_id: Optional[str] = None
        try:
            statsig_id = self._update_statsig(restart_session)
        except Exception as e:
            logger.error(f"Lỗi trong get_statsig: {e}")
        return statsig_id

    def _initiate_answer(self, refresh_statsig_only: bool = False):
        last_error: Optional[Exception] = None
        for _ in range(3):
            try:
                focused = self._driver.execute_script("""
                    const el = document.querySelector("div[contenteditable='true']") ||
                               document.querySelector("div.relative textarea");
                    if (!el) return false;
                    el.focus();
                    return true;
                """)
                if not focused:
                    element = WebDriverWait(self._driver, min(self.TIMEOUT, 20)).until(
                        ec.any_of(
                            ec.element_to_be_clickable((By.XPATH, "//div[contains(@class, 'relative')]//textarea")),
                            ec.element_to_be_clickable((By.CSS_SELECTOR, "div[contenteditable='true']"))
                        )
                    )
                    element.click()
                # Nếu chỉ refresh statsig, dùng ký tự hiếm và cố gắng dọn input sau khi gửi
                char_to_send = random.choice("zxqv") if refresh_statsig_only else random.choice(string.ascii_lowercase)
                ActionChains(self._driver).send_keys(char_to_send).send_keys(Keys.ENTER).perform()
                if refresh_statsig_only:
                    try:
                        # Xóa nội dung còn lại trong input (không ảnh hưởng request đã gửi)
                        self._driver.execute_script("""
                            const el = document.querySelector("div[contenteditable='true']") ||
                                       document.querySelector("div.relative textarea");
                            if (el) {
                                if (el.isContentEditable) { el.innerHTML = '<p></p>'; }
                                else { el.value = ''; }
                            }
                        """)
                    except Exception:
                        pass
                return
            except StaleElementReferenceException as e:
                last_error = e
                time.sleep(0.3)
                continue
            except Exception as e:
                last_error = e
                time.sleep(0.3)
        logger.error(f"Lỗi trong _initiate_answer: {last_error}")

    def send_prompt_via_ui(self, message: str) -> bool:
        """Gửi prompt bằng UI (không cần x-statsig-id)."""
        try:
            self._last_ui_error = None
            self._ui_submit_locked = False
            if not message:
                logger.warning("send_prompt_via_ui: message rỗng")
                return False
            logger.info("Gửi prompt qua UI...")
            # Ưu tiên textarea (UI mới), fallback contenteditable
            found = self._driver.execute_script("""
                const ta = document.querySelector("textarea[aria-label='Ask Grok anything']") ||
                           document.querySelector("textarea[placeholder='What do you want to know?']") ||
                           document.querySelector("div.relative textarea");
                if (ta) {
                    ta.focus();
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                    if (setter) setter.call(ta, arguments[0]);
                    else ta.value = arguments[0];
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    ta.dispatchEvent(new Event('change', { bubbles: true }));
                    return "textarea";
                }
                const el = document.querySelector("div.tiptap.ProseMirror[contenteditable='true']") ||
                           document.querySelector("div[contenteditable='true']");
                if (!el) return null;
                el.focus();
                el.innerHTML = '<p>' + arguments[0] + '</p>';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return "contenteditable";
            """, message)

            if not found:
                # Thử click element nếu chưa focus được
                element = WebDriverWait(self._driver, min(self.TIMEOUT, 20)).until(
                    ec.any_of(
                        ec.element_to_be_clickable((By.CSS_SELECTOR, "div[contenteditable='true']")),
                        ec.element_to_be_clickable((By.XPATH, "//div[contains(@class, 'relative')]//textarea"))
                    )
                )
                element.click()
                self._driver.execute_script("""
                    const el = document.querySelector("div[contenteditable='true']") ||
                               document.querySelector("div.relative textarea");
                    if (!el) return null;
                    if (el.isContentEditable) {
                        el.innerHTML = '<p>' + arguments[0] + '</p>';
                    } else {
                        el.value = arguments[0];
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                """, message)

            # Sau khi nhập, chờ nút gửi bật lên rồi click
            if not self._wait_for_ui_submit_enabled(timeout=min(self.TIMEOUT, 10)):
                self._ui_submit_locked = True
                logger.warning("Nút gửi UI đang bị khóa/disabled.")
                return False
            # Ưu tiên click nút Gửi nếu có (đúng UI hiện tại)
            submit_status = self._driver.execute_script("""
                const candidates = [
                    "button[type='submit'][aria-label='Gửi']",
                    "button[type='submit'][aria-label='Send']",
                    "button[type='submit'][aria-label='Submit']",
                    "button[type='submit']"
                ];
                let hasSubmit = false;
                for (const sel of candidates) {
                    const btns = Array.from(document.querySelectorAll(sel));
                    for (const btn of btns) {
                        if (!btn) continue;
                        hasSubmit = true;
                        const ariaDisabled = btn.getAttribute("aria-disabled");
                        const disabled = btn.disabled || ariaDisabled === "true";
                        const visible = btn.offsetParent !== null;
                        if (visible && !disabled) {
                            btn.click();
                            return "clicked";
                        }
                    }
                }
                return hasSubmit ? "locked" : "no_button";
            """)
            if submit_status == "locked":
                self._ui_submit_locked = True
                logger.warning("Nút gửi UI đang bị khóa/disabled.")
                return False
            if submit_status == "no_button":
                ActionChains(self._driver).send_keys(Keys.ENTER).perform()
            logger.info("Đã gửi prompt qua UI")
            return True
        except Exception as e:
            logger.error(f"Lỗi trong send_prompt_via_ui: {e}")
            return False

    def _is_bad_ui_text(self, text: Optional[str]) -> bool:
        if not text:
            return True
        t = text.strip()
        if not t:
            return True
        if t.startswith('[{"role": "system"') or '"role":"system"' in t or '"role": "system"' in t:
            return True
        return False

    def _collect_assistant_nodes(self) -> list[dict]:
        try:
            return self._driver.execute_script("""
                const isAssistantBlock = (el) => {
                    let cur = el;
                    while (cur && cur !== document.body) {
                        if (cur.classList && cur.classList.contains('items-start')) return true;
                        if (cur.classList && cur.classList.contains('items-end')) return false;
                        cur = cur.parentElement;
                    }
                    return false;
                };
                const responseBlocks = Array.from(document.querySelectorAll('div[id^="response-"]'));
                const out = [];
                for (const block of responseBlocks) {
                    if (!block || !isAssistantBlock(block)) continue;
                    const content = block.querySelector('.response-content-markdown')
                        || block.querySelector('.message-bubble')
                        || block;
                    const text = (content && content.textContent ? content.textContent : '').trim();
                    if (!text) continue;
                    out.push({
                        text,
                        id: block.id || '',
                        testid: content && content.getAttribute ? (content.getAttribute('data-testid') || '') : '',
                    });
                }
                if (out.length) return out;

                // Fallback: some layouts render content inside response-content-markdown blocks
                const markdownNodes = Array.from(document.querySelectorAll('.response-content-markdown'));
                for (const node of markdownNodes) {
                    const parent = node.closest('div[id^="response-"]');
                    if (parent && !isAssistantBlock(parent)) continue;
                    const text = (node.textContent || '').trim();
                    if (!text) continue;
                    out.push({
                        text,
                        id: parent ? (parent.id || '') : (node.id || ''),
                        testid: node.getAttribute('data-testid') || '',
                    });
                }
                if (out.length) return out;

                const primarySelectors = [
                    '[data-message-author-role="assistant"]',
                    'div[role="assistant"]',
                    '[data-testid*="assistant"]',
                    'div.message-bubble',
                    'div.w-full.max-w-\\\\[48rem\\\\]',
                    'div.prose'
                ];
                const fallbackSelectors = [
                    'div.message-bubble p[dir="auto"]',
                    'div.w-full.max-w-\\\\[48rem\\\\] p',
                    'div.prose p'
                ];
                const collect = (selectors) => {
                    const seen = new Set();
                    const collected = [];
                    for (const sel of selectors) {
                        const nodes = Array.from(document.querySelectorAll(sel));
                        for (const n of nodes) {
                            if (!n || seen.has(n)) continue;
                            seen.add(n);
                            const text = (n.textContent || '').trim();
                            collected.push({
                                text,
                                id: n.getAttribute('data-message-id') || n.id || '',
                                testid: n.getAttribute('data-testid') || '',
                            });
                        }
                    }
                    return collected;
                };
                const primary = collect(primarySelectors);
                if (primary.length) return primary;
                return collect(fallbackSelectors);
            """)
        except Exception:
            return []

    def _get_assistant_signature(self, node: dict, index: int) -> str:
        node_id = (node.get("id") or "").strip()
        if node_id:
            return f"id:{node_id}"
        testid = (node.get("testid") or "").strip()
        if testid:
            return f"testid:{testid}"
        return f"idx:{index}"

    def _get_latest_assistant_snapshot(self) -> tuple[Optional[str], Optional[str]]:
        nodes = self._collect_assistant_nodes()
        for i in range(len(nodes) - 1, -1, -1):
            text = (nodes[i].get("text") or "").strip()
            if self._is_bad_ui_text(text):
                continue
            sig = self._get_assistant_signature(nodes[i], i)
            return sig, text
        return None, None

    def _get_assistant_text_by_signature(self, target_sig: str) -> Optional[str]:
        if target_sig.startswith("idx:"):
            try:
                idx_part = target_sig.split(":", 1)[1]
                idx_str = idx_part.split(":", 1)[0]
                idx = int(idx_str)
                nodes = self._collect_assistant_nodes()
                if 0 <= idx < len(nodes):
                    text = (nodes[idx].get("text") or "").strip()
                    return text or None
            except Exception:
                pass
        nodes = self._collect_assistant_nodes()
        for i, node in enumerate(nodes):
            sig = self._get_assistant_signature(node, i)
            if sig == target_sig:
                text = (node.get("text") or "").strip()
                return text or None
        return None

    def _get_latest_assistant_text(self) -> Optional[str]:
        sig, text = self._get_latest_assistant_snapshot()
        if sig and text:
            return text
        return None

    def get_active_profile_name(self) -> Optional[str]:
        return self.profile_name

    def get_active_profile_dir(self) -> Optional[str]:
        return self.profile_dir

    def get_active_profile_label(self) -> str:
        if self.anonymous:
            return "incognito"
        return self.profile_name or "Default"

    def get_last_ui_error(self, clear: bool = True) -> Optional[str]:
        err = self._last_ui_error
        if clear:
            self._last_ui_error = None
        return err

    def _detect_ui_error(self) -> Optional[str]:
        try:
            return self._driver.execute_script("""
                const rateLimitKeywords = [
                    "Message limit reached",
                    "Grok is under heavy usage",
                    "Please try again later",
                    "Too many requests",
                    "Rate limit",
                    "rate limit",
                    "Đã đạt giới hạn",
                    "Vui lòng thử lại",
                    "quá tải",
                    "giới hạn"
                ];
                const ignoreKeywords = [
                    "Upgrade to SuperGrok",
                    "Get SuperGrok",
                    "Vui lòng nâng cấp"
                ];
                const bodyText = document.body ? document.body.innerText : "";
                if (!bodyText) return null;
                const lines = bodyText.split("\\n").map(l => l.trim()).filter(Boolean);
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i];
                    for (const key of rateLimitKeywords) {
                        if (line.includes(key)) return line;
                    }
                }
                // Chỉ cảnh báo nâng cấp thì bỏ qua
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i];
                    for (const key of ignoreKeywords) {
                        if (line.includes(key)) return null;
                    }
                }
                return null;
            """)
        except Exception:
            return None

    def _classify_ui_error(self, message: Optional[str]) -> str:
        if not message:
            return "warning"
        if self._is_rate_limit_error(message):
            return "rate_limit"
        text = message.lower()
        if "upgrade to supergrok" in text or "upgrade" in text or "supergrok" in text:
            return "warning"
        return "warning"

    def wait_for_ui_api_response(self, timeout: Optional[int] = None) -> bool:
        wait_time = timeout if timeout is not None else min(self.TIMEOUT, 60)
        start = time.time()
        try:
            last_at = self._driver.execute_script("return window.__grokLastApiResponseAt || 0;")
            last_len = self._driver.execute_script("return (window.__grokLastApiResponseText || '').length;")
        except Exception:
            last_at = 0
            last_len = 0
        while time.time() - start < wait_time:
            try:
                current_at = self._driver.execute_script("return window.__grokLastApiResponseAt || 0;")
                current_len = self._driver.execute_script("return (window.__grokLastApiResponseText || '').length;")
                if (current_at and current_at != last_at) or (current_len and current_len != last_len):
                    return True
            except Exception:
                pass
            time.sleep(0.3)
        return False

    def get_last_ui_api_response(self, clear: bool = True) -> Optional[str]:
        try:
            text = self._driver.execute_script("return window.__grokLastApiResponseText || null;")
            if clear:
                self._driver.execute_script("""
                    window.__grokLastApiResponseText = null;
                    window.__grokLastApiResponseAt = 0;
                """)
            return text
        except Exception:
            return None

    def _is_cloudflare_text(self, text: str) -> bool:
        if not text:
            return False
        t = text.lower()
        return (
            "just a moment" in t
            or "cf-browser-verification" in t
            or "cloudflare" in t
            or "attention required" in t
            or "cf-chl" in t
        )

    def check_cloudflare(self) -> bool:
        try:
            title = self._driver.title or ""
            html = self._driver.page_source or ""
            detected = self._is_cloudflare_text(title) or self._is_cloudflare_text(html)
            self._cloudflare_detected = detected
            return detected
        except Exception:
            return False

    def is_cloudflare_detected(self) -> bool:
        return self._cloudflare_detected

    def wait_for_cloudflare_clear(self, timeout: Optional[int] = None) -> bool:
        wait_time = timeout if timeout is not None else min(self.TIMEOUT, 60)
        start = time.time()
        while time.time() - start < wait_time:
            if not self.check_cloudflare():
                logger.info("Cloudflare đã được vượt qua.")
                return True
            time.sleep(1)
        logger.warning("Cloudflare vẫn còn sau thời gian chờ.")
        return False

    def _is_rate_limit_error(self, message: Optional[str]) -> bool:
        if not message:
            return False
        text = message.lower()
        return (
            "message limit reached" in text
            or "heavy usage" in text
            or "too many requests" in text
            or "rate limit" in text
            or "đã đạt giới hạn" in text
            or "vui lòng nâng cấp" in text
            or "vui lòng thử lại" in text
            or "quá tải" in text
            or "giới hạn" in text
        )

    def _get_ui_stable_seconds(self) -> float:
        raw = os.getenv("GROK_UI_STABLE_SECONDS", "").strip()
        if not raw:
            return 1.5
        try:
            value = float(raw)
            return max(0.3, value)
        except Exception:
            return 1.5

    def _get_ui_max_wait(self, fallback: float) -> float:
        raw = os.getenv("GROK_UI_MAX_WAIT", "").strip()
        if not raw:
            return fallback
        try:
            value = float(raw)
            return max(1.0, value)
        except Exception:
            return fallback

    def _is_ui_stop_visible(self) -> bool:
        try:
            return bool(self._driver.execute_script("""
                const selectors = [
                    "button[aria-label*='Stop']",
                    "button[aria-label*='Stop generating']",
                    "button[aria-label*='Dừng']",
                    "button[aria-label*='Dừng lại']"
                ];
                for (const sel of selectors) {
                    const btn = document.querySelector(sel);
                    if (btn && btn.offsetParent !== null) return true;
                }
                return false;
            """))
        except Exception:
            return False

    def _wait_for_ui_response_complete(self, timeout: Optional[float] = None) -> Optional[str]:
        sig, text = self._get_latest_assistant_snapshot()
        if sig:
            return self._wait_for_ui_response_complete_for_signature(sig, timeout=timeout)
        if text:
            return text
        return None

    def _wait_for_ui_response_complete_for_signature(self, target_sig: str, timeout: Optional[float] = None) -> Optional[str]:
        stable_seconds = self._get_ui_stable_seconds()
        default_wait = min(self.TIMEOUT, 60)
        wait_time = timeout if timeout is not None else default_wait
        wait_time = self._get_ui_max_wait(wait_time)

        logger.info(f"UI: chờ phản hồi hoàn tất (signature={target_sig}, stable={stable_seconds}s, max_wait={wait_time}s)")

        start = time.time()
        last_text = self._get_assistant_text_by_signature(target_sig)
        last_change = time.time()

        while time.time() - start < wait_time:
            text = self._get_assistant_text_by_signature(target_sig)
            if text and text != last_text:
                last_text = text
                last_change = time.time()

            stable_duration = time.time() - last_change
            stable = stable_duration >= stable_seconds
            submit_enabled = self._is_ui_submit_enabled()
            stop_visible = self._is_ui_stop_visible()
            ui_error = self._detect_ui_error()
            if ui_error:
                kind = self._classify_ui_error(ui_error)
                if kind == "warning":
                    logger.warning(f"UI warning detected (ignored): {ui_error}")
                else:
                    # Chỉ abort nếu chưa có text cho message mục tiêu
                    if not last_text:
                        self._last_ui_error = ui_error
                        logger.warning(f"UI rate limit detected (abort): {ui_error}")
                        return None

            if last_text and stable and submit_enabled and not stop_visible:
                logger.info("UI: phản hồi đã hoàn tất")
                return last_text
            if last_text and stable and not stop_visible and stable_duration >= (stable_seconds * 2):
                logger.info("UI: phản hồi đã hoàn tất (fallback, submit vẫn disabled)")
                return last_text

            time.sleep(0.3)

        logger.warning(
            f"UI: timeout chờ hoàn tất (submit_enabled={submit_enabled}, stop_visible={stop_visible}, has_text={bool(last_text)}), trả về phản hồi hiện tại"
        )
        return last_text

    def read_latest_response_via_ui(self, timeout: Optional[int] = None) -> Optional[str]:
        """Đọc phản hồi mới nhất từ UI."""
        wait_time = timeout if timeout is not None else min(self.TIMEOUT, 60)
        wait_time = self._get_ui_max_wait(wait_time)
        start = time.time()
        prev_sig = self._last_ui_response_signature
        while time.time() - start < wait_time:
            sig, text = self._get_latest_assistant_snapshot()
            ui_error = self._detect_ui_error()
            if ui_error:
                kind = self._classify_ui_error(ui_error)
                if kind == "warning":
                    logger.warning(f"UI warning detected (ignored): {ui_error}")
                else:
                    # Nếu chưa có phản hồi mới thì abort
                    if not text:
                        self._last_ui_error = ui_error
                        logger.warning(f"UI rate limit detected (abort): {ui_error}")
                        return None
            if sig and sig != prev_sig:
                logger.info("UI: new assistant signature detected")
                final_text = self._wait_for_ui_response_complete_for_signature(sig, timeout=wait_time)
                if final_text:
                    self._last_ui_response_signature = sig
                    self._last_ui_response_text = final_text
                    logger.info("Đã đọc phản hồi qua UI")
                    return final_text
                self._last_ui_response_signature = sig
                self._last_ui_response_text = text
                logger.info("Đã đọc phản hồi qua UI")
                return text
            time.sleep(0.5)
        logger.warning("Không đọc được phản hồi qua UI trong thời gian chờ")
        return None

    def ui_ask(self, message: str, timeout: Optional[int] = None) -> Optional[str]:
        """Luồng UI-only: gửi prompt và đọc phản hồi từ DOM."""
        if not message:
            logger.warning("ui_ask: message rỗng")
            return None
        wait_time = timeout if timeout is not None else min(self.TIMEOUT, 60)
        logger.info("UI single attempt (no retry)")
        ok = self.send_prompt_via_ui(message)
        if ok:
            return self.read_latest_response_via_ui(timeout=wait_time)
        if self._is_rate_limit_error(self._last_ui_error):
            logger.warning("UI: phát hiện rate limit, không retry")
            return None
        logger.error("UI submit locked hoặc không đọc được phản hồi")
        return None

    def _is_ui_submit_enabled(self) -> bool:
        try:
            return bool(self._driver.execute_script("""
                const candidates = [
                    "button[type='submit'][aria-label='Gửi']",
                    "button[type='submit'][aria-label='Send']",
                    "button[type='submit'][aria-label='Submit']",
                    "button[type='submit']"
                ];
                for (const sel of candidates) {
                    const btns = Array.from(document.querySelectorAll(sel));
                    for (const btn of btns) {
                        if (!btn) continue;
                        const ariaDisabled = btn.getAttribute("aria-disabled");
                        const disabled = btn.disabled || ariaDisabled === "true";
                        const visible = btn.offsetParent !== null;
                        if (visible && !disabled) return true;
                    }
                }
                return false;
            """))
        except Exception:
            return False

    def _wait_for_ui_submit_enabled(self, timeout: Optional[int] = None) -> bool:
        wait_time = timeout if timeout is not None else min(self.TIMEOUT, 15)
        start = time.time()
        while time.time() - start < wait_time:
            if self._is_ui_submit_enabled():
                return True
            time.sleep(0.3)
        return False

    def ui_new_conversation(self) -> bool:
        """Tạo conversation mới bằng UI (không dùng API)."""
        try:
            logger.warning("UI new conversation: thử tạo chat mới bằng UI")
            action = self._driver.execute_script("""
                const selectors = [
                    "a[aria-label='Home page']",
                    "a[href='https://grok.com/']",
                    "a[href='/']",
                    "button[aria-label*='New']",
                    "button[aria-label*='New chat']",
                    "button[aria-label*='New conversation']"
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) { el.click(); return sel; }
                }
                window.location.href = "https://grok.com/";
                return "navigate";
            """)
            logger.info(f"UI new conversation action: {action}")
            WebDriverWait(self._driver, min(self.TIMEOUT, 20)).until(
                ec.any_of(
                    ec.presence_of_element_located((By.CSS_SELECTOR, "div[contenteditable='true']")),
                    ec.presence_of_element_located((By.XPATH, "//div[contains(@class, 'relative')]//textarea"))
                )
            )
            logger.info("UI new conversation: input ready")
            return True
        except Exception as e:
            logger.error(f"Lỗi khi UI new conversation: {e}")
            return False

    def _update_statsig(self, restart_session=False) -> Optional[str]:
        if restart_session:
            self.restart_session()
        current_url = self._driver.current_url

        if current_url != self.BASE_URL:
            logger.debug(f"URL hiện tại {current_url} không khớp BASE_URL {self.BASE_URL}. Chuyển về BASE_URL.")
            self._driver.get(self.BASE_URL)
            patch_fetch_for_statsig(self._driver)
            logger.debug(f"Đã chuyển tới {self.BASE_URL}")

        self._initiate_answer()

        try:
            is_overlay_active = self._driver.execute_script("""
                const elements = document.querySelectorAll("p");
                for (const el of elements) {
                    if (el.textContent.includes("Making sure you're human")) {
                        const style = window.getComputedStyle(el);
                        if (style.visibility !== 'hidden' && style.display !== 'none') {
                            return true;
                        }
                    }
                }
                return false;
            """)

            if is_overlay_active:
                logger.debug("Phát hiện lớp phủ captcha — chặn tiến trình.")
                return None


            WebDriverWait(self._driver, min(self.TIMEOUT, 20)).until(
                ec.any_of(
                    ec.presence_of_element_located((By.CSS_SELECTOR, "div.message-bubble p[dir='auto']")),
                    ec.presence_of_element_located((By.CSS_SELECTOR, "div.w-full.max-w-\\48rem\\]")),
                    ec.presence_of_element_located((By.XPATH, "//p[contains(text(), \"Making sure you're human...\")]"))
                )
            )

            if self._driver.find_elements(By.CSS_SELECTOR, "div.w-full.max-w-\\48rem\\]"):
                logger.debug("Lỗi xác thực")
                return None

            captcha_elements = self._driver.find_elements(By.XPATH,
                                                          "//p[contains(text(), \"Making sure you're human...\")]")
            if captcha_elements:
                logger.debug("Xuất hiện captcha 'Making sure you're human...'")
                return None

            logger.debug("Đã xuất hiện phần tử phản hồi")
            statsig_id = self._driver.execute_script("return window.__xStatsigId;")
            logger.debug(f"Đã lấy x-statsig-id: {statsig_id}")
            return statsig_id

        except TimeoutException:
            logger.debug("Không có phản hồi hay lỗi, trả về None")
            return None
        except Exception as e:
            logger.debug(f"Lỗi trong _update_statsig: {e}")
            return None

    def del_captcha(self, timeout = 5):
        try:
            captcha_wrapper = WebDriverWait(self._driver, timeout).until(
                ec.presence_of_element_located((By.CSS_SELECTOR, "div.main-wrapper"))
            )
            self._driver.execute_script("arguments[0].remove();", captcha_wrapper)
            return True
        except TimeoutException:
            return True
        except Exception as e:
            logger.debug(f"Lỗi trong del_captcha: {e}")
            return False



def patch_fetch_for_statsig(driver):
    result = driver.execute_script("""
        if (window.__fetchPatched) {
            return "fetch đã được vá";
        }

        window.__fetchPatched = false;
        const originalFetch = window.fetch;
        window.__xStatsigId = null;
        window.__grokLastApiResponseText = null;
        window.__grokLastApiResponseAt = 0;
        window.__grokLastConversationId = null;
        window.__grokLastResponseId = null;

        window.fetch = async function(...args) {
            console.log("Đã chặn fetch, tham số:", args);

            const response = await originalFetch.apply(this, args);

            try {
                const req = args[0];
                const opts = args[1] || {};
                const url = typeof req === 'string' ? req : req.url;
                const headers = opts.headers || {};
                const fullUrl = (typeof url === 'string' && url.startsWith('http'))
                    ? url
                    : new URL(url, window.location.origin).href;

                const targetUrl = "https://grok.com/rest/app-chat/conversations/new";
                const isChatApi = fullUrl.startsWith("https://grok.com/rest/app-chat/conversations/");

                if (url === targetUrl) {
                    let id = null;
                    if (headers["x-statsig-id"]) {
                        id = headers["x-statsig-id"];
                    } else if (typeof opts.headers?.get === "function") {
                        id = opts.headers.get("x-statsig-id");
                    }

                    if (id) {
                        window.__xStatsigId = id;
                        console.log("Đã lưu x-statsig-id:", id);
                    } else {
                        console.warn("Không tìm thấy x-statsig-id trong headers");
                    }
                }

                if (isChatApi) {
                    try {
                        const clone = response.clone();
                        if (clone.body && clone.body.getReader) {
                            const reader = clone.body.getReader();
                            const decoder = new TextDecoder();
                            let buffer = "";
                            const read = () => reader.read().then(({done, value}) => {
                                if (value) {
                                    buffer += decoder.decode(value, {stream: !done});
                                    window.__grokLastApiResponseText = buffer;
                                    window.__grokLastApiResponseAt = Date.now();
                                }
                                if (!done) return read();
                                return null;
                            });
                            read().catch(() => {});
                        } else {
                            clone.text().then(text => {
                                window.__grokLastApiResponseText = text;
                                window.__grokLastApiResponseAt = Date.now();
                            }).catch(() => {});
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            } catch (e) {
                console.warn("Lỗi khi trích xuất x-statsig-id:", e);
            }

            return response;
        };

        window.__fetchPatched = true;
        return "fetch đã được vá thành công";
    """)
    # print(result)
    #
    # driver.execute_script("""
    #     fetch('https://grok.com/rest/app-chat/conversations/new', {
    #         headers: {'x-statsig-id': 'test123'}
    #     });
    # """)
    #
    # import time
    # time.sleep(1)
    #
    # statsig_id = driver.execute_script("return window.__xStatsigId;")
    # print("Đã bắt x-statsig-id:", statsig_id)


web_driver = WebDriverSingleton()

def list_profiles(profile_dir: Optional[str] = None) -> tuple[str, list[str]]:
    return web_driver.list_profiles(profile_dir)

def create_profile(profile_name: Optional[str] = None,
                   profile_dir: Optional[str] = None,
                   allow_existing: bool = True) -> tuple[str, str]:
    return web_driver.create_profile(profile_name=profile_name, profile_dir=profile_dir, allow_existing=allow_existing)

def close_driver() -> None:
    return web_driver.close_driver()
