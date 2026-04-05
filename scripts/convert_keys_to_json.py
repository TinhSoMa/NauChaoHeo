"""
Script chuyển đổi file TXT chứa email và API keys sang format JSON cho gemini_keys.json

Format file TXT đầu vào:
- Dòng 1: email
- Dòng 2-6: 5 API keys (bắt đầu với AIzaSy)
- Dòng 7: email tiếp theo
- ...lặp lại

Cách sử dụng:
    python convert_keys_to_json.py input.txt output.json
    hoặc
    python convert_keys_to_json.py input.txt  (sẽ ghi đè gemini_keys.json)
"""

import json
import sys
import os

def parse_keys_file(input_file: str) -> list:
    """
    Đọc file TXT và parse thành danh sách accounts
    """
    accounts = []
    
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = [line.strip() for line in f.readlines() if line.strip()]
    
    i = 0
    account_count = 0
    
    while i < len(lines):
        # Đọc email (dòng chứa @ là email)
        if '@' in lines[i]:
            email = lines[i]
            projects = []
            
            # Đọc 5 API keys tiếp theo
            for j in range(1, 6):
                if i + j < len(lines) and lines[i + j].startswith('AIzaSy'):
                    projects.append({
                        "projectName": f"Project {j}",
                        "apiKey": lines[i + j]
                    })
            
            if projects:
                account_count += 1
                accounts.append({
                    "email": email,
                    "projects": projects
                })
                print(f"✓ Đã parse account {account_count}: {email} với {len(projects)} projects")
            
            # Di chuyển đến email tiếp theo (bỏ qua 5 API keys)
            i += 6
        else:
            i += 1
    
    return accounts

def main():
    # Xác định đường dẫn mặc định
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    default_output = os.path.join(project_dir, 'gemini_keys.json')
    
    # Parse arguments
    if len(sys.argv) < 2:
        print("=" * 50)
        print("Script Chuyển Đổi API Keys sang JSON")
        print("=" * 50)
        print("\nCách sử dụng:")
        print("  python convert_keys_to_json.py <input.txt> [output.json]")
        print("\nVí dụ:")
        print("  python convert_keys_to_json.py keys.txt")
        print("  python convert_keys_to_json.py keys.txt gemini_keys.json")
        print("\nFormat file TXT đầu vào:")
        print("  email1@example.com")
        print("  AIzaSy...")
        print("  AIzaSy...")
        print("  AIzaSy...")
        print("  AIzaSy...")
        print("  AIzaSy...")
        print("  email2@example.com")
        print("  ...")
        return
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else default_output
    
    # Kiểm tra file đầu vào
    if not os.path.exists(input_file):
        print(f"❌ Lỗi: Không tìm thấy file '{input_file}'")
        return
    
    print(f"\n📖 Đang đọc file: {input_file}")
    print("-" * 50)
    
    # Parse file
    accounts = parse_keys_file(input_file)
    
    if not accounts:
        print("❌ Không tìm thấy account nào trong file!")
        return
    
    print("-" * 50)
    print(f"📊 Tổng cộng: {len(accounts)} accounts")
    
    # Ghi ra file JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(accounts, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Đã ghi thành công vào: {output_file}")
    
    # Hiển thị preview
    print("\n📋 Preview JSON:")
    print("-" * 50)
    for acc in accounts[:2]:
        print(f"  Email: {acc['email']}")
        print(f"  Projects: {len(acc['projects'])}")
        if acc['projects']:
            print(f"    - {acc['projects'][0]['projectName']}: {acc['projects'][0]['apiKey'][:15]}...")
        print()
    if len(accounts) > 2:
        print(f"  ... và {len(accounts) - 2} accounts nữa")

if __name__ == "__main__":
    main()
