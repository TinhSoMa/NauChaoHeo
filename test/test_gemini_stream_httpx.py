import httpx
import json
import time
import sys

# --- CẤU HÌNH HARDCODED ---
COOKIE_VALUE = "__Secure-BUCKET=CJMB; _gcl_aw=GCL.1763473868.CjwKCAiAz_DIBhBJEiwAVH2XwBsmsaFjkEw_kdo3VDBvowcKLj-6d0GlFeAcSjrO0lplkxJ8Wj11NRoCa8sQAvD_BwE; _gcl_dc=GCL.1763473868.CjwKCAiAz_DIBhBJEiwAVH2XwBsmsaFjkEw_kdo3VDBvowcKLj-6d0GlFeAcSjrO0lplkxJ8Wj11NRoCa8sQAvD_BwE; _gcl_au=1.1.566953289.1763473864.1658570616.1763694351.1763694350; _ga=GA1.1.780603260.1763473864; _ga_WC57KJ50ZZ=deleted; SEARCH_SAMESITE=CgQI-Z8B; AEC=AaJma5tJt9rByI1m-o5BibVClAGRRSpGNagLO5n8gkEjRzV1QCMnxZF7ng; SID=g.a0006Ah_SYFPGmAcxCIBva0cxKJ2TTnXQhKelZEOHyF_v1YoS-xwz0q5dXRwpv5b51wjQZ5XmQACgYKAewSARQSFQHGX2MihZQdb3U7HTbxfoPbD_VZnhoVAUF8yKruatwmOGmB-15jNQpWZQiR0076; __Secure-1PSID=g.a0006Ah_SYFPGmAcxCIBva0cxKJ2TTnXQhKelZEOHyF_v1YoS-xwkdUxcu--2AN21cWX0TmUOgACgYKAWcSARQSFQHGX2MiukxI_qPfUk5XVClWRRghABoVAUF8yKogjhGfzp-SGuE3l5MeryOw0076; __Secure-3PSID=g.a0006Ah_SYFPGmAcxCIBva0cxKJ2TTnXQhKelZEOHyF_v1YoS-xw_BVkAkwhge8iouoRo918JAACgYKAWkSARQSFQHGX2Mi-nTt9Xsv8a6-ufYm5lW8TBoVAUF8yKpkRUbHKUeMroiEL5O7wuin0076; HSID=AR2s7preyG1DuCu77; SSID=AnsE1IH8O-DDFN4SJ; APISID=zQvuDpXKCcnYzd5c/AYrvv5DpkaX_AfaWB; SAPISID=4x4qcQpkKXmwZgxN/Ax4ezeVLu_dUj0V4S; __Secure-1PAPISID=4x4qcQpkKXmwZgxN/Ax4ezeVLu_dUj0V4S; __Secure-3PAPISID=4x4qcQpkKXmwZgxN/Ax4ezeVLu_dUj0V4S; NID=528=Hk1mMcU14AS2b-OhRqpkIlRPAFyKMENyorKlzuC7XTIcie7E6M1D3p9Z_-zNFd2xCYRpUY5_PPX3UgDxq_citu1P_g4ZrZKnO3TbleQn_BCD4lXfIMr1rBnFPYqiyB4dCxDuBe8k__H0oappKrElnbxXwe-S2bcGRRsVjPxSMV-6J73bU-DSjtBH7kXfRW2mcEhtH08N3vB_tasREGGx2hwrhRGcJdkhhnAFRKtX-Ic0ZfWRr9bP-ZQ6IzGCSKPy8FGoIYEh3LSfIu6HEds9EXpTOYyDysUIHdMaGFqrtSZDzRtllKHlHIb_HKcut-6N23xpw0ydjjI37zvLMvuohJ5ZYrX9yYAW3fFvSkb6U-XeGqfJZqrDxwc3JZdvh36K5tScgS05fIaaGPmNitcJl1jN9DS4s3ZchLJzyr2yjjXrdN5zCNTJfmRkPMe-MWGyF9S2of4h-j61c929ji_NEElnFKpF5_TswXkh4Ir-u2xbW13Y2cVDwqdCKePhjvsKM3JS9k9U86zhzewK1rv4lgLACUHAVBWBvUk9zLcqYioeUin0gIgv0LrZThDtTSa6rugMwZMYHUdHrAeXrXzUIw-VawHKXY7LEFwdhAJyw3pEhbg2hTDsl3cN6I9AmMpCvdCf0nYdBpx7KSsVq_nOgQGoLjoZXBH07rq9wXDp8Egs2ObGz6qSfYONa6zqZS1WgdQJ1ARMiGjETU04VXr7LSr3y_SsFe9-TGKh9CwgGX_RSf4H7ZJHKR7fhDtyx2OhTNpQy1LXBfkc5WPO44OM5dRh8YU82hEd6FSqgvEt9puSIoUx2GUpd7y5FreQwpXW2bMcDRiWvkz-dv_e3Jz9Os8wPhMPUHxJrCkydGIYTUmJUWYjHQC81W3s9gr51s_QG7hxEDN895zdfpzVyCPkyAq0xw4u5ZStwvsUypq4D-kQS5LsD6Qn19GEeY7tNV3QchPWQRIC9sWuON9lkHmyzgegWuKJltaQOVAYyZ3WXmgq6Z9D0tNOty8Y1RGn9ZdQx95nV9iR0f9jVEYsPQMsH9GvSHnrBWaueZ2uKq2Dcmz-ltIySlJU2KJFzmtevmbHymZ1l5AX7kQcyZng7-MFba8B5MhLXtrZ0ueVh5Qm0ZVOVTFvxIXQfjXs20OnWp5PzWbs7GhaGOKvZbR91I_MAT-Cm-MwC7vhD0dVDYcVXj351ADDbKrLE3mSsH6YhbtF2zFKzfOlsbF2NulkUg5rMBnX7Lhjnj7EUEDEs7q59rbTDztz9aO-KrmA3dgMJkdLLL3cb2nopcyHSzOnrdlKf_SuMiTrIHjmxtDN73_bPxeURJJWXWzKLT__84rNTYV4YcPWJostWge7Wi68twKLLoezXiosPEUBaTUF7ONUXHL8xUalqnO4CJ4xsif-LHmNAIiYLmRquA1fdNCC5XzbM-dK2fCIweYaLZ-7CJcyNv-6iUQxxtAz0PzxEUhCpohCZ76tRjpmOeDTsCdBhlMPAMfKE6-1-DjqfQ5yvxqpMukgzQ3RNt-kp8JyttmWhaKZmWjM2ZvyU2qkhBal4xbknZK9KyyXpnFaStVKcvq1kZ3f6SQazXF6J-sBC9TOmSOxVUBxHAKZa-Z3j5womg0f_lgf7rdhW0MCuyqRou22tmR_ReuaDgJasomq6hgjR21C4QMgkWSrdt5LyDV3F4gTaYWQY1ueUW1I3f8o76eNvQJUaCA_fdHvNy-hP-gDBdDeNhHy1UeAfddXUSHy7U6eBevePzdBxAewdJMrRIDRUlD3jQVYTJ0Y_5YuAAFTxs_F6KwwzQqWUGdgjrRkwfam1MrHhBTsTsp_8Ipl-A_tCrT8EmiFWFbcKcwQxG8NUSLiOOjhvqW5rR3k7hPFGJ4_xG6FfNR9VMzn95OkE4Mosk7f-UuZFyCpSXNUnNvhfIjshC01_NUxpWuLIfRWDlfsBNUPBDJIA_Rrro6Y1tQjjWk2JgCcDwltGKKMVR8fOnN4mq_arlspB19H8iG6RNMBgs9dhIKdq6woEmdFbOhhOdAsiuoG8mo6prh3Rm4sIix4NQ-EjO-ZEvhiFJ7MZDLQLoRBYBxIOfiAUPjD2yZj8pEi7l2V9YJDVdHEbPfpoSBckkanMojT4X7vSekZjng49ER8cTRaOQtdHXtvBT-I1RjXUTGSDwluJRyQE0UtZg18_ELfhQptNIjrY52Wnw2T-YghdMN6MPZjHIK05mid1Xoz8W84qE_hkjU-i-xBQM6Af-UjGEDdlAzKcGkZZ5ipzxa0Hs7Pe9Jt-PUD2EcHIUKBVZ7ylKPznTFIzRwnSYxFjBQ6uD9hM8VdRKc-jZT-atpf_5tTezGJn3NKgoUOuV4b_J_yPncF9XdgWKhAMeYqbPDnNFoswwchwbrnEnmIOZRWHvNblMEYySOr_oqK6GK5j5EtHCZKAl5_jAXfSKFfE3pzqoeo-ift3CF9wJj1nO-hApRTH0vCs7e29z0M9YzcV1vFPKrurMhR1zaoRKvHn1cr9Ac1_ZWtMmWMFr5QUy1ff5cLoDmwOnlqGnuSMRp-wZOhs7vz_krmuok2XC8IAPq8_xT2jF_1ivBYvq11-qVriX4P_gYfFbEBF7bbmwFm_Gg6--3uT0mOPolYIIbnZUd8aib38Zw-CpJsdCO-Zszy2zcrJh_IZydxJoKoOLEFo0ffEYHnnt3TnWqHxWIGHCeNcydCCvjfn_w21Fg4n2T3RAXmNGhZEPhTTvnRK5G9laQsZB3YC8Oqa6cqAN6zYMH-24-9uREo3sCourXP5B3oMbdi-rTjd1iDxLKbBZ7nttIpimkqGZCp3s0SqTGO-JST07cJDVhxCGSJDC4HlH5kLv9hoOCizzema1Ibym2TT-wRrsaagzN9E_tQXtUu09SG0wWHt7hxlHJZ-0lyuM0Rh-RxlrCp4N2CJkbmYqJS1h5cBviJL2Qd8Lws11nJY_oSJ2iNo3oVUsgQx6BM8OoXsCL3y_z7jrkp-29emihi87wSDadKq_tbXvbOpjFBacIsVYawfZ5csmdfqHWPE3g2P0qTia8E0R_TIwWcZimv2R_xvZyO6-vkR6ipS2BQ0-S7mMFHFeROfoBRY8tljTaX-QcSpUO74Ie4_R16JEBmb6sYP99558qSxwceEKfksfJ2qXFY5_5KV62XJHHyaRzs4OQUKe8l12qowo1tGTT4DYNF7AoibCQjcswcATFLa9jCw1vTSRB5IRYY2-t3U0u11t_njbK2xlKF4ZvLV6OVqaz02Q; COMPASS=gemini-pd=CjwACWuJV93jFYb_b6k1ZbZc5AVi75OXfwVJx6huPFdJgLZgT-iphNSBtyIyTho-2Gurv4U86El7hPmdVFUQnZfSywYaXwAJa4lXuELTyQR94IuqMXm3Prh8Lu7SWLl7s_aqNrzJWeJ2MDgkC0W5bEEUhwuS4e0YG8G9X4eN2adwOW_if5UsVXzV4yAK_3QuREZuX3c6-0KTr4R-KCZwvRbHkQC3IAEwAQ:gemini-hl=CkkACWuJV4Jq7gXnYGXm-CCWRGf1MNczIJ0yMsen8R98zb0fdd_v1HDcw_-Y0Gxw7WZu_GGVl89NUAGecp6EG6tM_DjudIlkdiK-EPuw08sGGmwACWuJV2t4I2SGnafummLvI3daW16iBTVhhTv1Mh33zklIBSDSuc98xMZ7OxmpF1UNg5qxDfgX8TDD6WJBrsKQqpX99vhXIZFPjnxFuUNr6QAwqoC8_7S54lbV_N4PZao92zgNYl-lC-GzLXwgATAB; _ga_BF8Q35BMLM=GS2.1.s1769178348$o382$g1$t1769181568$j10$l0$h0; __Secure-1PSIDTS=sidts-CjYB7I_69CYnVFYRIqDuE04k5s8y9BzjBgZxdG0dHak_33DK0v5zFi2D5fI20l1pqzmusBAshH0QAA; __Secure-1PSIDRTS=sidts-CjYB7I_69CYnVFYRIqDuE04k5s8y9BzjBgZxdG0dHak_33DK0v5zFi2D5fI20l1pqzmusBAshH0QAA; __Secure-3PSIDTS=sidts-CjYB7I_69CYnVFYRIqDuE04k5s8y9BzjBgZxdG0dHak_33DK0v5zFi2D5fI20l1pqzmusBAshH0QAA; __Secure-3PSIDRTS=sidts-CjYB7I_69CYnVFYRIqDuE04k5s8y9BzjBgZxdG0dHak_33DK0v5zFi2D5fI20l1pqzmusBAshH0QAA; _ga_WC57KJ50ZZ=GS2.1.s1769178346$o53$g1$t1769181769$j60$l0$h0; SIDCC=AKEyXzXEAS7DA8EPw2QTUSAhApuhwQnFDPdPp6YOnHYxI9YwvmumhN_dI50eN4dx0gBa72EKUHs; __Secure-1PSIDCC=AKEyXzWAUDpOs3PEp0h8lMnYQOXejSOhwPbSVd7-vrXZ9KPHbxVm3eNyzRTNZWmlgeZntrkO7npc; __Secure-3PSIDCC=AKEyXzW3868apQO6w_xUStDiqCP9v3RxH1n-jkB0DQwf5S3BsDnZ8ErEUhar6OROLQkRKnAd-zMV"
F_SID = "7493167831294892309"
BL = "boq_assistant-bard-web-server_20260121.00_p1"
HL = "vi"
REQ_ID = "21477148"
AT_TOKEN = "AEHmXlGF3OgfeZ2C6fRUpB-9hrC9:1769178327391"

