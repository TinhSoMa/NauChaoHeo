import asyncio
from io import BytesIO
from dataclasses import dataclass
from typing import Optional, List

from grok3api.logger import logger
from grok3api import driver

try:
    import aiofiles
    AIOFILES_AVAILABLE = True
except ImportError:
    AIOFILES_AVAILABLE = False

@dataclass
class GeneratedImage:
    url: str
    _base_url: str = "https://assets.grok.com"
    cookies: Optional[List[dict]] = None

    def __post_init__(self):
        """
        Sau khi khởi tạo, kiểm tra driver.DRIVER và lấy cookies cho _base_url
        nếu driver khả dụng. Nếu không thì giữ cookies là None.
        """
        if driver.web_driver is not None:
            # self.cookies = driver.web_driver.get_cookies()
            self.cookies = driver.web_driver._driver.get_cookies()
        else:
            self.cookies = None

    def download(self, timeout: int = driver.web_driver.TIMEOUT) -> Optional[BytesIO]:
        """Tải ảnh vào bộ nhớ qua trình duyệt với timeout."""
        try:
            image_data = self._fetch_image(timeout=timeout)
            if image_data is None:
                return None
            image_buffer = BytesIO(image_data)
            image_buffer.seek(0)
            return image_buffer
        except Exception as e:
            logger.error(f"Lỗi khi tải ảnh (download): {e}")
            return None

    # async def async_download(self, timeout: int = 20) -> Optional[BytesIO]:
    #     """Phương thức bất đồng bộ để tải ảnh vào bộ nhớ với timeout.
    #
    #     Args:
    #         timeout (int): Timeout theo giây (mặc định 20).
    #
    #     Returns:
    #         Optional[BytesIO]: Đối tượng BytesIO chứa dữ liệu ảnh hoặc None khi lỗi.
    #     """
    #     try:
    #         image_data = await asyncio.to_thread(self._fetch_image, timeout=timeout, proxy=driver.web_driver.def_proxy)
    #         if image_data is None:
    #             return None
    #         image_buffer = BytesIO(image_data)
    #         image_buffer.seek(0)
    #         return image_buffer
    #     except Exception as e:
    #         logger.error(f"Lỗi khi tải ảnh (download): {e}")
    #         return None
    #
    # async def async_save_to(self, path: str, timeout: int = 10) -> None:
    #     """Tải ảnh bất đồng bộ và lưu vào tệp với timeout.
    #
    #     Args:
    #         path (str): Đường dẫn lưu tệp.
    #         timeout (int): Timeout theo giây (mặc định 10).
    #     """
    #     try:
    #         logger.debug(f"Thử lưu ảnh vào tệp: {path}")
    #         image_data = await asyncio.to_thread(self._fetch_image, timeout=timeout, proxy=driver.web_driver.def_proxy)
    #         image_data = BytesIO(image_data)
    #         if image_data is not None:
    #             if AIOFILES_AVAILABLE:
    #                 async with aiofiles.open(path, "wb") as f:
    #                     await f.write(image_data.getbuffer())
    #             else:
    #                 def write_file_sync(file_path: str, data: BytesIO):
    #                     with open(file_path, "wb") as file:
    #                         file.write(data.getbuffer())
    #
    #                 await asyncio.to_thread(write_file_sync, path, image_data)
    #             logger.debug(f"Ảnh đã được lưu thành công tại: {path}")
    #         else:
    #             logger.error("Ảnh chưa được tải, hủy lưu.")
    #     except Exception as e:
    #         logger.error(f"Lỗi trong save_to: {e}")

    def download_to(self, path: str, timeout: int = driver.web_driver.TIMEOUT) -> None:
        """Tải ảnh về tệp qua trình duyệt với timeout."""
        try:
            image_data = self._fetch_image(timeout=timeout)
            if image_data is not None:
                with open(path, "wb") as f:
                    f.write(image_data)
                logger.debug(f"Ảnh đã được lưu tại: {path}")
            else:
                logger.debug("Ảnh chưa được tải, hủy lưu.")
        except Exception as e:
            logger.error(f"Lỗi khi tải vào tệp: {e}")

    def save_to(self, path: str, timeout: int = driver.web_driver.TIMEOUT) -> bool:
        """Tải ảnh bằng download() và lưu vào tệp với timeout."""
        try:
            logger.debug(f"Thử lưu ảnh vào tệp: {path}")
            image_data = self.download(timeout=timeout)
            if image_data is not None:
                with open(path, "wb") as f:
                    f.write(image_data.getbuffer())
                logger.debug(f"Ảnh đã được lưu thành công tại: {path}")
                return True
            else:
                logger.debug("Ảnh chưa được tải, hủy lưu.")
                return False
        except Exception as e:
            logger.error(f"Lỗi trong save_to: {e}")
            return False

    def _fetch_image(self, timeout: int = driver.web_driver.TIMEOUT, proxy: Optional[str] = driver.web_driver.def_proxy) -> Optional[bytes]:
        """Hàm riêng để tải ảnh qua trình duyệt với timeout."""
        if not self.cookies or len(self.cookies) == 0:
            logger.debug("Không có cookies để tải ảnh.")
            return None

        image_url = self.url if self.url.startswith('/') else '/' + self.url
        full_url = self._base_url + image_url
        logger.debug(f"URL đầy đủ để tải ảnh: {full_url}, timeout: {timeout} giây")

        fetch_script = f"""
        console.log("Bắt đầu fetch với credentials: 'include'");
        console.log("Cookies trong trình duyệt trước fetch:", document.cookie);

        const request = fetch('{full_url}', {{
            method: 'GET'
        }})
        .then(response => {{
            console.log("Trạng thái phản hồi:", response.status);
            console.log("Header phản hồi:", Array.from(response.headers.entries()));
            const contentType = response.headers.get('Content-Type');
            if (!response.ok) {{
                console.log("Yêu cầu thất bại với status:", response.status);
                return 'Error: HTTP ' + response.status;
            }}
            if (!contentType || !contentType.startsWith('image/')) {{
                return response.text().then(text => {{
                    console.log("Phát hiện MIME type không hợp lệ:", contentType);
                    console.log("Nội dung phản hồi:", text);
                    return 'Error: Invalid MIME type: ' + contentType + ', content: ' + text;
                }});
            }}
            return response.arrayBuffer();
        }})
        .then(buffer => {{
            console.log("Đã nhận dữ liệu ảnh, độ dài:", buffer.byteLength);
            return Array.from(new Uint8Array(buffer));
        }})
        .catch(error => {{
            console.log("Lỗi fetch:", error.toString());
            return 'Error: ' + error;
        }});

        console.log("Đã gửi yêu cầu fetch, đang chờ phản hồi...");
        return request;
        """
        driver.web_driver.init_driver(wait_loading=False)
        try:
            try:
                for cookie in self.cookies:
                    if 'name' in cookie and 'value' in cookie:
                        if 'domain' not in cookie or not cookie['domain']:
                            cookie['domain'] = '.grok.com'
                        driver.web_driver.add_cookie(cookie)
                    else:
                        logger.warning(f"Bỏ qua cookie không hợp lệ: {cookie}")
                logger.debug(f"Đã đặt cookies: {self.cookies}")
            except Exception as e:
                logger.error(f"Lỗi khi đặt cookies: {e}")
                return None

            driver.web_driver.get(full_url)
            response = driver.web_driver.execute_script(fetch_script)
            if response and 'This service is not available in your region' in response:
                driver.web_driver.set_proxy(proxy)
                driver.web_driver.get(full_url)
                response = driver.web_driver.execute_script(fetch_script)
            driver.web_driver.get(driver.web_driver.BASE_URL)
        except Exception as e:
            logger.error(f"Lỗi khi chạy script trong trình duyệt: {e}")
            return None

        if isinstance(response, str) and response.startswith('Error:'):
            logger.error(f"Lỗi khi tải ảnh: {response}")
            return None

        image_data = bytes(response)
        logger.debug("Ảnh đã được tải thành công qua trình duyệt.")
        return image_data
