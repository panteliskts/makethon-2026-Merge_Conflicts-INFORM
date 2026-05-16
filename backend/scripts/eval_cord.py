#!/usr/bin/env python
"""Evaluate the LayoutLMv3 invoice extractor on the CORD-v2 test set.

CORD is the dataset the model was actually trained on (the SROIE training stream
in the original notebook had a label-loading bug, so SROIE is unfit for eval).
This bypasses Gemini entirely: pure custom-model metrics.

Usage (from backend/):
    ./venv/bin/python scripts/eval_cord.py \\
        --parquet /home/panos/Hackathons/Makeathon/cord-v2/data/test-00000-of-00001-9c204eb3f4e11791.parquet \\
        --limit 50 \\
        --threshold 0.6 \\
        --out eval_cord_results.csv

Maps CORD's nested ground-truth (menu.nm, sub_total.tax_price, etc.) to our 6
CORD-relevant model labels (ITEM_NAME, ITEM_QTY, ITEM_PRICE, SUBTOTAL, TAX,
TOTAL) and computes per-field precision / recall / F1.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path

import pyarrow.parquet as pq
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import inference  # noqa: E402


def _norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s.,/-]", "", s)
    return s


def _fuzzy(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


_AMOUNT_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def _all_amounts(s: str) -> list[float]:
    """Return every plausible amount in a string (spans may contain noise)."""
    if not s:
        return []
    s = s.replace(" ", "")
    out: list[float] = []
    for m in _AMOUNT_RE.finditer(s):
        tok = m.group(0)
        # heuristic for european thousands separator
        if re.match(r"^-?\d{1,3}(?:\.\d{3})+,\d+$", tok):
            tok = tok.replace(".", "").replace(",", ".")
        else:
            tok = tok.replace(",", "")
        try:
            out.append(float(tok))
        except ValueError:
            pass
    return out


def _amount(s: str) -> float | None:
    amounts = _all_amounts(s)
    return amounts[0] if amounts else None


def _amount_match(pred: str, gt: str, tol: float = 0.5) -> bool:
    """True if the GT amount appears anywhere in the predicted span."""
    g = _amount(gt)
    if g is None:
        return False
    for p in _all_amounts(pred):
        if abs(p - g) <= tol:
            return True
    return False


def _flatten_menu(menu) -> list[dict]:
    """CORD's 'menu' is sometimes a dict (one item) and sometimes a list."""
    if menu is None:
        return []
    if isinstance(menu, dict):
        return [menu]
    if isinstance(menu, list):
        return [m for m in menu if isinstance(m, dict)]
    return []


def _scalar(v) -> str:
    """CORD GT fields are sometimes lists or dicts — coerce to a plain string."""
    if v is None:
        return ""
    if isinstance(v, list):
        v = v[0] if v else ""
    if isinstance(v, dict):
        # nested object — pick the first string-like value
        for x in v.values():
            if isinstance(x, str):
                v = x
                break
        else:
            v = ""
    return str(v).strip()


def _extract_truth(gt_parse: dict) -> dict:
    menu = _flatten_menu(gt_parse.get("menu"))
    items = []
    for m in menu:
        items.append({
            "name": _scalar(m.get("nm")),
            "qty": _scalar(m.get("cnt")),
            "price": _scalar(m.get("price") or m.get("itemsubtotal")),
        })
    sub = gt_parse.get("sub_total") or {}
    tot = gt_parse.get("total") or {}
    return {
        "items": items,
        "SUBTOTAL": _scalar(sub.get("subtotal_price")),
        "TAX": _scalar(sub.get("tax_price")),
        "TOTAL": _scalar(tot.get("total_price")),
    }


