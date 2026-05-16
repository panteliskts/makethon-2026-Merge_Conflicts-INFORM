"""Builds inform_ocr_pipeline.ipynb — INFORM FinDoc AI OCR/extraction notebook for Kaggle."""
import json, os

cells = []

def md(text):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": text.splitlines(keepends=True)})

def code(text):
    cells.append({"cell_type": "code", "metadata": {}, "execution_count": None,
                  "outputs": [], "source": text.strip("\n").splitlines(keepends=True)})

# ---------------------------------------------------------------- C1
md(r"""# INFORM FinDoc AI — OCR Extraction & Knowledgebase Pipeline

Makeathon 2026 · team *Merge Conflicts* · Challenge by INFORM

This notebook **builds and compiles the model** that the backend runs on demand, and
**populates the ChromaDB knowledgebase** the RAG app reads.

**Pipeline:** datasets → unified schema → fine-tune LayoutLMv3 → `extract_invoice()` →
context summaries → embeddings → ChromaDB.

### How to run on Kaggle
1. *Settings → Accelerator → GPU* (T4 is enough).
2. *Settings → Internet → On* (needed for pip, model download, Gemini).
3. Attach datasets: **sroie-datasetv2** (`urbikn/sroie-datasetv2`),
   **invoice-ocr** (`senju14/invoice-ocr`),
   **high-quality-invoice-images-for-ocr** (`osamahosamabdellatif/...`).
   CORD v2 is pulled from Hugging Face automatically.
4. Add a Kaggle Secret named `GEMINI_API_KEY` (*Add-ons → Secrets*).
5. *Run All*. Artifacts land in `/kaggle/working/`.

### Outputs
- `layoutlmv3-invoice.zip` — trained model the backend loads.
- `chroma_db.zip` — pre-populated knowledgebase.
- `inference.py` — the `extract_invoice` module for the backend.
""")

# ---------------------------------------------------------------- C2
md("## 1 · Setup")
code(r"""
# Tesseract OCR engine + Python dependencies
import subprocess, sys
subprocess.run("apt-get -qq update && apt-get -qq install -y tesseract-ocr", shell=True)

def pip(pkgs):
    subprocess.run([sys.executable, "-m", "pip", "install", "-q"] + pkgs.split(), check=False)

pip("transformers==4.44.2 datasets==2.21.0 seqeval pytesseract")
pip("chromadb google-generativeai pillow pyarrow")
print("dependencies installed")
""")

# ---------------------------------------------------------------- C3
code(r"""
import os, json, glob, re, random, io, zipfile, shutil
import numpy as np
from PIL import Image, ImageDraw
import torch

random.seed(42); np.random.seed(42); torch.manual_seed(42)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print("device:", DEVICE)

# --- locate attached datasets (Kaggle mounts them under /kaggle/input) ---
def find_dir(*keywords):
    for root in glob.glob("/kaggle/input/*"):
        name = os.path.basename(root).lower()
        if all(k in name for k in keywords):
            return root
    return None

print("Attached input folders:")
for root in sorted(glob.glob("/kaggle/input/*")):
    print("  ", root)

SROIE_DIR   = find_dir("sroie")
INVOICE_DIR = find_dir("invoice", "ocr") or find_dir("invoice")
HQ_DIR      = find_dir("high", "quality")
print("\nSROIE:      ", SROIE_DIR)
print("invoice-ocr:", INVOICE_DIR)
print("HQ invoice: ", HQ_DIR)
if SROIE_DIR is None:
    print("\nWARNING: SROIE not found. Attach 'urbikn/sroie-datasetv2' via "
          "Add Input. Training falls back to CORD only.")

WORK = "/kaggle/working"
os.makedirs(WORK, exist_ok=True)

# --- run-size knobs (raise for a fuller run) ---
MAX_SROIE   = None   # None = all
MAX_CORD    = 800
NUM_EPOCHS  = 5
MAX_KB_DOCS = 60     # documents pushed into ChromaDB
""")