def parse_gemini_stream_raw(byte_stream):
    """
    Parse RAW byte stream từ Google Gemini.
    Format: <length>\n<json>\n<length>\n<json>...
    
    Yields: {"text": "..."} hoặc {"context": {...}}
    """
    buffer = b""
    last_text_length = 0
    new_conv_id = ""
    new_resp_id = ""
    new_cand_id = ""
    
    chunk_count = 0
    line_count = 0
    
    print("🔄 Bắt đầu nhận stream...", file=sys.stderr)
    sys.stderr.flush()
    
    for chunk in byte_stream:
        if not chunk:
            continue
            
        buffer += chunk
        
        # Tìm các dòng hoàn chỉnh (kết thúc bằng \n)
        while b'\n' in buffer:
            line_end = buffer.index(b'\n')
            line = buffer[:line_end]
            buffer = buffer[line_end + 1:]
            
            line_count += 1
            
            if not line:
                continue
            
            try:
                # Decode line
                decoded = line.decode('utf-8')
                
                # Debug: In ra line để xem cấu trúc
                if line_count <= 5:
                    print(f"📄 Line {line_count}: {decoded[:100]}...", file=sys.stderr)
                    sys.stderr.flush()
                
                # Bỏ qua dòng chỉ chứa số (length prefix)
                if decoded.isdigit():
                    continue
                
                # Parse JSON
                data_obj = json.loads(decoded)
                
                # Cấu trúc: [["wrb.fr", ..., "inner_json", ...]]
                if isinstance(data_obj, list) and len(data_obj) > 0:
                    if isinstance(data_obj[0], list) and len(data_obj[0]) > 2 and isinstance(data_obj[0][2], str):
                        inner_data = json.loads(data_obj[0][2])
                        
                        # Lấy Text (accumulated)
                        if len(inner_data) >= 5:
                            candidates = inner_data[4]
                            if candidates and isinstance(candidates, list) and len(candidates[0]) > 1:
                                full_text_content = candidates[0][1][0]
                                if full_text_content:
                                    current_length = len(full_text_content)
                                    if current_length > last_text_length:
                                        chunk_count += 1
                                        delta = full_text_content[last_text_length:]
                                        
                                        # Debug output
                                        preview = delta[:30].replace('\n', '\\n')
                                        print(f"🔹 Chunk #{chunk_count} | +{len(delta)} chars | Total: {current_length} | '{preview}...'", file=sys.stderr)
                                        sys.stderr.flush()
                                        
                                        yield {"text": delta}
                                        last_text_length = current_length
                        
                        # Lấy IDs
                        if len(inner_data) >= 2:
                            cid_arr = inner_data[1]
                            if cid_arr and len(cid_arr) > 0:
                                new_conv_id = cid_arr[0]

                        if len(inner_data) >= 5 and inner_data[4]:
                            first_cand = inner_data[4][0]
                            if first_cand:
                                new_resp_id = first_cand[0]
                                if len(first_cand) > 4:
                                    new_cand_id = first_cand[4]
                                    
            except (json.JSONDecodeError, UnicodeDecodeError, IndexError, KeyError):
                pass
    
    print(f"\n🔍 Stream Stats: {line_count} lines, {chunk_count} chunks, {last_text_length} chars total", file=sys.stderr)
    sys.stderr.flush()
    
    # Kết thúc stream
    yield {
        "context": {
            "conv_id": new_conv_id,
            "resp_id": new_resp_id,
            "cand_id": new_cand_id
        }
    }

