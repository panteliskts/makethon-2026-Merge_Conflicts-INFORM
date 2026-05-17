# INFORM FinDoc AI - invoice/receipt extraction module.
# Tesseract OCR -> LayoutLMv3 token classifier -> structured fields + boxes.
# Loaded once at backend startup; no external calls at request time.
import logging
from pathlib import Path

import pytesseract
import torch
from PIL import Image
from transformers import LayoutLMv3Processor, LayoutLMv3ForTokenClassification

logger = logging.getLogger(__name__)

_MODEL = None
_PROC = None
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

_FIELD_LABELS = {
    "COMPANY", "DATE", "ADDRESS", "INVOICE_NO",
    "SUBTOTAL", "TAX", "TOTAL",
}
_ITEM_LABELS = {"ITEM_NAME", "ITEM_QTY", "ITEM_PRICE"}

# Entities whose value is numeric — when multiple spans share the entity, the
# label word ("Subtotal") and the value ("28,000") often both get tagged. We
# prefer the value-looking one for these.
_NUMERIC_ENTITIES = {"SUBTOTAL", "TAX", "TOTAL", "ITEM_PRICE", "ITEM_QTY"}

import re as _re
_NUM_RE = _re.compile(r"\d")
_AMOUNT_RE = _re.compile(r"\d[\d.,]*")
# Spans that are basically just numbers / percents / punctuation — these leak
# into ITEM_NAME when invoice rows have multiple amount columns.
_NUMERIC_ONLY_RE = _re.compile(r"^[\d\s.,%\-/$€£]+$")


def _value_score(entity: str, text: str, conf: float) -> float:
    """Higher = more likely to be the actual field VALUE (not a label word).

    For numeric entities we strongly prefer tokens that contain digits and look
    like an amount. For text entities we prefer the longer span + confidence.
    """
    if entity in _NUMERIC_ENTITIES:
        if _AMOUNT_RE.search(text):
            # length helps tie-break (a full amount beats a single digit)
            return 1000 + conf + min(len(text), 20) / 100
        if _NUM_RE.search(text):
            return 500 + conf
        return conf  # label word, lowest priority
    # text entities: prefer longer + confident
    return conf * 100 + len(text)


def load_model(model_dir: str, processor_src: str = "microsoft/layoutlmv3-base"):
    global _MODEL, _PROC
    if _MODEL is not None:
        return _MODEL
    model_dir = str(model_dir)
    try:
        _PROC = LayoutLMv3Processor.from_pretrained(model_dir, apply_ocr=False)
    except Exception:
        logger.warning("Falling back to base processor %s", processor_src)
        _PROC = LayoutLMv3Processor.from_pretrained(processor_src, apply_ocr=False)
    _MODEL = LayoutLMv3ForTokenClassification.from_pretrained(model_dir).to(_DEVICE)
    _MODEL.eval()
    logger.info("LayoutLMv3 invoice model loaded from %s on %s", model_dir, _DEVICE)
    return _MODEL


def is_loaded() -> bool:
    return _MODEL is not None


def _norm_box(b, w, h):
    return [max(0, min(1000, int(1000 * b[0] / max(w, 1)))),
            max(0, min(1000, int(1000 * b[1] / max(h, 1)))),
            max(0, min(1000, int(1000 * b[2] / max(w, 1)))),
            max(0, min(1000, int(1000 * b[3] / max(h, 1))))]


def ocr_words(image):
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


def _group(words, boxes, labels, scores):
    spans, cur = [], None
    for w, b, lab, sc in zip(words, boxes, labels, scores):
        if lab == "O":
            if cur:
                spans.append(cur); cur = None
            continue
        prefix, ent = lab.split("-", 1)
        if cur and (prefix == "I" and cur["entity"] == ent):
            cur["words"].append(w); cur["boxes"].append(b); cur["scores"].append(sc)
        else:
            if cur:
                spans.append(cur)
            cur = {"entity": ent, "words": [w], "boxes": [b], "scores": [sc]}
    if cur:
        spans.append(cur)
    for s in spans:
        s["text"] = " ".join(s["words"])
        s["box"] = _union(s["boxes"])
        s["score"] = float(sum(s["scores"]) / max(len(s["scores"]), 1))
    return spans