# ---------------------------------------------------------------- C4
md(r"""## 2 · Label space & helpers

All four datasets are normalised to one schema — `{image, words[], boxes[], labels[]}` —
with a BIO tag set over the INFORM entity space.""")
code(r"""
ENTITIES = ["COMPANY", "DATE", "ADDRESS", "INVOICE_NO",
            "SUBTOTAL", "TAX", "TOTAL",
            "ITEM_NAME", "ITEM_QTY", "ITEM_PRICE"]

LABELS = ["O"] + [f"{p}-{e}" for e in ENTITIES for p in ("B", "I")]
label2id = {l: i for i, l in enumerate(LABELS)}
id2label = {i: l for l, i in label2id.items()}
print(len(LABELS), "labels")

def norm(s):
    return re.sub(r"\s+", " ", str(s).strip().lower())

def quad_to_bbox(coords):
    xs, ys = coords[0::2], coords[1::2]
    return [min(xs), min(ys), max(xs), max(ys)]

def normalize_box(box, w, h):
    # LayoutLMv3 expects integer coords on a 0-1000 grid
    return [
        max(0, min(1000, int(1000 * box[0] / max(w, 1)))),
        max(0, min(1000, int(1000 * box[1] / max(h, 1)))),
        max(0, min(1000, int(1000 * box[2] / max(w, 1)))),
        max(0, min(1000, int(1000 * box[3] / max(h, 1)))),
    ]

def split_line_to_words(text, box):
    # SROIE boxes are line-level; spread the line box across its words by char length
    words = text.split()
    if not words:
        return [], []
    x0, y0, x1, y1 = box
    span = max(x1 - x0, 1.0)
    total = sum(len(w) for w in words)
    out_w, out_b, cur = [], [], x0
    for w in words:
        wx1 = cur + span * (len(w) / max(total, 1))
        out_w.append(w)
        out_b.append([cur, y0, wx1, y1])
        cur = wx1
    return out_w, out_b

def token_overlap(a, b):
    sa, sb = set(a.split()), set(b.split())
    return len(sa & sb) / max(len(sa | sb), 1)

def to_bio(words, boxes, line_labels):
    # line_labels: one entity (or "O") per word; convert to BIO
    out, prev = [], None
    for lab in line_labels:
        if lab == "O":
            out.append("O"); prev = None
        elif lab == prev:
            out.append(f"I-{lab}")
        else:
            out.append(f"B-{lab}"); prev = lab
    return out
""")

# ---------------------------------------------------------------- C5
md("## 3 · Dataset parsers → unified schema")
code(r"""
def parse_sroie(split):
    # split in {"train","test"}; returns list of unified docs
    if SROIE_DIR is None:
        return []
    base = None
    for cand in [os.path.join(SROIE_DIR, "SROIE2019", split),
                 os.path.join(SROIE_DIR, split)]:
        if cand and os.path.isdir(os.path.join(cand, "img")):
            base = cand; break
    if base is None:
        print("SROIE", split, "not found"); return []

    docs = []
    for img_path in sorted(glob.glob(os.path.join(base, "img", "*.jpg"))):
        stem = os.path.splitext(os.path.basename(img_path))[0]
        box_f = os.path.join(base, "box", stem + ".txt")
        ent_f = os.path.join(base, "entities", stem + ".json")
        if not os.path.exists(box_f):
            continue
        entities = json.load(open(ent_f)) if os.path.exists(ent_f) else {}
        words, boxes, labels = [], [], []
        for line in open(box_f, encoding="utf-8", errors="ignore"):
            parts = line.rstrip("\n").split(",", 8)
            if len(parts) < 9:
                continue
            coords = [float(p) for p in parts[:8]]
            text = parts[8]
            bbox = quad_to_bbox(coords)
            # decide the line's entity by matching against SROIE ground-truth
            t, lab = norm(text), "O"
            for key, ent in [("company", "COMPANY"), ("address", "ADDRESS"),
                             ("date", "DATE"), ("total", "TOTAL")]:
                v = norm(entities.get(key, ""))
                if v and (v in t or token_overlap(t, v) > 0.6):
                    lab = ent; break
            lw, lb = split_line_to_words(text, bbox)
            words += lw; boxes += lb; labels += [lab] * len(lw)
        if words:
            docs.append({"image_path": img_path, "words": words,
                         "boxes": boxes, "labels": to_bio(words, boxes, labels),
                         "source": f"sroie_{stem}.jpg", "entities": entities})
    return docs

sroie_train = parse_sroie("train")
sroie_test  = parse_sroie("test")
if MAX_SROIE:
    sroie_train = sroie_train[:MAX_SROIE]
print("SROIE train/test docs:", len(sroie_train), len(sroie_test))
""")

