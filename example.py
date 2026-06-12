import asyncio
import logging
import os
import random

from grok3api.client import GrokClient
from grok3api import driver


logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s"
)

# urllib3_con_logger = logging.getLogger("urllib3.connectionpool")
# for handler in urllib3_con_logger.handlers[:]:
#     urllib3_con_logger.removeHandler(handler)
# urllib3_con_logger.setLevel(logging.DEBUG)

# không bắt buộc
cookies_dict = {
    "i18nextLng": "ru",
    "sso-rw": "sso-rw-token-placeholder",
    "sso": "sso-token-placeholder",
    "cf_clearance": "cf_clearance-placeholder",
    "_ga": "ga-placeholder",
    "_ga_8FEWB057YH": "ga-8FEWB057YH-placeholder"
}

# không bắt buộc
# Giữ chuỗi này dạng một dòng nếu thật sự cần.
# Ưu tiên tải cookies từ tệp cục bộ hoặc biến môi trường thay vì hardcode.
cookie_str = "_ga=GA1.1.155583035.1764338593; i18nextLng=vi; sso=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uX2lkIjoiMTdmZTlmNTEtODgyMS00MWU2LWI2MzYtYjVlMjU2M2IxMGRhIn0.TXLp00Wbcn-wJnwHJBnf6KdrVak6ERjI5kK_qhH__jw; sso-rw=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uX2lkIjoiMTdmZTlmNTEtODgyMS00MWU2LWI2MzYtYjVlMjU2M2IxMGRhIn0.TXLp00Wbcn-wJnwHJBnf6KdrVak6ERjI5kK_qhH__jw; x-userid=0e8712a4-f2b8-4db5-99df-1c2b7ca4f437; cf_clearance=wWPFiNamwvrupx8vG0A04YX1xNMzLpyvnzRWJ96bIKo-1774009220-1.2.1.1-.qKO5DXdVgg01eQjOZmCoEoYSgOEnjYLD1dy67PTXpqcedfmGdiEfMK3kOwFqYVIDSZchqPhD2EhnxJnNgZI4lfxSmAvXLiGCBkE5MsZzWGWU3Uq1YG1zt.sNIS7akKocWKK7h22SL6V.4OxBH1q9Mit2xAhYxIyQXJGnKbENPks7OtxY.yF3hhnyy2Qyxfnf0fx2CKlk19k6YzaWpEZOdjIbMISyEi_zB_vAMl6XkTzRhr.__ftJNPqUfzCGtmj; __cf_bm=8wSmuQYSS.3bG532Q5m51xCtHXvGCQZxryArmDsk2LU-1774009220.906696-1.0.1.1-v_CvM1oJX51pI2P5zV08tP5WD4NasLisPm27CpL8EDRP8Hc7tDPV3koSIdWbKGZIoF_7fH1weQzG_dL0xh6w9r2iYT9EOxYSIQfQgDc51Nhyz3KXmvTih6Tqav6Uov_J; mp_ea93da913ddb66b6372b89d97b1029ac_mixpanel=%7B%22distinct_id%22%3A%220e8712a4-f2b8-4db5-99df-1c2b7ca4f437%22%2C%22%24device_id%22%3A%2297d2926c-fce1-41d4-a1a0-402f739ecd82%22%2C%22%24initial_referrer%22%3A%22https%3A%2F%2Fgrok.com%2F%3F__cf_chl_tk%3DBkTYCKIBdbC5oPjZW3xzi3.VjyAOp733MfsGgq69b4M-1764338578-1.0.1.1-RQ39OWgov_WZn4gshGgEMJRRvbVu48OOVg4zZ7xXTB0%22%2C%22%24initial_referring_domain%22%3A%22grok.com%22%2C%22__mps%22%3A%7B%7D%2C%22__mpso%22%3A%7B%7D%2C%22__mpus%22%3A%7B%7D%2C%22__mpa%22%3A%7B%7D%2C%22__mpu%22%3A%7B%7D%2C%22__mpr%22%3A%5B%5D%2C%22__mpap%22%3A%5B%5D%2C%22%24user_id%22%3A%220e8712a4-f2b8-4db5-99df-1c2b7ca4f437%22%2C%22%24search_engine%22%3A%22google%22%7D; _ga_8FEWB057YH=GS2.1.s1774009286$o32$g1$t1774009305$j41$l0$h0"


def select_profile(anonymous: bool) -> None:
    if anonymous:
        print("Anonymous mode bật, bỏ qua chọn profile.")
        return
    os.environ.setdefault(
        "GROK_CHROME_PROFILE_DIR",
        r"C:\Users\congt\AppData\Roaming\nauchaoheo\grok3_profile"
    )
    env_profile = os.getenv("GROK_CHROME_PROFILE_NAME")
    if env_profile:
        print(f"Đang dùng profile từ môi trường: {env_profile}")
        return

    profile_dir, profiles = driver.list_profiles()
    if not profiles:
        print("Không tìm thấy profile nào, sẽ dùng mặc định.")
        return

    print(f"Profile dir: {profile_dir}")
    print("Chọn profile để chạy:")
    for idx, name in enumerate(profiles, start=1):
        print(f"{idx}. {name}")

    choice = input("Nhập số profile (Enter để bỏ qua): ").strip()
    if not choice:
        print("Không chọn profile, sẽ dùng mặc định.")
        return
    try:
        index = int(choice)
        if index < 1 or index > len(profiles):
            raise ValueError
    except ValueError:
        print("Lựa chọn không hợp lệ, sẽ dùng mặc định.")
        return

    selected = profiles[index - 1]
    os.environ["GROK_CHROME_PROFILE_NAME"] = selected
    print(f"Đã chọn profile: {selected}")

async def main():
    anonymous_choice = input("Chạy ẩn danh? (y/N): ").strip().lower()
    anonymous = anonymous_choice in {"y", "yes", "1", "true"}
    select_profile(anonymous)
    client = GrokClient(
        history_msg_count=0,            # Có thể thêm cookies dạng str hoặc dict (hoặc List[dict hoặc str])
        always_new_conversation=False,  # Dùng lại hội thoại cũ
        anonymous=anonymous,            # Dùng trình duyệt ẩn danh
        ui=True,       
    )
    client.history.set_main_system_prompt("Trả lời ngắn gọn và kèm emoji")
    os.makedirs("images", exist_ok=True)
    while True:
        #prompt = input("Nhập truy vấn: ")
        prompt = str(random.randint(1, 100))
        if prompt == "q": break
        print(f"Đang gửi prompt: {prompt}")
        result = await client.async_ask(message=prompt,
                            modelName="grok-3",
                            history_id="0",
                            # images=["C:\\Users\\user\\Downloads\\photo.jpg",
                            #         "C:\\Users\\user\\Downloads\\скрин_сайта.png"],
                            )
        if result.error:
            print("Đã nhận phản hồi từ Grok (lỗi)")
            print(f"Đã xảy ra lỗi: {result.error}")
            if result.error_payload:
                import json
                print("Lỗi (JSON):")
                print(json.dumps(result.error_payload, ensure_ascii=False))
            if result.error_code == "rate_limited":
                print("Rate limit đã xảy ra, dừng gửi thêm prompt.")
                break
            continue
        print("Đã nhận phản hồi từ Grok (thành công)")
        print(result.modelResponse.message)
        if result.modelResponse.generatedImages:
            for index, image in enumerate(result.modelResponse.generatedImages, start=1):
                image.save_to(f"images/gen_img_{index}.jpg")
        await client.history.async_to_file()
        await asyncio.sleep(10)

if __name__ == '__main__':
    asyncio.run(main())
