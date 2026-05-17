#!/usr/bin/env python
"""Evaluate the LayoutLMv3 invoice extractor on the SROIE test set.

Usage (from backend/):
    ./venv/bin/python scripts/eval_sroie.py \
        --data /home/panos/Hackathons/Makeathon/sroie-v2/SROIE2019/test \
        --limit 100 \
        --threshold 0.6 \
        --out eval_sroie_results.csv

Reports per-field exact-match, fuzzy-match, and precision/recall/F1 across
COMPANY, DATE, ADDRESS, TOTAL — the four fields SROIE labels at the entity
level. Bypasses Gemini entirely: tests the trained model in isolation.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path

# Make `app` importable when run from backend/
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import inference  # noqa: E402

SROIE_TO_MODEL = {
    "company": "COMPANY",
    "date": "DATE",
    "address": "ADDRESS",
    "total": "TOTAL",
}


def _norm(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s.,/-]", "", s)
    return s


def _fuzzy(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


_AMOUNT_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def _parse_amount(s: str) -> float | None:
    if not s:
        return None
    s = s.replace(" ", "")
    # If looks like european (e.g. 1.234,56) -> swap separators
    if re.match(r"^-?\d{1,3}(?:\.\d{3})+,\d+$", s):
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    m = _AMOUNT_RE.search(s)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _date_match(pred: str, gt: str) -> bool:
    """Loose date equality: same digits in same order ignoring separators."""
    if not pred or not gt:
        return False
    p = re.sub(r"\D", "", pred)
    g = re.sub(r"\D", "", gt)
    return p == g and len(g) >= 6


def evaluate(data_dir: Path, limit: int, threshold: float, model_dir: str,
             fuzzy_threshold: float) -> tuple[list[dict], dict]:
    img_dir = data_dir / "img"
    ent_dir = data_dir / "entities"
    images = sorted(img_dir.glob("*.jpg")) + sorted(img_dir.glob("*.png"))
    if limit:
        images = images[:limit]

    inference.load_model(model_dir)

    rows: list[dict] = []
    t_total = 0.0
    for i, img_path in enumerate(images, 1):
        ent_path = ent_dir / (img_path.stem + ".txt")
        if not ent_path.exists():
            continue
        try:
            gt = json.loads(ent_path.read_text())
        except json.JSONDecodeError:
            continue

        t0 = time.monotonic()
        try:
            result = inference.extract_invoice(str(img_path), model_dir=model_dir)
        except Exception as exc:
            print(f"[{i}/{len(images)}] {img_path.name}: extraction failed: {exc}")
            continue
        dt = (time.monotonic() - t0) * 1000
        t_total += dt

        row = {"image": img_path.name, "latency_ms": round(dt, 1)}
        for gt_key, label in SROIE_TO_MODEL.items():
            gt_val = (gt.get(gt_key) or "").strip()
            pred_val = result["fields"].get(label, "")
            conf = result["field_scores"].get(label, 0.0)
            kept = conf >= threshold
            if not kept:
                pred_val = ""

            exact = int(_norm(pred_val) == _norm(gt_val) and gt_val != "")
            fuzzy = _fuzzy(pred_val, gt_val)
            fuzzy_ok = int(fuzzy >= fuzzy_threshold and gt_val != "")

            if gt_key == "total":
                pa, ga = _parse_amount(pred_val), _parse_amount(gt_val)
                numeric_ok = int(pa is not None and ga is not None and abs(pa - ga) < 0.01)
            elif gt_key == "date":
                numeric_ok = int(_date_match(pred_val, gt_val))
            else:
                numeric_ok = fuzzy_ok

            row[f"{gt_key}_gt"] = gt_val
            row[f"{gt_key}_pred"] = pred_val
            row[f"{gt_key}_conf"] = round(float(conf), 4)
            row[f"{gt_key}_exact"] = exact
            row[f"{gt_key}_fuzzy"] = round(fuzzy, 3)
            row[f"{gt_key}_correct"] = numeric_ok
        rows.append(row)

        if i % 10 == 0 or i == len(images):
            print(f"  processed {i}/{len(images)}  avg {t_total / i:.0f} ms/img")

    # Aggregate metrics per field.
    summary: dict[str, dict] = {}
    for gt_key in SROIE_TO_MODEL:
        n = sum(1 for r in rows if r.get(f"{gt_key}_gt"))
        tp = sum(r[f"{gt_key}_correct"] for r in rows if r.get(f"{gt_key}_gt"))
        predicted = sum(1 for r in rows if r.get(f"{gt_key}_pred"))
        exact = sum(r[f"{gt_key}_exact"] for r in rows if r.get(f"{gt_key}_gt"))
        precision = tp / predicted if predicted else 0.0
        recall = tp / n if n else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        conf_correct = [r[f"{gt_key}_conf"] for r in rows
                        if r.get(f"{gt_key}_gt") and r[f"{gt_key}_correct"]]
        conf_wrong = [r[f"{gt_key}_conf"] for r in rows
                      if r.get(f"{gt_key}_gt") and not r[f"{gt_key}_correct"]]
        summary[gt_key] = {
            "n_gt": n,
            "n_pred": predicted,
            "exact_acc": exact / n if n else 0.0,
            "fuzzy_acc": tp / n if n else 0.0,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "mean_conf_correct": sum(conf_correct) / len(conf_correct) if conf_correct else 0.0,
            "mean_conf_wrong": sum(conf_wrong) / len(conf_wrong) if conf_wrong else 0.0,
        }
    summary["_overall"] = {
        "images": len(rows),
        "avg_latency_ms": t_total / len(rows) if rows else 0.0,
        "threshold": threshold,
        "fuzzy_threshold": fuzzy_threshold,
    }
    return rows, summary


def print_summary(summary: dict) -> None:
    print()
    print("=" * 88)
    print(f"{'field':<10} {'n':>5} {'pred':>5} {'exact':>7} {'fuzzy':>7} "
          f"{'prec':>6} {'rec':>6} {'F1':>6} {'conf✓':>7} {'conf✗':>7}")
    print("-" * 88)
    for k in ("company", "date", "address", "total"):
        s = summary[k]
        print(f"{k:<10} {s['n_gt']:>5} {s['n_pred']:>5} "
              f"{s['exact_acc']*100:>6.1f}% {s['fuzzy_acc']*100:>6.1f}% "
              f"{s['precision']*100:>5.1f}% {s['recall']*100:>5.1f}% {s['f1']*100:>5.1f}% "
              f"{s['mean_conf_correct']:>7.3f} {s['mean_conf_wrong']:>7.3f}")
    print("-" * 88)
    o = summary["_overall"]
    print(f"images={o['images']}  avg_latency={o['avg_latency_ms']:.0f}ms  "
          f"keep_threshold={o['threshold']}  fuzzy_threshold={o['fuzzy_threshold']}")
    print("=" * 88)
    print("Legend: exact = case/whitespace-normalized exact match;"
          " fuzzy = task-appropriate match (numeric for total, digit-sequence for date,"
          " SequenceMatcher ratio ≥ fuzzy_threshold for company/address).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="Path to SROIE2019/test directory")
    ap.add_argument("--model-dir", default="./models/layoutlmv3-invoice")
    ap.add_argument("--limit", type=int, default=50,
                    help="Max images to evaluate (default 50; use 0 for all)")
    ap.add_argument("--threshold", type=float, default=0.6,
                    help="Drop predictions below this confidence (matches backend default)")
    ap.add_argument("--fuzzy-threshold", type=float, default=0.7,
                    help="Min SequenceMatcher ratio to count a string field as correct")
    ap.add_argument("--out", default="eval_sroie_results.csv")
    args = ap.parse_args()

    rows, summary = evaluate(
        Path(args.data), args.limit if args.limit > 0 else 0,
        args.threshold, args.model_dir, args.fuzzy_threshold,
    )

    if rows:
        with open(args.out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"\nPer-image rows: {args.out}")

    print_summary(summary)
    print(f"\nSummary JSON: {Path(args.out).with_suffix('.json')}")
    Path(args.out).with_suffix(".json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