# ---------------------------------------------------------------- C6
code(r"""
# CORD v2 — pulled from Hugging Face; gives line-item level labels
CORD_CAT = {
    "menu.nm": "ITEM_NAME", "menu.cnt": "ITEM_QTY", "menu.num": "ITEM_QTY",
    "menu.price": "ITEM_PRICE", "menu.unitprice": "ITEM_PRICE",
    "menu.discountprice": "ITEM_PRICE",
    "sub_total.subtotal_price": "SUBTOTAL", "sub_total.tax_price": "TAX",
    "total.total_price": "TOTAL", "total.cashprice": "TOTAL",
}

def parse_cord(limit):
    try:
        from datasets import load_dataset
        ds = load_dataset("naver-clova-ix/cord-v2")
    except Exception as e:
        print("CORD unavailable, skipping:", e)
        return [], []

    def convert(split, cap):
        out = []
        for i, row in enumerate(ds[split]):
            if cap and i >= cap:
                break
            img = row["image"].convert("RGB")
            gt = json.loads(row["ground_truth"])
            words, boxes, labels = [], [], []
            for ln in gt.get("valid_line", []):
                lab = CORD_CAT.get(ln.get("category", ""), "O")
                for wd in ln.get("words", []):
                    q = wd.get("quad", {})
                    txt = wd.get("text", "").strip()
                    if not txt:
                        continue
                    coords = [q.get("x1",0),q.get("y1",0),q.get("x2",0),q.get("y2",0),
                              q.get("x3",0),q.get("y3",0),q.get("x4",0),q.get("y4",0)]
                    words.append(txt); boxes.append(quad_to_bbox(coords))
                    labels.append(lab)
            if words:
                p = f"{WORK}/_cord_{split}_{i}.png"
                img.save(p)
                out.append({"image_path": p, "words": words, "boxes": boxes,
                            "labels": to_bio(words, boxes, labels),
                            "source": f"cord_{split}_{i}.png", "entities": {}})
        return out

    return convert("train", limit), convert("test", max(1, limit // 8))

cord_train, cord_test = parse_cord(MAX_CORD)
print("CORD train/test docs:", len(cord_train), len(cord_test))
""")

# ---------------------------------------------------------------- C7
code(r"""
train_docs = sroie_train + cord_train
test_docs  = sroie_test  + cord_test
random.shuffle(train_docs)
print(f"unified training docs: {len(train_docs)} | test docs: {len(test_docs)}")

# label distribution sanity check
from collections import Counter
dist = Counter(l for d in train_docs for l in d["labels"])
for l in LABELS:
    if dist.get(l):
        print(f"  {l:14s} {dist[l]}")
assert train_docs, "no training data found - check that datasets are attached"
""")

