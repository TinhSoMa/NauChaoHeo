import contextvars
import functools
import os
import random
import time
from asyncio import events
from typing import Optional, List, Union, Dict, Any, Tuple
import base64
import json
from io import BytesIO

from grok3api.history import History, SenderType
from grok3api import driver
from grok3api.logger import logger
from grok3api.types.GrokResponse import GrokResponse



class GrokClient:
    """
    Client để làm việc với Grok.

    :param use_xvfb: Cờ bật Xvfb. Mặc định True. Chỉ áp dụng trên Linux.
    :param proxy: (str) URL proxy, chỉ dùng khi bị chặn theo khu vực.
    :param history_msg_count: Số tin nhắn lưu lịch sử (mặc định `0` — tắt lưu lịch sử).
    :param history_path: Đường dẫn tệp lịch sử dạng JSON. Mặc định "chat_histories.json".
    :param history_as_json: Có gửi lịch sử cho Grok dạng JSON hay không (khi history_msg_count > 0). Mặc định True.
    :param history_auto_save: Tự động ghi đè tệp lịch sử sau mỗi tin nhắn. Mặc định True.
    :param always_new_conversation: (bool) Có dùng URL tạo hội thoại mới khi gửi yêu cầu cho Grok. Mặc định False.
    :param conversation_id: (str) ID chat Grok. Dùng để tiếp tục hội thoại đã có. Phải dùng kèm response_id.
    :param response_id: (str) ID phản hồi Grok trong chat conversation_id. Dùng để tiếp tục hội thoại đã có. Phải dùng kèm conversation_id.
    :param timeout: Thời gian tối đa khởi tạo client. Mặc định 120 giây.
    """

    NEW_CHAT_URL = "https://grok.com/rest/app-chat/conversations/new"
    CONVERSATION_URL = "https://grok.com/rest/app-chat/conversations/" # + {conversationId}/responses/
    max_tries: int = 1

    def __init__(self,
                 cookies: Union[Union[str, List[str]], Union[dict, List[dict]]] = None,
                 use_xvfb: bool = True,
                 proxy: Optional[str] = None,
                 history_msg_count: int = 0,
                 history_path: str = "chat_histories.json",
                 history_as_json: bool = True,
                 history_auto_save: bool = True,
                 always_new_conversation: bool = False,
                 conversation_id: Optional[str] = None,
                 response_id: Optional[str] = None,
                 enable_artifact_files: bool = False,
                 main_system_prompt: Optional[str] = None,
                 timeout: int = driver.web_driver.TIMEOUT,
                 anonymous: bool = False,
                 ui: bool = False,
                 ui_response: str = "ui"):
        try:
            logger.info("Khởi tạo GrokClient...")
            if (conversation_id is None) != (response_id is None):
                raise ValueError(
                    "Nếu muốn dùng lịch sử trên server, bạn phải cung cấp cả conversation_id và response_id.")

            self.cookies = cookies
            self.proxy = proxy
            self.use_xvfb: bool = use_xvfb
            self.anonymous: bool = anonymous
            self.ui: bool = ui
            self.ui_response: str = ui_response
            self.history = History(history_msg_count=history_msg_count,
                                   history_path=history_path,
                                   history_as_json=history_as_json,
                                   main_system_prompt=main_system_prompt)
            self.history_auto_save: bool = history_auto_save
            self.proxy_index = 0
            self.enable_artifact_files = enable_artifact_files
            self.timeout: int = timeout

            self.always_new_conversation: bool = always_new_conversation
            self.conversationId: Optional[str] = conversation_id
            self.parentResponseId: Optional[str] = response_id
            self._statsig_id: Optional[str] = None

            driver.web_driver.init_driver(use_xvfb=self.use_xvfb, timeout=timeout, proxy=self.proxy, anonymous=self.anonymous)

            if not self.ui:
                self._statsig_id = driver.web_driver.get_statsig()
        except Exception as e:
            logger.error(f"Lỗi trong GrokClient.__init__: {e}")
            raise e

    def close(self) -> None:
        """Đóng ChromeDriver của client hiện tại."""
        driver.web_driver.close_driver()

    def _send_request(self,
                      payload,
                      headers,
                      timeout=driver.web_driver.TIMEOUT):
        try:
            """Gửi yêu cầu qua trình duyệt với timeout."""


            if not self._statsig_id:
                self._statsig_id = driver.web_driver.get_statsig()

            headers.update({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language": "ru-RU,ru;q=0.9",
                "Content-Type": "application/json",
                "Origin": "https://grok.com",
                "Referer": "https://grok.com/",
                "Sec-Ch-Ua": '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"',
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "x-statsig-id": self._statsig_id,
            })

            target_url = self.CONVERSATION_URL + self.conversationId + "/responses" if self.conversationId else self.NEW_CHAT_URL

            fetch_script = f"""
            const controller = new AbortController();
            const signal = controller.signal;
            setTimeout(() => controller.abort(), {timeout * 1000});

            const payload = {json.dumps(payload)};
            return fetch('{target_url}', {{
                method: 'POST',
                headers: {json.dumps(headers)},
                body: JSON.stringify(payload),
                credentials: 'include',
                signal: signal
            }})
            .then(response => {{
                if (!response.ok) {{
                    return response.text().then(text => 'Error: HTTP ' + response.status + ' - ' + text);
                }}
                return response.text();
            }})
            .catch(error => {{
                if (error.name === 'AbortError') {{
                    return 'TimeoutError';
                }}
                return 'Error: ' + error;
            }});
            """
            response = driver.web_driver.execute_script(fetch_script)
            # print(response)  # in phản hồi

            if isinstance(response, str) and response.startswith('Error:'):
                error_data = self.handle_str_error(response)
                if isinstance(error_data, dict):
                    return error_data

            if response and 'This service is not available in your region' in response:
                return 'This service is not available in your region'

            final_dict = {}
            conversation_info = {}
            new_title = None

            for line in response.splitlines():
                try:

                    parsed = json.loads(line)

                    if "modelResponse" in parsed.get("result", {}):
                        parsed["result"]["response"] = {"modelResponse": parsed["result"].pop("modelResponse")}

                    if "conversation" in parsed.get("result", {}):
                        conversation_info = parsed["result"]["conversation"]

                    if "title" in parsed.get("result", {}):
                        new_title = parsed["result"]["title"].get("newTitle")

                    if "modelResponse" in parsed.get("result", {}).get("response", {}):
                        final_dict = parsed
                    elif "modelResponse" in parsed.get("result", {}):
                        parsed["result"]["response"] = conversation_info
                except (json.JSONDecodeError, KeyError):
                    continue

            if final_dict:
                model_response = final_dict["result"]["response"]["modelResponse"]
                final_dict["result"]["response"] = {"modelResponse": model_response}
                final_dict["result"]["response"]["conversationId"] = conversation_info.get("conversationId")
                final_dict["result"]["response"]["title"] = conversation_info.get("title")
                final_dict["result"]["response"]["createTime"] = conversation_info.get("createTime")
                final_dict["result"]["response"]["modifyTime"] = conversation_info.get("modifyTime")
                final_dict["result"]["response"]["temporary"] = conversation_info.get("temporary")
                final_dict["result"]["response"]["newTitle"] = new_title

                if not self.always_new_conversation and model_response.get("responseId"):
                    self.conversationId = self.conversationId or conversation_info.get("conversationId")
                    self.parentResponseId = model_response.get("responseId") if self.conversationId else None

            logger.debug(f"Nhận được phản hồi: {final_dict}")
            return final_dict
        except Exception as e:
            logger.error(f"Lỗi trong _send_request: {e}")
            return {}

    def _rate_delay(self):
        """Giới hạn tốc độ gửi để giảm bị chặn."""
        try:
            min_s = float(os.getenv("GROK_RATE_DELAY_MIN", "1.0"))
            max_s = float(os.getenv("GROK_RATE_DELAY_MAX", "2.0"))
            if min_s < 0 or max_s <= 0 or max_s < min_s:
                return
            delay = random.uniform(min_s, max_s)
            logger.debug(f"Rate delay {delay:.2f}s")
            time.sleep(delay)
        except Exception:
            # Nếu parse env lỗi thì bỏ qua
            return

    def _profile_label(self) -> str:
        try:
            if self.anonymous or driver.web_driver.anonymous:
                return "incognito"
            name = driver.web_driver.get_active_profile_name()
            if name:
                return name
        except Exception:
            pass
        return os.getenv("GROK_CHROME_PROFILE_NAME", "Default")

    def _error_json(self, error_code: str, message: str, mode: str, details: Optional[List[Any]] = None) -> dict:
        profile = self._profile_label()
        logger.warning(f"Request failed (mode={mode}, profile={profile}, no_retry=true)")
        return {
            "error_code": error_code,
            "error": message,
            "profile": profile,
            "mode": mode,
            "details": details or []
        }

    def _rate_limit_error_json(self, message: str, mode: str) -> dict:
        return self._error_json("rate_limited", message, mode)

    def _anti_bot_error_json(self, mode: str) -> dict:
        return self._error_json(
            "anti_bot",
            "Request rejected by anti-bot rules.",
            mode
        )

    def _request_failed_json(self, message: str, mode: str) -> dict:
        return self._error_json("request_failed", message, mode)

    def _browser_not_ready_error_json(self, mode: str) -> dict:
        return self._error_json("browser_not_ready", "Browser not ready (page load timeout).", mode)

    def _parse_api_response_text(self, response: str) -> Optional[dict]:
        if not response:
            return None
        final_dict = {}
        conversation_info = {}
        new_title = None
        for line in response.splitlines():
            try:
                parsed = json.loads(line)
                if "modelResponse" in parsed.get("result", {}):
                    parsed["result"]["response"] = {"modelResponse": parsed["result"].pop("modelResponse")}
                if "conversation" in parsed.get("result", {}):
                    conversation_info = parsed["result"]["conversation"]
                if "title" in parsed.get("result", {}):
                    new_title = parsed["result"]["title"].get("newTitle")
                if "modelResponse" in parsed.get("result", {}).get("response", {}):
                    final_dict = parsed
                elif "modelResponse" in parsed.get("result", {}):
                    parsed["result"]["response"] = conversation_info
            except (json.JSONDecodeError, KeyError):
                continue

        if final_dict:
            model_response = final_dict["result"]["response"]["modelResponse"]
            final_dict["result"]["response"] = {"modelResponse": model_response}
            final_dict["result"]["response"]["conversationId"] = conversation_info.get("conversationId")
            final_dict["result"]["response"]["title"] = conversation_info.get("title")
            final_dict["result"]["response"]["createTime"] = conversation_info.get("createTime")
            final_dict["result"]["response"]["modifyTime"] = conversation_info.get("modifyTime")
            final_dict["result"]["response"]["temporary"] = conversation_info.get("temporary")
            final_dict["result"]["response"]["newTitle"] = new_title

            if not self.always_new_conversation and model_response.get("responseId"):
                self.conversationId = self.conversationId or conversation_info.get("conversationId")
                self.parentResponseId = model_response.get("responseId") if self.conversationId else None

        return final_dict or None

    def _is_rate_limit_message(self, message: Optional[str]) -> bool:
        if not message:
            return False
        text = str(message).lower()
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

    IMAGE_SIGNATURES = {
        b'\xff\xd8\xff': ("jpg", "image/jpeg"),
        b'\x89PNG\r\n\x1a\n': ("png", "image/png"),
        b'GIF89a': ("gif", "image/gif")
    }

    def _is_base64_image(self, s: str) -> bool:
        try:
            decoded = base64.b64decode(s, validate=True)
            return any(decoded.startswith(sig) for sig in self.IMAGE_SIGNATURES)
        except Exception:
            return False

    def _get_extension_and_mime_from_header(self, data: bytes) -> Tuple[str, str]:
        for sig, (ext, mime) in self.IMAGE_SIGNATURES.items():
            if data.startswith(sig):
                return ext, mime
        return "jpg", "image/jpeg"

    def _upload_image(self,
                      file_input: Union[str, BytesIO],
                      file_extension: str = "jpg",
                      file_mime_type: str = None) -> str:
        """
        Tải ảnh lên máy chủ từ đường dẫn tệp hoặc BytesIO và trả về fileMetadataId trong phản hồi.

        Args:
            file_input (Union[str, BytesIO]): Đường dẫn tệp hoặc BytesIO chứa nội dung tệp.
            file_extension (str): Phần mở rộng tệp không có dấu chấm (vd: "jpg", "png"). Mặc định "jpg".
            file_mime_type (str): MIME type của tệp. Nếu None thì tự xác định.

        Returns:
            str: fileMetadataId từ phản hồi của máy chủ.

        Raises:
            ValueError: Khi dữ liệu đầu vào không hợp lệ hoặc phản hồi không có fileMetadataId.
        """

        if isinstance(file_input, str):
            if os.path.exists(file_input):
                with open(file_input, "rb") as f:
                    file_content = f.read()
            elif self._is_base64_image(file_input):
                file_content = base64.b64decode(file_input)
            else:
                raise ValueError("Chuỗi không phải đường dẫn tệp hợp lệ cũng không phải chuỗi ảnh base64 hợp lệ")
        elif isinstance(file_input, BytesIO):
            file_content = file_input.getvalue()
        else:
            raise ValueError("file_input phải là đường dẫn tệp, chuỗi base64, hoặc đối tượng BytesIO")

        if file_extension is None or file_mime_type is None:
            ext, mime = self._get_extension_and_mime_from_header(file_content)
            file_extension = file_extension or ext
            file_mime_type = file_mime_type or mime

        file_content_b64 = base64.b64encode(file_content).decode("utf-8")
        file_name_base = file_content_b64[:10].replace("/", "_").replace("+", "_")
        file_name = f"{file_name_base}.{file_extension}"

        b64_str_js_safe = json.dumps(file_content_b64)
        file_name_js_safe = json.dumps(file_name)
        file_mime_type_js_safe = json.dumps(file_mime_type)

        fetch_script = f"""
        return fetch('https://grok.com/rest/app-chat/upload-file', {{
            method: 'POST',
            headers: {{
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'User-Agent': 'Mozilla/5.0',
                'Origin': 'https://grok.com',
                'Referer': 'https://grok.com/'
            }},
            body: JSON.stringify({{
                fileName: {file_name_js_safe},
                fileMimeType: {file_mime_type_js_safe},
                content: {b64_str_js_safe}
            }}),
            credentials: 'include'
        }})
        .then(response => {{
            if (!response.ok) {{
                return response.text().then(text => 'Error: HTTP ' + response.status + ' - ' + text);
            }}
            return response.json();
        }})
        .catch(error => 'Error: ' + error);
        """

        response = driver.web_driver.execute_script(fetch_script)

        if isinstance(response, str) and response.startswith('Error:'):
            raise ValueError(response)

        if not isinstance(response, dict) or "fileMetadataId" not in response:
            raise ValueError("Phản hồi máy chủ không chứa fileMetadataId")

        return response["fileMetadataId"]

    def _clean_conversation(self, payload: dict, history_id: str, message: str):
        if payload and "parentResponseId" in payload:
            del payload["parentResponseId"]
        payload["message"] = self._messages_with_possible_history(history_id, message)
        self.conversationId = None
        self.parentResponseId = None

    def _messages_with_possible_history(self, history_id: str, message: str) -> str:
        if (self.history.history_msg_count < 1 and self.history.main_system_prompt is None
                and history_id not in self.history._system_prompts):
            message_payload = message
        elif self.parentResponseId and self.conversationId:
            message_payload = message
        else:
            message_payload = self.history.get_history(history_id) + '\n' + message
        return message_payload


    def send_message(self,
                     message: str,
                     history_id: Optional[str] = None,
                     **kwargs: Any) -> GrokResponse:
        """Phương thức gửi tin nhắn đã lỗi thời. Vui lòng dùng phương thức ask."""
        logger.warning("Vui lòng dùng GrokClient.ask thay cho GrokClient.send_message")
        return self.ask(message=message,
                        history_id=history_id,
                        **kwargs)

    async def async_ask(self,
                        message: str,
                        history_id: Optional[str] = None,
                        new_conversation: Optional[bool] = None,
                        timeout: Optional[int] = None,
                        temporary: bool = False,
                        modelName: str = "grok-3",
                        images: Union[Optional[List[Union[str, BytesIO]]], str, BytesIO] = None,
                        fileAttachments: Optional[List[str]] = None,
                        imageAttachments: Optional[List] = None,
                        customInstructions: str = "",
                        deepsearch_preset: str = "",
                        disableSearch: bool = False,
                        enableImageGeneration: bool = True,
                        enableImageStreaming: bool = True,
                        enableSideBySide: bool = True,
                        imageGenerationCount: int = 2,
                        isPreset: bool = False,
                        isReasoning: bool = False,
                        returnImageBytes: bool = False,
                        returnRawGrokInXaiRequest: bool = False,
                        sendFinalMetadata: bool = True,
                        toolOverrides: Optional[Dict[str, Any]] = None,
                        forceConcise: bool = True,
                        disableTextFollowUps: bool = True,
                        webpageUrls: Optional[List[str]] = None,
                        disableArtifact: bool = False,
                        responseModelId: str = "grok-3",
                        ui: bool = False,
                        ui_response: str = "ui"
                        ) -> GrokResponse:
        """
        Lớp bao bất đồng bộ cho phương thức ask.
        Gửi yêu cầu tới Grok API với một tin nhắn và các tham số bổ sung.

        Args:
            message (str): Tin nhắn người dùng gửi lên API.
            history_id (Optional[str]): Định danh để chọn lịch sử chat.
            new_conversation (Optional[bool]): Có dùng URL tạo hội thoại mới khi gửi tới Grok (không áp dụng cho History tích hợp).
            timeout (Optional[int]): Thời gian chờ phản hồi (giây).
            temporary (bool): Cho biết phiên hoặc yêu cầu là tạm thời.
            modelName (str): Tên model AI xử lý yêu cầu.
            images (str / BytesIO / List[str / BytesIO]): Đường dẫn ảnh, ảnh base64, hoặc BytesIO (hoặc danh sách các loại này). Không dùng chung với fileAttachments.
            fileAttachments (Optional[List[str]]): Danh sách tệp đính kèm.
            imageAttachments (Optional[List]): Danh sách ảnh đính kèm.
            customInstructions (str): Hướng dẫn/ngữ cảnh bổ sung cho model.
            deepsearch_preset (str): Preset cho deep search.
            disableSearch (bool): Tắt chức năng tìm kiếm của model.
            enableImageGeneration (bool): Bật sinh ảnh trong phản hồi.
            enableImageStreaming (bool): Bật streaming ảnh.
            enableSideBySide (bool): Bật hiển thị song song thông tin.
            imageGenerationCount (int): Số ảnh cần sinh.
            isPreset (bool): Cho biết tin nhắn là preset.
            isReasoning (bool): Bật chế độ reasoning trong phản hồi.
            returnImageBytes (bool): Trả dữ liệu ảnh dạng bytes.
            returnRawGrokInXaiRequest (bool): Trả output thô từ model.
            sendFinalMetadata (bool): Gửi metadata cuối cùng kèm yêu cầu.
            toolOverrides (Optional[Dict[str, Any]]): Dictionary ghi đè thiết lập tool.
            forceConcise (bool): Bắt buộc trả lời ngắn gọn.
            disableTextFollowUps (bool): Tắt câu hỏi nối tiếp dạng text.
            webpageUrls (Optional[List[str]]): Danh sách URL trang web.
            disableArtifact (bool): Tắt cờ artifact.
            responseModelId (str): Model ID cho metadata phản hồi.

        Returns:
            GrokResponse: Phản hồi từ Grok API dưới dạng đối tượng.
        """
        try:
            return await _to_thread(self.ask,
                                    message=message,
                                    history_id=history_id,
                                    new_conversation=new_conversation,
                                    timeout=timeout,
                                    temporary=temporary,
                                    modelName=modelName,
                                    images=images,
                                    fileAttachments=fileAttachments,
                                    imageAttachments=imageAttachments,
                                    customInstructions=customInstructions,
                                    deepsearch_preset=deepsearch_preset,
                                    disableSearch=disableSearch,
                                    enableImageGeneration=enableImageGeneration,
                                    enableImageStreaming=enableImageStreaming,
                                    enableSideBySide=enableSideBySide,
                                    imageGenerationCount=imageGenerationCount,
                                    isPreset=isPreset,
                                    isReasoning=isReasoning,
                                    returnImageBytes=returnImageBytes,
                                    returnRawGrokInXaiRequest=returnRawGrokInXaiRequest,
                                    sendFinalMetadata=sendFinalMetadata,
                                    toolOverrides=toolOverrides,
                                    forceConcise=forceConcise,
                                    disableTextFollowUps=disableTextFollowUps,
                                    webpageUrls=webpageUrls,
                                    disableArtifact=disableArtifact,
                                    responseModelId=responseModelId,
                                    ui=ui,
                                    ui_response=ui_response)
        except Exception as e:
            logger.error(f"Lỗi trong async_ask: {e}")
            return GrokResponse({}, self.enable_artifact_files)

    def ask(self,
            message: str,
            history_id: Optional[str] = None,
            new_conversation: Optional[bool] = None,
            timeout: Optional[int] = None,
            temporary: bool = False,
            modelName: str = "grok-3",
            images: Union[Optional[List[Union[str, BytesIO]]], str, BytesIO] = None,
            fileAttachments: Optional[List[str]] = None,
            imageAttachments: Optional[List] = None,
            customInstructions: str = "",
            deepsearch_preset: str = "",
            disableSearch: bool = False,
            enableImageGeneration: bool = True,
            enableImageStreaming: bool = True,
            enableSideBySide: bool = True,
            imageGenerationCount: int = 2,
            isPreset: bool = False,
            isReasoning: bool = False,
            returnImageBytes: bool = False,
            returnRawGrokInXaiRequest: bool = False,
            sendFinalMetadata: bool = True,
            toolOverrides: Optional[Dict[str, Any]] = None,
            forceConcise: bool = True,
            disableTextFollowUps: bool = True,
            webpageUrls: Optional[List[str]] = None,
            disableArtifact: bool = False,
            responseModelId: str = "grok-3",
            ui: bool = False,
            ui_response: str = "ui",
            ) -> GrokResponse:
        """
        Gửi yêu cầu tới Grok API với một tin nhắn và các tham số bổ sung.

        Args:
            message (str): Tin nhắn người dùng gửi lên API.
            history_id (Optional[str]): Định danh để chọn lịch sử chat.
            new_conversation (Optional[bool]): Có dùng URL tạo hội thoại mới khi gửi tới Grok.
            timeout (Optional[int]): Thời gian chờ phản hồi (giây).
            temporary (bool): Cho biết phiên hoặc yêu cầu là tạm thời.
            modelName (str): Tên model AI xử lý yêu cầu.
            images (str / BytesIO / List[str / BytesIO]): Ảnh cần gửi.
            fileAttachments (Optional[List[str]]): Danh sách tệp đính kèm.
            imageAttachments (Optional[List]): Danh sách ảnh đính kèm.
            customInstructions (str): Hướng dẫn bổ sung cho model.
            deepsearch_preset (str): Preset cho deep search.
            disableSearch (bool): Tắt chức năng tìm kiếm của model.
            enableImageGeneration (bool): Bật sinh ảnh trong phản hồi.
            enableImageStreaming (bool): Bật streaming ảnh.
            enableSideBySide (bool): Bật hiển thị song song.
            imageGenerationCount (int): Số ảnh cần sinh.
            isPreset (bool): Cho biết tin nhắn là preset.
            isReasoning (bool): Bật chế độ reasoning.
            returnImageBytes (bool): Trả dữ liệu ảnh dạng bytes.
            returnRawGrokInXaiRequest (bool): Trả output thô từ model.
            sendFinalMetadata (bool): Gửi metadata cuối cùng kèm yêu cầu.
            toolOverrides (Optional[Dict[str, Any]]): Dictionary ghi đè thiết lập tool.
            forceConcise (bool): Bắt buộc trả lời ngắn gọn.
            disableTextFollowUps (bool): Tắt câu hỏi nối tiếp dạng text.
            webpageUrls (Optional[List[str]]): Danh sách URL trang web.
            disableArtifact (bool): Tắt cờ artifact.
            responseModelId (str): Model ID cho metadata phản hồi.

        Returns:
            GrokResponse: Phản hồi từ Grok API.
        """

        if timeout is None:
            timeout = self.timeout


        if images is not None and fileAttachments is not None:
            raise ValueError("Không thể dùng đồng thời 'images' và 'fileAttachments'")
        last_error_data = {}
        try:
            use_ui = ui or self.ui
            if not driver.web_driver.wait_for_page_ready(timeout=timeout):
                last_error_data = self._browser_not_ready_error_json("ui" if use_ui else "api")
                return GrokResponse(last_error_data, self.enable_artifact_files)
            if use_ui:
                logger.info("UI mode=on")
                if images or fileAttachments or toolOverrides:
                    logger.warning("UI mode chỉ hỗ trợ text. Bỏ qua images/fileAttachments/toolOverrides.")
                message_payload = self._messages_with_possible_history(history_id, message)
                effective_ui_response = ui_response if ui else self.ui_response
                if effective_ui_response == "api":
                    logger.info("UI response via API intercept=on")
                    ok = driver.web_driver.send_prompt_via_ui(message_payload)
                    if not ok:
                        last_error_data = self._request_failed_json("UI submit locked hoặc không gửi được prompt", "ui")
                        return GrokResponse(last_error_data, self.enable_artifact_files)
                    if not driver.web_driver.wait_for_ui_api_response(timeout=timeout):
                        logger.warning("UI API response not captured")
                        last_error_data = self._request_failed_json("UI API response not captured", "ui")
                        return GrokResponse(last_error_data, self.enable_artifact_files)
                    deadline = time.time() + (timeout if timeout is not None else self.timeout)
                    payload_json = None
                    while time.time() < deadline:
                        raw = driver.web_driver.get_last_ui_api_response(clear=False)
                        if raw:
                            payload_json = self._parse_api_response_text(raw)
                            if payload_json:
                                break
                        time.sleep(0.3)
                    if not payload_json:
                        logger.warning("UI API response not captured")
                        last_error_data = self._request_failed_json("UI API response not captured", "ui")
                        return GrokResponse(last_error_data, self.enable_artifact_files)
                    driver.web_driver.get_last_ui_api_response(clear=True)
                    logger.info("Captured UI API response")
                    return GrokResponse(payload_json, self.enable_artifact_files)

                ui_text = driver.web_driver.ui_ask(message_payload, timeout=timeout)
                if not ui_text:
                    ui_error = driver.web_driver.get_last_ui_error()
                    if ui_error:
                        if self._is_rate_limit_message(ui_error):
                            last_error_data = self._rate_limit_error_json(ui_error, "ui")
                            return GrokResponse(last_error_data, self.enable_artifact_files)
                        last_error_data = self._request_failed_json(ui_error, "ui")
                        return GrokResponse(last_error_data, self.enable_artifact_files)
                    last_error_data = self._request_failed_json("UI submit locked hoặc không đọc được phản hồi", "ui")
                    return GrokResponse(last_error_data, self.enable_artifact_files)
                last_error_data = {
                    "result": {
                        "response": {
                            "modelResponse": {
                                "message": ui_text,
                                "sender": "assistant"
                            }
                        }
                    }
                }
                return GrokResponse(last_error_data, self.enable_artifact_files)

            base_headers = {
                "Content-Type": "application/json",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 OPR/119.0.0.0"
                ),
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language": "ru",
                "Origin": "https://grok.com",
                "Referer": "https://grok.com/",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "Sec-CH-UA": '"Chromium";v="134", "Not:A-Brand";v="24", "Opera";v="119"',
                "Sec-CH-UA-Mobile": "?0",
                "Sec-CH-UA-Platform": '"Windows"',
                "Priority": "u=1, i",
            }

            headers = base_headers.copy()

            if images:
                fileAttachments = []
                if isinstance(images, list):
                    for image in images:
                        fileAttachments.append(self._upload_image(image))
                else:
                    fileAttachments.append(self._upload_image(images))


            message_payload = self._messages_with_possible_history(history_id, message)

            payload = {
                "temporary": temporary,
                "modelName": modelName,
                "message": message_payload,
                "fileAttachments": fileAttachments if fileAttachments is not None else [],
                "imageAttachments": imageAttachments if imageAttachments is not None else [],
                "disableSearch": disableSearch,
                "enableImageGeneration": enableImageGeneration,
                "returnImageBytes": returnImageBytes,
                "returnRawGrokInXaiRequest": returnRawGrokInXaiRequest,
                "enableImageStreaming": enableImageStreaming,
                "imageGenerationCount": imageGenerationCount,
                "forceConcise": forceConcise,
                "toolOverrides": toolOverrides if toolOverrides is not None else {},
                "enableSideBySide": enableSideBySide,
                "sendFinalMetadata": sendFinalMetadata,
                "isPreset": isPreset,
                "isReasoning": isReasoning,
                "disableTextFollowUps": disableTextFollowUps,
                "customInstructions": customInstructions,
                "deepsearch preset": deepsearch_preset,

                "webpageUrls": webpageUrls if webpageUrls is not None else [],
                "disableArtifact": disableArtifact or not self.enable_artifact_files,
                "responseMetadata": {
                    "requestModelDetails": {
                        "modelId": responseModelId
                    }
                }
            }

            if self.parentResponseId:
                payload["parentResponseId"] = self.parentResponseId

            logger.debug(f"Dữ liệu gửi Grok: {payload}")
            if new_conversation:
                self._clean_conversation(payload, history_id, message)

            response = ""
            use_cookies: bool = self.cookies is not None
            is_list_cookies = isinstance(self.cookies, list)

            if use_cookies:
                current_cookies = self.cookies[0] if is_list_cookies else self.cookies
                driver.web_driver.set_cookies(current_cookies)
                if images:
                    fileAttachments = []
                    if isinstance(images, list):
                        for image in images:
                            fileAttachments.append(self._upload_image(image))
                    else:
                        fileAttachments.append(self._upload_image(images))
                    payload["fileAttachments"] = fileAttachments if fileAttachments is not None else []

            logger.debug(
                f"Gửi yêu cầu (single attempt): headers={headers}, payload={payload}, timeout={timeout} giây")

            if new_conversation:
                self._clean_conversation(payload, history_id, message)

            # Thêm delay giữa các lần gửi để giảm anti-bot (không phải retry)
            self._rate_delay()

            response = self._send_request(payload, headers, timeout)
            logger.debug(f"Phản hồi Grok: {response}")

            if isinstance(response, dict) and response:
                last_error_data = response
                str_response = str(response)

                if 'Too many requests' in str_response or 'credentials' in str_response:
                    last_error_data = self._rate_limit_error_json(
                        "Too many requests or credentials error.",
                        "api"
                    )
                    return GrokResponse(last_error_data, self.enable_artifact_files)
                if 'This service is not available in your region' in str_response:
                    return GrokResponse(last_error_data, self.enable_artifact_files)
                if 'a padding to disable MSIE and Chrome friendly error page' in str_response or "Request rejected by anti-bot rules." in str_response:
                    last_error_data = self._anti_bot_error_json("api")
                    return GrokResponse(last_error_data, self.enable_artifact_files)
                if 'Message limit reached' in str_response:
                    last_error_data = self._rate_limit_error_json("Message limit reached", "api")
                    return GrokResponse(last_error_data, self.enable_artifact_files)
                if 'Grok is under heavy usage' in str_response or 'Too many requests' in str_response or 'rate limit' in str_response or 'Rate limit' in str_response:
                    last_error_data = self._rate_limit_error_json(
                        "Grok is under heavy usage right now. Please try again later.",
                        "api"
                    )
                    return GrokResponse(last_error_data, self.enable_artifact_files)
                response_obj = GrokResponse(response, self.enable_artifact_files)
                assistant_message = response_obj.modelResponse.message
                if self.history.history_msg_count > 0:
                    self.history.add_message(history_id, SenderType.ASSISTANT, assistant_message)
                    if self.history_auto_save:
                        self.history.to_file()
                return response_obj

            if isinstance(response, str):
                if self._is_rate_limit_message(response):
                    last_error_data = self._rate_limit_error_json(response, "api")
                    return GrokResponse(last_error_data, self.enable_artifact_files)
                last_error_data = self._request_failed_json(response, "api")
                return GrokResponse(last_error_data, self.enable_artifact_files)

            last_error_data = self._request_failed_json("Request failed", "api")
            return GrokResponse(last_error_data, self.enable_artifact_files)

        except Exception as e:
            logger.debug(f"Lỗi trong ask: {e}")
            if not last_error_data:
                last_error_data = self.handle_str_error(str(e))
        finally:
            if self.history.history_msg_count > 0:
                self.history.add_message(history_id, SenderType.ASSISTANT, message)
                if self.history_auto_save:
                    self.history.to_file()
            return GrokResponse(last_error_data, self.enable_artifact_files)

    def handle_str_error(self, response_str):
        try:
            if "Message limit reached" in response_str:
                return self._rate_limit_error_json("Message limit reached", "api")
            if "Grok is under heavy usage" in response_str or "Too many requests" in response_str or "rate limit" in response_str or "Rate limit" in response_str:
                return self._rate_limit_error_json(
                    "Grok is under heavy usage right now. Please try again later.",
                    "api"
                )
            json_str = response_str.split(" - ", 1)[1]
            response = json.loads(json_str)

            if isinstance(response, dict):
                # {"error": {...}}
                if 'error' in response:
                    error = response['error']
                    error_code = error.get('code', 'Không rõ')
                    error_message = error.get('message') or response_str
                    error_details = error.get('details') if isinstance(error.get('details'), list) else []
                # {"code": ..., "message": ..., "details": ...}
                elif 'message' in response:
                    error_code = response.get('code', 'Không rõ')
                    error_message = response.get('message') or response_str
                    error_details = response.get('details') if isinstance(response.get('details'), list) else []
                else:
                    raise ValueError("Định dạng lỗi không hỗ trợ")

                return self._error_json(str(error_code), error_message, "api", error_details)

        except Exception:
            pass

        return self._request_failed_json(response_str, "api")

async def _to_thread(func, /, *args, **kwargs):

    loop = events.get_running_loop()
    ctx = contextvars.copy_context()
    func_call = functools.partial(ctx.run, func, *args, **kwargs)
    return await loop.run_in_executor(None, func_call)