def _match_line_items(pred_items: list[dict], gt_items: list[dict]) -> dict:
    """Greedy 1-1 matching of predicted vs GT items by fuzzy name similarity.

    Returns counts: tp_name / tp_qty / tp_price / pred / gt.
    """
    matches = []
    for i, p in enumerate(pred_items):
        for j, g in enumerate(gt_items):
            score = _fuzzy(p.get("name", ""), g.get("name", ""))
            matches.append((score, i, j))
    matches.sort(reverse=True)
    used_p, used_g = set(), set()
    pairs = []
    for score, i, j in matches:
        if score < 0.5:
            break
        if i in used_p or j in used_g:
            continue
        used_p.add(i); used_g.add(j)
        pairs.append((i, j, score))

    tp_name = len(pairs)
    tp_qty = sum(1 for i, j, _ in pairs
                 if _amount_match(pred_items[i].get("qty", ""),
                                  gt_items[j].get("qty", ""), tol=0.01))
    tp_price = sum(1 for i, j, _ in pairs
                   if _amount_match(pred_items[i].get("price", ""),
                                    gt_items[j].get("price", ""), tol=0.5))
    return {
        "tp_name": tp_name, "tp_qty": tp_qty, "tp_price": tp_price,
        "n_pred": len(pred_items), "n_gt": len(gt_items),
    }


SCALAR_FIELDS = ("SUBTOTAL", "TAX", "TOTAL")


def evaluate(parquet_path: Path, limit: int, threshold: float,
             model_dir: str, fuzzy_threshold: float) -> tuple[list[dict], dict]:
    table = pq.read_table(parquet_path)
    n_rows = table.num_rows if not limit else min(limit, table.num_rows)
    inference.load_model(model_dir)

    rows: list[dict] = []
    agg = {f: {"tp": 0, "n_gt": 0, "n_pred": 0,
               "conf_correct": [], "conf_wrong": []} for f in SCALAR_FIELDS}
    item_agg = {"tp_name": 0, "tp_qty": 0, "tp_price": 0, "n_pred": 0, "n_gt": 0}
    t_total = 0.0

    for i in range(n_rows):
        gt_raw = table["ground_truth"][i].as_py()
        try:
            gt = json.loads(gt_raw).get("gt_parse", {})
        except Exception:
            continue
        truth = _extract_truth(gt)

        img_struct = table["image"][i].as_py()
        # parquet stores image as dict {bytes, path}
        if isinstance(img_struct, dict) and img_struct.get("bytes"):
            img = Image.open(io.BytesIO(img_struct["bytes"])).convert("RGB")
        else:
            continue

        t0 = time.monotonic()
        try:
            result = inference.extract_invoice(img, model_dir=model_dir)
        except Exception as exc:
            print(f"[{i+1}] extract failed: {exc}")
            continue
        dt = (time.monotonic() - t0) * 1000
        t_total += dt

        row = {"idx": i, "latency_ms": round(dt, 1)}

        # ---- scalar fields ----
        for f in SCALAR_FIELDS:
            gt_val = truth[f]
            pred_val = result["fields"].get(f, "")
            conf = float(result["field_scores"].get(f, 0.0))
            if conf < threshold:
                pred_val = ""
            correct = _amount_match(pred_val, gt_val, tol=0.5)
            row[f"{f}_gt"] = gt_val
            row[f"{f}_pred"] = pred_val
            row[f"{f}_conf"] = round(conf, 4)
            row[f"{f}_correct"] = int(correct)
            if gt_val:
                agg[f]["n_gt"] += 1
                if correct:
                    agg[f]["tp"] += 1
                    agg[f]["conf_correct"].append(conf)
                elif pred_val:
                    agg[f]["conf_wrong"].append(conf)
            if pred_val:
                agg[f]["n_pred"] += 1

        # ---- line items ----
        pred_items = []
        for it in result["line_items"]:
            if it.get("name_score", 0.0) < threshold:
                continue
            pred_items.append({
                "name": it.get("name", ""),
                "qty": it.get("qty", ""),
                "price": it.get("price", ""),
            })
        m = _match_line_items(pred_items, truth["items"])
        for k in item_agg:
            item_agg[k] += m[k]
        row["items_gt"] = m["n_gt"]
        row["items_pred"] = m["n_pred"]
        row["items_name_tp"] = m["tp_name"]
        row["items_qty_tp"] = m["tp_qty"]
        row["items_price_tp"] = m["tp_price"]

        rows.append(row)
        if (i + 1) % 10 == 0 or (i + 1) == n_rows:
            print(f"  processed {i+1}/{n_rows}  avg {t_total/(i+1):.0f} ms/img")

    # ---- summary ----
    summary = {}
    for f, a in agg.items():
        prec = a["tp"] / a["n_pred"] if a["n_pred"] else 0.0
        rec = a["tp"] / a["n_gt"] if a["n_gt"] else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        summary[f] = {
            "n_gt": a["n_gt"], "n_pred": a["n_pred"],
            "precision": prec, "recall": rec, "f1": f1,
            "mean_conf_correct": (sum(a["conf_correct"]) / len(a["conf_correct"])
                                  if a["conf_correct"] else 0.0),
            "mean_conf_wrong": (sum(a["conf_wrong"]) / len(a["conf_wrong"])
                                if a["conf_wrong"] else 0.0),
        }
    for tp_key, label in (("tp_name", "ITEM_NAME"),
                          ("tp_qty", "ITEM_QTY"),
                          ("tp_price", "ITEM_PRICE")):
        prec = item_agg[tp_key] / item_agg["n_pred"] if item_agg["n_pred"] else 0.0
        rec = item_agg[tp_key] / item_agg["n_gt"] if item_agg["n_gt"] else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        summary[label] = {
            "n_gt": item_agg["n_gt"], "n_pred": item_agg["n_pred"],
            "precision": prec, "recall": rec, "f1": f1,
        }
    summary["_overall"] = {
        "images": len(rows),
        "avg_latency_ms": t_total / len(rows) if rows else 0.0,
        "threshold": threshold,
    }
    return rows, summary