# ---------------------------------------------------------------- C8
md("## 4 · Fine-tune LayoutLMv3")
code(r"""
from transformers import (LayoutLMv3Processor, LayoutLMv3ForTokenClassification,
                          TrainingArguments, Trainer)
from datasets import Dataset

CKPT = "microsoft/layoutlmv3-base"
processor = LayoutLMv3Processor.from_pretrained(CKPT, apply_ocr=False)

def encode(batch):
    images, words, boxes, labels = [], [], [], []
    for path, w, b, l in zip(batch["image_path"], batch["words"],
                             batch["boxes"], batch["labels"]):
        img = Image.open(path).convert("RGB")
        W, H = img.size
        images.append(img)
        words.append(w)
        boxes.append([normalize_box(bx, W, H) for bx in b])
        labels.append([label2id[x] for x in l])
    enc = processor(images, words, boxes=boxes, word_labels=labels,
                    truncation=True, padding="max_length", max_length=512)
    return enc

def make_ds(docs):
    d = Dataset.from_list([{k: doc[k] for k in
                            ("image_path", "words", "boxes", "labels")} for doc in docs])
    return d.map(encode, batched=True, batch_size=8,
                 remove_columns=d.column_names)

train_ds = make_ds(train_docs)
eval_ds  = make_ds(test_docs) if test_docs else None
train_ds.set_format("torch")
if eval_ds:
    eval_ds.set_format("torch")
print("encoded train examples:", len(train_ds))
""")

# ---------------------------------------------------------------- C9
code(r"""
import seqeval.metrics as sq

model = LayoutLMv3ForTokenClassification.from_pretrained(
    CKPT, num_labels=len(LABELS), id2label=id2label, label2id=label2id)

def compute_metrics(p):
    preds = np.argmax(p.predictions, axis=2)
    true_pred, true_lab = [], []
    for pr, la in zip(preds, p.label_ids):
        tp, tl = [], []
        for pi, li in zip(pr, la):
            if li != -100:
                tp.append(id2label[int(pi)]); tl.append(id2label[int(li)])
        true_pred.append(tp); true_lab.append(tl)
    return {"precision": sq.precision_score(true_lab, true_pred),
            "recall": sq.recall_score(true_lab, true_pred),
            "f1": sq.f1_score(true_lab, true_pred)}

args = TrainingArguments(
    output_dir=f"{WORK}/_ckpt",
    per_device_train_batch_size=2,
    per_device_eval_batch_size=2,
    num_train_epochs=NUM_EPOCHS,
    learning_rate=5e-5,
    eval_strategy="epoch" if eval_ds else "no",
    save_strategy="no",
    logging_steps=50,
    fp16=(DEVICE == "cuda"),
    report_to="none",
)

trainer = Trainer(model=model, args=args, train_dataset=train_ds,
                  eval_dataset=eval_ds, compute_metrics=compute_metrics)
trainer.train()
""")

# ---------------------------------------------------------------- C10
code(r"""
# Per-entity evaluation report
if eval_ds:
    pred = trainer.predict(eval_ds)
    preds = np.argmax(pred.predictions, axis=2)
    tp, tl = [], []
    for pr, la in zip(preds, pred.label_ids):
        a, b = [], []
        for pi, li in zip(pr, la):
            if li != -100:
                a.append(id2label[int(pi)]); b.append(id2label[int(li)])
        tp.append(a); tl.append(b)
    print(sq.classification_report(tl, tp))

# Save the compiled model + processor — this is the backend artifact
MODEL_DIR = f"{WORK}/layoutlmv3-invoice"
model.save_pretrained(MODEL_DIR)
processor.save_pretrained(MODEL_DIR)
print("model saved to", MODEL_DIR)
""")

