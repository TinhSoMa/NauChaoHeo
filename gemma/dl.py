import torch
from transformers import AutoProcessor, AutoModelForCausalLM

MODEL_ID = "google/gemma-4-E2B-it"

# Load model
processor = AutoProcessor.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    # dtype=torch.bfloat4,
    load_in_4bit=True,
    device_map="auto",
    llm_int8_enable_fp32_cpu_offload=True
)