"""
Fine-tune whisper on this app's own labelled voice notes (LoRA, so whisper-medium fits an 8 GB GPU).

Data: folders of `name.wav` + `name.txt` (the correct text), as `npm run stt:label` writes them. `name.skip`
files are left out. The 26 voice notes in eval/stt-samples are never trained on: they stay the test set.

Setup (once; CUDA build of torch, ~2.5 GB):

    python3 -m venv ~/whisper-train && . ~/whisper-train/bin/activate
    pip install torch --index-url https://download.pytorch.org/whl/cu124
    pip install "transformers>=4.45" peft accelerate safetensors numpy

Train (stop Ollama first so the GPU is free: `systemctl stop ollama` or `ollama stop <model>`):

    python -I src/application/services/agent/eval/train/train_whisper.py \
        --data uploads/stt-dataset --out uploads/stt-models/medium-finetuned/hf

Then the same path as any other model (see eval/stt-results/2026-10-20-persian-cv17.md):

    uploads/stt-models/conversion-env/bin/python -I uploads/stt-models/conversion-tools/convert_numpy.py \
        uploads/stt-models/medium-finetuned/hf uploads/stt-models/conversion-tools/whisper uploads/stt-models/medium-finetuned
    ~/whisper.cpp/build/bin/whisper-quantize uploads/stt-models/medium-finetuned/ggml-model.bin \
        uploads/stt-models/medium-finetuned/ggml-medium-finetuned-q5_0.bin q5_0
    npm run agent:eval-stt -- --models ggml-medium.bin,ggml-large-v3-q5_0.bin,<that file> --vad on

Adopt it (WHISPER_MODEL) only if it beats the current large-v3 on stt-samples, which it never saw.
"""

import argparse
import random
import wave
from pathlib import Path

import numpy as np
import torch
from peft import LoraConfig, get_peft_model
from transformers import WhisperForConditionalGeneration, WhisperProcessor

SAMPLE_RATE = 16_000
# whisper sees at most 30 s; the app's commands are a few seconds
MAX_SECONDS = 30