# ---------------------------------------------------------------- C11
md(r"""## 5 · `extract_invoice` — the backend inference module

Written with `%%writefile` so the exact code becomes the `inference.py` artifact.
It is self-contained: OCR → LayoutLMv3 → grouped fields + a bounding box per item.""")
code(r"""%%writefile /kaggle/working/inference.py
# INFORM FinDoc AI - invoice/receipt extraction module.
# Loaded by the backend on demand; no external API calls at request time.
import re
import pytesseract
import torch
from PIL import Image
from transformers import LayoutLMv3Processor, LayoutLMv3ForTokenClassification

_MODEL = None
_PROC = None
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def load_model(model_dir):
    # Call once at backend startup.
    global _MODEL, _PROC
    _PROC = LayoutLMv3Processor.from_pretrained(model_dir, apply_ocr=False)
    _MODEL = LayoutLMv3ForTokenClassification.from_pretrained(model_dir).to(_DEVICE)
    _MODEL.eval()
    return _MODEL


def _norm_box(b, w, h):
    return [max(0, min(1000, int(1000 * b[0] / max(w, 1)))),
            max(0, min(1000, int(1000 * b[1] / max(h, 1)))),
            max(0, min(1000, int(1000 * b[2] / max(w, 1)))),
            max(0, min(1000, int(1000 * b[3] / max(h, 1))))]


def ocr_words(image):
    # Tesseract word-level OCR -> (words, pixel boxes).
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    words, boxes = [], []
    for i, txt in enumerate(data["text"]):
        if txt.strip() and int(data["conf"][i]) > 0:
            x, y = data["left"][i], data["top"][i]
            words.append(txt.strip())
            boxes.append([x, y, x + data["width"][i], y + data["height"][i]])
    return words, boxes


def _union(boxes):
    xs0 = [b[0] for b in boxes]; ys0 = [b[1] for b in boxes]
    xs1 = [b[2] for b in boxes]; ys1 = [b[3] for b in boxes]
    return [min(xs0), min(ys0), max(xs1), max(ys1)]


def _group(words, boxes, labels):
    # Merge consecutive BIO tokens of the same entity into spans.
    spans, cur = [], None
    for w, b, lab in zip(words, boxes, labels):
        if lab == "O":
            if cur:
                spans.append(cur); cur = None
            continue
        prefix, ent = lab.split("-", 1)
        if cur and (prefix == "I" and cur["entity"] == ent):
            cur["words"].append(w); cur["boxes"].append(b)
        else:
            if cur:
                spans.append(cur)
            cur = {"entity": ent, "words": [w], "boxes": [b]}
    if cur:
        spans.append(cur)
    for s in spans:
        s["text"] = " ".join(s["words"])
        s["box"] = _union(s["boxes"])
    return spans


def extract_invoice(image_path, model_dir=None):
    # image_path: file path or PIL.Image. Returns structured fields + boxes.
    if _MODEL is None:
        load_model(model_dir or "layoutlmv3-invoice")
    image = Image.open(image_path).convert("RGB") if isinstance(image_path, str) \
        else image_path.convert("RGB")
    W, H = image.size
    words, px_boxes = ocr_words(image)
    if not words:
        return {"fields": {}, "field_boxes": {}, "line_items": [],
                "image_size": [W, H]}

    norm = [_norm_box(b, W, H) for b in px_boxes]
    enc = _PROC(image, words, boxes=norm, truncation=True,
                padding="max_length", max_length=512, return_tensors="pt")
    enc = {k: v.to(_DEVICE) for k, v in enc.items()}
    with torch.no_grad():
        logits = _MODEL(**enc).logits[0]
    pred_ids = logits.argmax(-1).tolist()
    id2label = _MODEL.config.id2label

    # map subword predictions back to the first token of each word
    word_labels, seen = [], set()
    enc2 = _PROC(image, words, boxes=norm, truncation=True,
                 padding="max_length", max_length=512)
    wids = enc2.word_ids()
    for tok_idx, wid in enumerate(wids):
        if wid is None or wid in seen:
            continue
        seen.add(wid)
        word_labels.append((wid, id2label[pred_ids[tok_idx]]))
    word_labels.sort()
    labels = ["O"] * len(words)
    for wid, lab in word_labels:
        if wid < len(words):
            labels[wid] = lab

    spans = _group(words, px_boxes, labels)

    fields, field_boxes, items = {}, {}, []
    item_parts = {"ITEM_NAME": [], "ITEM_QTY": [], "ITEM_PRICE": []}
    for s in spans:
        e = s["entity"]
        if e in item_parts:
            item_parts[e].append(s)
        elif e not in fields:
            fields[e] = s["text"]; field_boxes[e] = s["box"]

    # pair item spans by vertical proximity into line-item rows
    for name in item_parts["ITEM_NAME"]:
        cy = (name["box"][1] + name["box"][3]) / 2
        row = {"name": name["text"], "name_box": name["box"]}
        for key, fld in (("ITEM_QTY", "qty"), ("ITEM_PRICE", "price")):
            best, bd = None, 1e9
            for cand in item_parts[key]:
                ccy = (cand["box"][1] + cand["box"][3]) / 2
                if abs(ccy - cy) < bd:
                    bd, best = abs(ccy - cy), cand
            if best and bd < (name["box"][3] - name["box"][1]) * 1.5:
                row[fld] = best["text"]; row[fld + "_box"] = best["box"]
        row["box"] = _union([row["name_box"]] +
                            [row[k] for k in ("qty_box", "price_box") if k in row])
        items.append(row)

    return {"fields": fields, "field_boxes": field_boxes,
            "line_items": items, "words": words, "boxes": px_boxes,
            "word_labels": labels, "image_size": [W, H]}
""")