def stream_gemini_httpx(prompt_text, conv_id="", resp_id="", cand_id=""):
    """
    Stream thực sự với httpx - KHÔNG buffer!
    """
    if not COOKIE_VALUE or not AT_TOKEN:
        yield {"error": "Thiếu token hoặc cookie"}
        return

    url = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
    
    headers = {
        "Host": "gemini.google.com",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://gemini.google.com",
        "Referer": "https://gemini.google.com/",
        "Cookie": COOKIE_VALUE
    }

    params = {
        "bl": BL,
        "_reqid": str(int(REQ_ID) + 100), 
        "rt": "c",
        "f.sid": F_SID,
        "hl": HL
    }

    req_payload = json.dumps([
        [prompt_text],
        None,
        [conv_id, resp_id, cand_id] 
    ])
    
    f_req = json.dumps([None, req_payload])

    data = {
        "f.req": f_req,
        "at": AT_TOKEN
    }

    print(f"\n🚀 Đang gửi (HTTPX Stream): '{prompt_text[:50]}...'")
    
    try:
        start_time = time.time()
        
        # Timeout dài hơn cho streaming
        with httpx.Client(timeout=httpx.Timeout(60.0, read=60.0)) as client:
            with client.stream("POST", url, headers=headers, params=params, data=data) as response:
                print(f"📡 Response Status: {response.status_code}")
                
                if response.status_code != 200:
                    error_body = response.text[:500]
                    print(f"❌ Error Body: {error_body}")
                    yield {"error": f"Status Code: {response.status_code}"}
                    return
                
                # Stream với chunk_size lớn hơn để tránh timeout
                result_count = 0
                
                # DEBUG: Lưu raw response
                raw_file = open("test/raw_response.txt", "wb")
                for chunk in response.iter_bytes(chunk_size=1024):
                    raw_file.write(chunk)
                raw_file.close()
                print("✅ Đã lưu raw response vào test/raw_response.txt", file=sys.stderr)
                
                # Parse lại từ file
                with open("test/raw_response.txt", "rb") as f:
                    raw_bytes = f.read()
                
                for result in parse_gemini_stream_raw([raw_bytes]):
                    result_count += 1
                    yield result
        
        elapsed = time.time() - start_time
        print(f"\n📊 Processed {result_count} results in {elapsed:.2f}s", file=sys.stderr)

    except Exception as e:
        print(f"💥 Exception: {type(e).__name__}: {e}")
        yield {"error": str(e)}

# --- MAIN ---
if __name__ == "__main__":
    # Fix Windows console encoding
    if sys.platform == 'win32':
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    
    print(f"[*] HTTPX RAW STREAMING TEST")
    
    ctx = {"conv_id": "", "resp_id": "", "cand_id": ""}
    
    # Đọc từ file
    try:
        with open("test/text.txt", "r", encoding="utf-8") as f:
            text_content = f.read().strip()
        if not text_content:
            text_content = "Hãy đóng vai một con mèo và kêu meo meo."
        msg1 = f"Dịch sang tiếng Việt:\n\n{text_content}"
    except FileNotFoundError:
        msg1 = "Hãy đóng vai một con mèo và kêu meo meo."
    
    print("-" * 60)
    
    for part in stream_gemini_httpx(msg1, **ctx):
        if "text" in part:
            print(part["text"], end="", flush=True)
        elif "context" in part:
            ctx = part["context"]
            print(f"\n\n✅ [Context]: {ctx}", file=sys.stderr)
            sys.stderr.flush()
        elif "error" in part:
            print(f"\n❌ Error: {part['error']}")