def extract_invoice(image, model_dir: str | None = None):
    """image: file path or PIL.Image. Returns structured fields + boxes + per-field confidence."""
    if _MODEL is None:
        load_model(model_dir or "layoutlmv3-invoice")
    if isinstance(image, (str, Path)):
        image = Image.open(str(image)).convert("RGB")
    else:
        image = image.convert("RGB")
    W, H = image.size
    words, px_boxes = ocr_words(image)
    if not words:
        return {"fields": {}, "field_boxes": {}, "field_scores": {},
                "line_items": [], "words": [], "boxes": [],
                "word_labels": [], "word_scores": [], "image_size": [W, H]}

    norm = [_norm_box(b, W, H) for b in px_boxes]
    enc = _PROC(image, words, boxes=norm, truncation=True,
                padding="max_length", max_length=512, return_tensors="pt")
    enc = {k: v.to(_DEVICE) for k, v in enc.items()}
    with torch.no_grad():
        logits = _MODEL(**enc).logits[0]
    probs = torch.softmax(logits, dim=-1)
    conf, pred_ids = probs.max(dim=-1)
    pred_ids = pred_ids.tolist()
    conf = conf.tolist()
    id2label = _MODEL.config.id2label

    enc2 = _PROC(image, words, boxes=norm, truncation=True,
                 padding="max_length", max_length=512)
    wids = enc2.word_ids()
    labels = ["O"] * len(words)
    scores = [0.0] * len(words)
    seen = set()
    for tok_idx, wid in enumerate(wids):
        if wid is None or wid in seen:
            continue
        seen.add(wid)
        if wid < len(words):
            labels[wid] = id2label[pred_ids[tok_idx]]
            scores[wid] = float(conf[tok_idx])

    spans = _group(words, px_boxes, labels, scores)

    fields, field_boxes, field_scores = {}, {}, {}
    _best: dict[str, float] = {}  # entity -> _value_score so far
    item_parts = {"ITEM_NAME": [], "ITEM_QTY": [], "ITEM_PRICE": []}
    for s in spans:
        e = s["entity"]
        if e in item_parts:
            item_parts[e].append(s)
        elif e in _FIELD_LABELS:
            vs = _value_score(e, s["text"], s["score"])
            if vs > _best.get(e, -1.0):
                _best[e] = vs
                fields[e] = s["text"]
                field_boxes[e] = s["box"]
                field_scores[e] = s["score"]

    # filter out numeric leakage in ITEM_NAME (e.g. "627,00 10% 689,70")
    item_parts["ITEM_NAME"] = [
        n for n in item_parts["ITEM_NAME"]
        if not _NUMERIC_ONLY_RE.match(n["text"].strip())
        and len(n["text"].strip()) >= 2
    ]

    items = []
    for name in item_parts["ITEM_NAME"]:
        cy = (name["box"][1] + name["box"][3]) / 2
        row = {"name": name["text"], "name_box": name["box"],
               "name_score": name["score"]}
        for key, fld in (("ITEM_QTY", "qty"), ("ITEM_PRICE", "price")):
            row_h = max(name["box"][3] - name["box"][1], 1)
            # prefer numeric-looking spans on the same row
            best, bd = None, 1e9
            for cand in item_parts[key]:
                if not _NUM_RE.search(cand["text"]):
                    continue
                ccy = (cand["box"][1] + cand["box"][3]) / 2
                if abs(ccy - cy) < bd:
                    bd, best = abs(ccy - cy), cand
            if best is None:
                # fall back to any candidate (label word) if no numeric one
                for cand in item_parts[key]:
                    ccy = (cand["box"][1] + cand["box"][3]) / 2
                    if abs(ccy - cy) < bd:
                        bd, best = abs(ccy - cy), cand
            if best and bd < row_h * 1.5:
                row[fld] = best["text"]
                row[fld + "_box"] = best["box"]
                row[fld + "_score"] = best["score"]
        boxes_for_union = [row["name_box"]] + [row[k] for k in ("qty_box", "price_box") if k in row]
        row["box"] = _union(boxes_for_union)
        items.append(row)

    return {"fields": fields, "field_boxes": field_boxes, "field_scores": field_scores,
            "line_items": items, "words": words, "boxes": px_boxes,
            "word_labels": labels, "word_scores": scores, "image_size": [W, H]}
