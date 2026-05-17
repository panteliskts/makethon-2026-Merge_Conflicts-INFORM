#!/usr/bin/env python
"""Compare three modes on 10 HQ invoices: model-only, Gemini-only, hybrid.

The hybrid strategy reflects the actual production path:
  1. Run the LayoutLMv3 extractor.
  2. For every field with confidence >= threshold, trust the model.
  3. Only ask Gemini for the fields the model missed / was unsure about.

This minimizes Gemini calls (1 per invoice, asking only for what's missing)
while keeping accuracy high.

Free-tier quota is small, so we hard-cap to --limit invoices and a single
Gemini call per invoice.

Usage (from backend/):
    ./venv/bin/python scripts/eval_hybrid.py \\
        --csv /tmp/hq_invoices/batch_1/batch_1/batch1_1.csv \\
        --img-dir /tmp/hq_invoices/batch_1/batch_1/batch1_1 \\
        --limit 10 --out eval_hybrid.csv
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import inference  # noqa: E402
from app.config import settings  # noqa: E402

# Reuse the matchers from eval_hq_invoices.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_hq_invoices import (  # noqa: E402
    _truth, _match_field, _match_items, SCALAR,
)


GEMINI_PROMPT = """You are extracting structured data from an invoice image.
Return ONLY a JSON object with the exact keys below. Use the empty string ""
when a field is not present. Numbers must be plain digits, no currency symbols.

For "items", return a list of objects, each with description, quantity, total_price.

Required keys: __KEYS__