def print_summary(summary: dict) -> None:
    print()
    print("=" * 86)
    print(f"{'field':<12} {'n_gt':>5} {'n_pred':>6} {'prec':>7} "
          f"{'recall':>7} {'F1':>7} {'conf✓':>8} {'conf✗':>8}")
    print("-" * 86)
    for f in ("SUBTOTAL", "TAX", "TOTAL",
              "ITEM_NAME", "ITEM_QTY", "ITEM_PRICE"):
        s = summary[f]
        cc = s.get("mean_conf_correct", 0.0)
        cw = s.get("mean_conf_wrong", 0.0)
        print(f"{f:<12} {s['n_gt']:>5} {s['n_pred']:>6} "
              f"{s['precision']*100:>6.1f}% {s['recall']*100:>6.1f}% "
              f"{s['f1']*100:>6.1f}% {cc:>8.3f} {cw:>8.3f}")
    print("-" * 86)
    o = summary["_overall"]
    print(f"images={o['images']}  avg_latency={o['avg_latency_ms']:.0f}ms  "
          f"keep_threshold={o['threshold']}")
    print("=" * 86)
    print("Notes:")
    print(" - SUBTOTAL/TAX/TOTAL matched numerically (±0.50).")
    print(" - Line items matched greedily by fuzzy name similarity (≥0.5);")
    print("   qty matched exactly, price within ±0.50.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", required=True)
    ap.add_argument("--model-dir", default="./models/layoutlmv3-invoice")
    ap.add_argument("--limit", type=int, default=50,
                    help="0 = all rows")
    ap.add_argument("--threshold", type=float, default=0.6)
    ap.add_argument("--fuzzy-threshold", type=float, default=0.7)
    ap.add_argument("--out", default="eval_cord_results.csv")
    args = ap.parse_args()

    rows, summary = evaluate(
        Path(args.parquet), args.limit, args.threshold,
        args.model_dir, args.fuzzy_threshold,
    )
    if rows:
        with open(args.out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader(); w.writerows(rows)
        print(f"\nPer-image rows: {args.out}")
    print_summary(summary)
    Path(args.out).with_suffix(".json").write_text(json.dumps(summary, indent=2))
    print(f"Summary JSON: {Path(args.out).with_suffix('.json')}")


if __name__ == "__main__":
    main()
