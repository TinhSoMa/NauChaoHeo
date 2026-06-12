
import time
from pathlib import Path

from llama_cpp import Llama

BASE_DIR = Path(__file__).resolve().parent
# MODEL_PATH = Path(r"D:\NauChaoHeo\resources\gemma\google_gemma-4-E2B-it-Q4_K_M.gguf")
MODEL_PATH = Path(r"D:\NauChaoHeo\resources\gemma\google_gemma-4-E2B-it-Q2_K_L.gguf")
PROMPT_PATH = BASE_DIR / "promt.txt"

# Force GPU offload from code (adjust this number if VRAM is limited).
n_gpu_layers = 8

llm = Llama(
	model_path=str(MODEL_PATH),
    n_ctx=8192,
	n_gpu_layers=n_gpu_layers,
	n_threads=8,
	verbose=False,
)

# Read prompt as raw text even if it looks like JSON.
raw_prompt_text = PROMPT_PATH.read_text(encoding="utf-8")
prompt_text = " ".join(raw_prompt_text.split())

start_time = time.perf_counter()

response = llm.create_chat_completion(
	messages=[
		{
			"role": "user",
			"content": prompt_text,
		}
	],
	temperature=1.0,
	top_p=0.95,
	top_k=64,
	max_tokens=384,
)

elapsed_seconds = time.perf_counter() - start_time

print(response["choices"][0]["message"]["content"])
print(f"\nThoi gian phan hoi: {elapsed_seconds:.2f} giay")