# ---------------------------------------------------------------- C12
md("## 6 · Demo — extraction with bounding boxes")
code(r"""
import importlib, sys
sys.path.insert(0, WORK)
import inference
importlib.reload(inference)
inference.load_model(MODEL_DIR)

import matplotlib.pyplot as plt

demo_path = test_docs[0]["image_path"] if test_docs else train_docs[0]["image_path"]
result = inference.extract_invoice(demo_path, MODEL_DIR)

print("FIELDS:")
for k, v in result["fields"].items():
    print(f"  {k:12s} {v}")
print("LINE ITEMS:")
for it in result["line_items"]:
    print(f"  {it.get('name','')!r:40s} qty={it.get('qty','-')} price={it.get('price','-')}")

img = Image.open(demo_path).convert("RGB")
draw = ImageDraw.Draw(img)
for k, box in result["field_boxes"].items():
    draw.rectangle(box, outline="red", width=3)
    draw.text((box[0], max(0, box[1] - 12)), k, fill="red")
for it in result["line_items"]:
    draw.rectangle(it["box"], outline="blue", width=2)
plt.figure(figsize=(9, 12)); plt.imshow(img); plt.axis("off"); plt.show()
""")

# ---------------------------------------------------------------- C13
md(r"""## 7 · Context summaries & ChromaDB knowledgebase

Each document becomes chunks matching the app's schema
(`text, page_num, x0..y1, source_file, chunk_type, chunk_index`).
Gemini condenses the *extracted fields* into one grounded `summary` chunk — extractive,
no new facts. Embeddings use `text-embedding-004`, the same model the app queries with.""")
code(r"""
import google.generativeai as genai

GEMINI_OK = False
try:
    from kaggle_secrets import UserSecretsClient
    key = UserSecretsClient().get_secret("GEMINI_API_KEY")
    genai.configure(api_key=key)
    GEMINI_OK = True
    print("Gemini configured")
except Exception as e:
    print("Gemini key not available - summaries will be extractive only:", e)

SUMM_MODEL = "gemini-2.0-flash"
EMBED_MODEL = "models/text-embedding-004"

def summarize(fields, items):
    facts = "; ".join(f"{k}={v}" for k, v in fields.items())
    facts += " | items: " + "; ".join(
        f"{it.get('name','')} x{it.get('qty','?')} @ {it.get('price','?')}"
        for it in items)
    if not GEMINI_OK:
        return "Invoice summary - " + facts
    prompt = ("Summarise this invoice in 2 plain sentences for a search index. "
              "Use ONLY these extracted facts, invent nothing:\n" + facts)
    try:
        return genai.GenerativeModel(SUMM_MODEL).generate_content(prompt).text.strip()
    except Exception as e:
        print("summary fallback:", e)
        return "Invoice summary - " + facts

def embed(texts):
    if not GEMINI_OK:
        # deterministic local fallback so the notebook still completes
        return [list(np.random.RandomState(abs(hash(t)) % 2**32).rand(768))
                for t in texts]
    out = []
    for t in texts:
        r = genai.embed_content(model=EMBED_MODEL, content=t,
                                task_type="retrieval_document")
        out.append(r["embedding"])
    return out
""")