def read_wav(path: Path) -> np.ndarray:
    """16 kHz mono PCM16, as SpeechToTextService stores it (ffmpeg output)."""
    with wave.open(str(path), "rb") as audio:
        if audio.getframerate() != SAMPLE_RATE or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError(f"{path.name}: expected 16 kHz mono 16-bit wav")
        frames = audio.readframes(audio.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def load_samples(folders: list[str]) -> list[tuple[Path, str]]:
    samples = []
    for folder in folders:
        for wav in sorted(Path(folder).rglob("*.wav")):
            label = wav.with_suffix(".txt")
            if label.exists() and not wav.with_suffix(".skip").exists():
                text = label.read_text(encoding="utf-8").strip()
                if text:
                    samples.append((wav, text))
    return samples


def batches(items, size, shuffle):
    order = list(items)
    if shuffle:
        random.shuffle(order)
    for start in range(0, len(order), size):
        yield order[start : start + size]


def encode(processor, items, device):
    audio = [read_wav(path)[: SAMPLE_RATE * MAX_SECONDS] for path, _ in items]
    features = processor.feature_extractor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features
    # the tokenizer adds <|startoftranscript|><|fa|><|transcribe|><|notimestamps|> ... <|endoftext|>
    labels = processor.tokenizer([text for _, text in items], padding=True, return_tensors="pt")
    ids = labels.input_ids.masked_fill(labels.attention_mask.eq(0), -100)
    # the model is given the start token itself; the loss starts after it
    if (ids[:, 0] == processor.tokenizer.convert_tokens_to_ids("<|startoftranscript|>")).all():
        ids = ids[:, 1:]
    return features.to(device, dtype=torch.float16), ids.to(device)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", nargs="+", required=True, help="folders of name.wav + name.txt")
    parser.add_argument("--out", required=True, help="where the merged Hugging Face model is written")
    parser.add_argument("--base", default="openai/whisper-medium")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--accumulate", type=int, default=4, help="gradient accumulation (effective batch = batch x this)")
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--rank", type=int, default=32, help="LoRA rank")
    parser.add_argument("--holdout", type=float, default=0.1, help="share kept out of training to watch the loss")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("warning: no CUDA GPU found; training on CPU is very slow")

    samples = load_samples(args.data)
    if len(samples) < 20:
        raise SystemExit(f"only {len(samples)} labelled voice notes; label more with `npm run stt:label` first")
    random.shuffle(samples)
    held = max(1, int(len(samples) * args.holdout))
    holdout, train = samples[:held], samples[held:]
    print(f"{len(train)} to train on, {len(holdout)} held out")

    # slow tokenizer: it also writes vocab.json/merges.txt/added_tokens.json, which convert_numpy.py reads
    processor = WhisperProcessor.from_pretrained(args.base, language="fa", task="transcribe", use_fast=False)
    model = WhisperForConditionalGeneration.from_pretrained(args.base, torch_dtype=torch.float16).to(device)
    model.config.forced_decoder_ids = None
    model.generation_config.language = "fa"
    model.generation_config.task = "transcribe"
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()

    lora = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank * 2,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2"],
        bias="none",
    )
    model = get_peft_model(model, lora)
    # LoRA weights train in fp32 (the frozen base stays fp16) so small updates are not lost
    for parameter in model.parameters():
        if parameter.requires_grad:
            parameter.data = parameter.data.float()
    model.print_trainable_parameters()

    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=0.01)
    steps = args.epochs * ((len(train) + args.batch - 1) // args.batch) // args.accumulate
    scheduler = torch.optim.lr_scheduler.OneCycleLR(optimizer, max_lr=args.lr, total_steps=max(steps, 1), pct_start=0.1)
    scaler = torch.cuda.amp.GradScaler(enabled=device == "cuda")

    def holdout_loss():
        model.eval()
        total, count = 0.0, 0
        with torch.no_grad():
            for items in batches(holdout, args.batch, shuffle=False):
                features, labels = encode(processor, items, device)
                with torch.autocast(device_type=device, dtype=torch.float16, enabled=device == "cuda"):
                    total += model(input_features=features, labels=labels).loss.item() * len(items)
                count += len(items)
        model.train()
        return total / count

    best = holdout_loss()
    print(f"before training: held-out loss {best:.3f}")
    model.train()
    for epoch in range(1, args.epochs + 1):
        for step, items in enumerate(batches(train, args.batch, shuffle=True), start=1):
            features, labels = encode(processor, items, device)
            with torch.autocast(device_type=device, dtype=torch.float16, enabled=device == "cuda"):
                loss = model(input_features=features, labels=labels).loss / args.accumulate
            scaler.scale(loss).backward()
            if step % args.accumulate == 0:
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                if scheduler.last_epoch < scheduler.total_steps - 1:
                    scheduler.step()
        loss = holdout_loss()
        print(f"epoch {epoch}: held-out loss {loss:.3f}")
        # keep the best epoch only (a small dataset overfits quickly)
        if loss < best:
            best = loss
            model.save_pretrained(Path(args.out) / "lora")

    best_lora = Path(args.out) / "lora"
    if not best_lora.exists():
        raise SystemExit("held-out loss never improved; nothing written (more or cleaner data needed)")
    print(f"best held-out loss {best:.3f}; merging")
    base = WhisperForConditionalGeneration.from_pretrained(args.base, torch_dtype=torch.float16)
    from peft import PeftModel

    merged = PeftModel.from_pretrained(base, best_lora).merge_and_unload()
    # shards + model.safetensors.index.json: the layout convert_numpy.py reads
    merged.save_pretrained(args.out, safe_serialization=True, max_shard_size="500MB")
    processor.save_pretrained(args.out)
    print(f"written to {args.out}")


if __name__ == "__main__":
    main()