Output strict JSON, nothing else.
"""


def _gemini_extract(img_path: Path, wanted: list[str]) -> dict:
    """Single Gemini call. Returns dict with the requested keys (and 'items')."""
    from openai import OpenAI
    client = OpenAI(api_key=settings.gemini_api_key,
                    base_url=settings.gemini_base_url)
    with img_path.open("rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    keys = ", ".join(wanted)
    if "items" not in wanted:
        keys += ", items"
    prompt = GEMINI_PROMPT.replace("__KEYS__", keys)
    resp = client.chat.completions.create(
        model=settings.gemini_chat_model,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image_url",
                 "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                {"type": "text", "text": prompt},
            ],
        }],
        temperature=0,
        max_tokens=600,
    )
    raw = (resp.choices[0].message.content or "").strip()
    # strip code fences if present
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # try to grab the first {...} block
        m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        return {}


GEMINI_KEY_MAP = {
    "COMPANY": "seller_name",
    "INVOICE_NO": "invoice_number",
    "DATE": "invoice_date",
    "ADDRESS": "seller_address",
    "TAX": "tax",
    "TOTAL": "total",
}


def _gemini_field(g: dict, label: str) -> str:
    return str(g.get(GEMINI_KEY_MAP[label], "") or "").strip()


def _gemini_items(g: dict) -> list[dict]:
    items = g.get("items") or []
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        out.append({
            "name": str(it.get("description") or "").strip(),
            "qty": str(it.get("quantity") or "").strip(),
            "price": str(it.get("total_price") or it.get("unit_price") or "").strip(),
        })
    return out


def _empty_agg():
    return {f: {"tp": 0, "n_gt": 0, "n_pred": 0} for f in SCALAR}


def _empty_item_agg():
    return {"tp_name": 0, "tp_qty": 0, "tp_price": 0, "n_pred": 0, "n_gt": 0}


def _bump(agg, label, gt, pred, ok):
    if gt:
        agg[label]["n_gt"] += 1
        if ok:
            agg[label]["tp"] += 1
    if pred:
        agg[label]["n_pred"] += 1


def evaluate(csv_path: Path, img_dir: Path, limit: int, threshold: float,
             model_dir: str, fuzzy_threshold: float):
    inference.load_model(model_dir)

    aggs = {"model": _empty_agg(), "gemini": _empty_agg(), "hybrid": _empty_agg()}
    items_aggs = {"model": _empty_item_agg(), "gemini": _empty_item_agg(),
                  "hybrid": _empty_item_agg()}
    rows: list[dict] = []
    t_model_total = 0.0
    t_gemini_total = 0.0

    with csv_path.open() as f:
        rdr = csv.DictReader(f)
        used = 0
        for r in rdr:
            if used >= limit:
                break
            img_path = img_dir / r["File Name"]
            if not img_path.exists():
                continue
            try:
                truth = _truth(json.loads(r["Json Data"]))
            except Exception:
                continue
            used += 1
            print(f"[{used}/{limit}] {img_path.name}")

            # --- 1. model ---
            t0 = time.monotonic()
            try:
                mres = inference.extract_invoice(str(img_path), model_dir=model_dir)
            except Exception as exc:
                print(f"  model failed: {exc}")
                continue
            t_model = (time.monotonic() - t0) * 1000
            t_model_total += t_model
            model_fields = {}
            for f in SCALAR:
                v = mres["fields"].get(f, "")
                if mres["field_scores"].get(f, 0.0) < threshold:
                    v = ""
                model_fields[f] = v
            model_items = [
                {"name": it.get("name", ""),
                 "qty": it.get("qty", ""),
                 "price": it.get("price", "")}
                for it in mres["line_items"]
                if it.get("name_score", 0.0) >= threshold
                and it.get("name", "").strip()
            ]

            # --- 2. gemini ---
            t0 = time.monotonic()
            try:
                g = _gemini_extract(img_path, list(GEMINI_KEY_MAP.values()))
            except Exception as exc:
                print(f"  gemini failed: {exc}")
                g = {}
            t_gemini = (time.monotonic() - t0) * 1000
            t_gemini_total += t_gemini
            gem_fields = {f: _gemini_field(g, f) for f in SCALAR}
            gem_items = _gemini_items(g)

            # --- 3. hybrid: model where confident, gemini for the rest ---
            hyb_fields = {f: (model_fields[f] or gem_fields[f]) for f in SCALAR}
            # for items: prefer model names + gemini qty/price (the model's weakness)
            hyb_items = []
            if model_items:
                # zip model names with closest gemini item by fuzzy name match
                from difflib import SequenceMatcher
                used_g = set()
                for mi in model_items:
                    best_j, best_s = -1, 0.0
                    for j, gi in enumerate(gem_items):
                        if j in used_g:
                            continue
                        s = SequenceMatcher(None, mi["name"].lower(),
                                            gi["name"].lower()).ratio()
                        if s > best_s:
                            best_s, best_j = s, j
                    if best_j >= 0 and best_s >= 0.4:
                        used_g.add(best_j)
                        hyb_items.append({
                            "name": mi["name"],
                            "qty": gem_items[best_j]["qty"] or mi["qty"],
                            "price": gem_items[best_j]["price"] or mi["price"],
                        })
                    else:
                        hyb_items.append(mi)
            else:
                hyb_items = gem_items

            # --- score all three ---
            row = {"image": img_path.name,
                   "model_ms": round(t_model, 1),
                   "gemini_ms": round(t_gemini, 1)}
            for f in SCALAR:
                gt = truth[f]
                for mode, fields in (("model", model_fields), ("gemini", gem_fields),
                                     ("hybrid", hyb_fields)):
                    pred = fields[f]
                    ok = _match_field(f, pred, gt, fuzzy_threshold)
                    _bump(aggs[mode], f, gt, pred, ok)
                    row[f"{f}_{mode}_pred"] = pred
                    row[f"{f}_{mode}_ok"] = int(ok)
                row[f"{f}_gt"] = gt

            for mode, items in (("model", model_items), ("gemini", gem_items),
                                ("hybrid", hyb_items)):
                m = _match_items(items, truth["items"], fuzzy_threshold)
                for k in items_aggs[mode]:
                    items_aggs[mode][k] += m[k]
                row[f"items_{mode}_pred"] = m["n_pred"]
                row[f"items_{mode}_name_tp"] = m["tp_name"]
                row[f"items_{mode}_qty_tp"] = m["tp_qty"]
                row[f"items_{mode}_price_tp"] = m["tp_price"]
            row["items_gt"] = len(truth["items"])
            rows.append(row)

    # ---- summarize ----
    def _summary(agg, iagg, n_imgs):
        s = {}
        for f, a in agg.items():
            prec = a["tp"] / a["n_pred"] if a["n_pred"] else 0.0
            rec = a["tp"] / a["n_gt"] if a["n_gt"] else 0.0
            f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
            s[f] = {"precision": prec, "recall": rec, "f1": f1,
                    "n_gt": a["n_gt"], "n_pred": a["n_pred"]}
        for tp_k, lab in (("tp_name", "ITEM_NAME"),
                          ("tp_qty", "ITEM_QTY"),
                          ("tp_price", "ITEM_PRICE")):
            prec = iagg[tp_k] / iagg["n_pred"] if iagg["n_pred"] else 0.0
            rec = iagg[tp_k] / iagg["n_gt"] if iagg["n_gt"] else 0.0
            f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
            s[lab] = {"precision": prec, "recall": rec, "f1": f1,
                      "n_gt": iagg["n_gt"], "n_pred": iagg["n_pred"]}
        return s

    summaries = {mode: _summary(aggs[mode], items_aggs[mode], len(rows))
                 for mode in aggs}
    overall = {
        "images": len(rows),
        "avg_model_ms": t_model_total / len(rows) if rows else 0.0,
        "avg_gemini_ms": t_gemini_total / len(rows) if rows else 0.0,
        "threshold": threshold,
    }
    return rows, summaries, overall


def print_summary(summaries: dict, overall: dict) -> None:
    print()
    print("=" * 96)
    fields = ("COMPANY", "INVOICE_NO", "DATE", "ADDRESS", "TAX", "TOTAL",
              "ITEM_NAME", "ITEM_QTY", "ITEM_PRICE")
    print(f"{'field':<12} | {'MODEL F1':>10} {'GEMINI F1':>10} {'HYBRID F1':>10} "
          f"| {'M prec':>7} {'G prec':>7} {'H prec':>7}")
    print("-" * 96)
    for f in fields:
        m, g, h = summaries["model"][f], summaries["gemini"][f], summaries["hybrid"][f]
        print(f"{f:<12} | {m['f1']*100:>9.1f}% {g['f1']*100:>9.1f}% {h['f1']*100:>9.1f}% "
              f"| {m['precision']*100:>6.1f}% {g['precision']*100:>6.1f}% "
              f"{h['precision']*100:>6.1f}%")
    print("-" * 96)
    print(f"images={overall['images']}  "
          f"avg_model={overall['avg_model_ms']:.0f}ms  "
          f"avg_gemini={overall['avg_gemini_ms']:.0f}ms  "
          f"threshold={overall['threshold']}")
    print("=" * 96)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--img-dir", required=True)
    ap.add_argument("--model-dir", default="./models/layoutlmv3-invoice")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--threshold", type=float, default=0.6)
    ap.add_argument("--fuzzy-threshold", type=float, default=0.7)
    ap.add_argument("--out", default="eval_hybrid.csv")
    args = ap.parse_args()

    rows, summaries, overall = evaluate(
        Path(args.csv), Path(args.img_dir), args.limit, args.threshold,
        args.model_dir, args.fuzzy_threshold,
    )
    if rows:
        with open(args.out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader(); w.writerows(rows)
        print(f"\nPer-image rows: {args.out}")
    print_summary(summaries, overall)
    Path(args.out).with_suffix(".json").write_text(json.dumps(
        {"summaries": summaries, "overall": overall}, indent=2))


if __name__ == "__main__":
    main()