# ---------------------------------------------------------------- C14
code(r"""
def build_chunks(source_file, result):
    # turn one extraction result into app-schema chunks
    f, fb = result["fields"], result["field_boxes"]
    W, H = result["image_size"]
    chunks, idx = [], 0

    def add(text, box, ctype):
        nonlocal idx
        if not text.strip():
            return
        chunks.append({"text": text, "page_num": 0,
                       "x0": box[0], "y0": box[1], "x1": box[2], "y1": box[3],
                       "source_file": source_file, "chunk_type": ctype,
                       "chunk_index": idx})
        idx += 1

    header = " ".join(f.get(k, "") for k in
                      ("COMPANY", "ADDRESS", "INVOICE_NO", "DATE")).strip()
    hbox = [fb[k] for k in ("COMPANY", "ADDRESS", "INVOICE_NO", "DATE") if k in fb]
    add(header, inference._union(hbox) if hbox else [0, 0, W, H], "header")

    for it in result["line_items"]:
        txt = f"{it.get('name','')} qty {it.get('qty','')} price {it.get('price','')}"
        add(txt, it["box"], "line_item")

    totals = " ".join(f"{k} {f[k]}" for k in ("SUBTOTAL", "TAX", "TOTAL") if k in f)
    tbox = [fb[k] for k in ("SUBTOTAL", "TAX", "TOTAL") if k in fb]
    add(totals, inference._union(tbox) if tbox else [0, 0, W, H], "totals")

    add(summarize(f, result["line_items"]), [0, 0, W, H], "summary")
    return chunks
""")

# ---------------------------------------------------------------- C15
code(r"""
import chromadb

CHROMA_DIR = f"{WORK}/chroma_db"
shutil.rmtree(CHROMA_DIR, ignore_errors=True)
client = chromadb.PersistentClient(path=CHROMA_DIR)
collection = client.get_or_create_collection(
    name="invoices", metadata={"hnsw:space": "cosine"})

kb_docs = (test_docs + train_docs)[:MAX_KB_DOCS]
total = 0
for d in kb_docs:
    try:
        res = inference.extract_invoice(d["image_path"], MODEL_DIR)
        chunks = build_chunks(d["source"], res)
        if not chunks:
            continue
        embs = embed([c["text"] for c in chunks])
        collection.upsert(
            ids=[f"{c['source_file']}_{c['chunk_index']}" for c in chunks],
            embeddings=embs,
            documents=[c["text"] for c in chunks],
            metadatas=[{k: c[k] for k in
                        ("page_num", "x0", "y0", "x1", "y1",
                         "source_file", "chunk_type", "chunk_index", "text")}
                       for c in chunks],
        )
        total += len(chunks)
    except Exception as e:
        print("skip", d["source"], "-", e)

print(f"knowledgebase: {collection.count()} chunks from {len(kb_docs)} documents")
""")

# ---------------------------------------------------------------- C16
md("## 8 · Package artifacts")
code(r"""
shutil.make_archive(f"{WORK}/layoutlmv3-invoice", "zip", MODEL_DIR)
shutil.make_archive(f"{WORK}/chroma_db", "zip", CHROMA_DIR)

print("Artifacts in /kaggle/working/:")
for name in ["layoutlmv3-invoice.zip", "chroma_db.zip", "inference.py"]:
    p = os.path.join(WORK, name)
    if os.path.exists(p):
        print(f"  {name:26s} {os.path.getsize(p) / 1e6:8.2f} MB")

print('''
Backend integration:
  1. Unzip layoutlmv3-invoice.zip into backend/models/layoutlmv3-invoice/
  2. Unzip chroma_db.zip into backend/chroma_db/
  3. Copy inference.py into backend/app/services/
  4. In /api/ingest, for image uploads call inference.extract_invoice()
     and feed build_chunks-style chunks to the existing embedder.
''')
""")

nb = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.10"},
        "accelerator": "GPU",
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}

out = "/home/panos/Hackathons/Makeathon/makethon-2026-Merge_Conflicts-INFORM/notebooks/inform_ocr_pipeline.ipynb"
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(nb, f, indent=1)
print("wrote", out, "-", len(cells), "cells")
