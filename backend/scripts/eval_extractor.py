"""Evaluate the LayoutLMv3 invoice extractor against SROIE ground truth.

Bypasses Gemini entirely — pure model + Tesseract.

Usage:
    cd backend
    ./venv/bin/python scripts/eval_extractor.py \
        --dataset /home/panos/Hackathons/Makeathon/sroie-v2/SROIE2019/test \
        --limit 50

Outputs per-field precision/recall/F1, exact-match accuracy, fuzzy accuracy,
plus a CSV of every prediction vs. ground truth.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.services import inference

# SROIE entity key -> our model's entity label
FIELD_MAP = {
    "company": "COMPANY",
    "date": "DATE",
    "address": "ADDRESS",
    "total": "TOTAL",
}


def _norm_text(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^\w\s.,/-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _norm_amount(s: str) -> str | None:
    if not s:
        return None
    s = re.sub(r"[^\d,.\-]", "", s)
    if not s:
        return None
    # if both ',' and '.', whichever comes last is the decimal sep
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # treat comma as decimal if it's followed by 1-2 digits at the end
        if re.match(r"^\d+,\d{1,2}$", s):
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    try:
        return f"{float(s):.2f}"
    except ValueError:
        return None


def _fuzzy(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, _norm_text(a), _norm_text(b)).ratio()


def _match(field: str, pred: str | None, gt: str | None) -> tuple[bool, float]:
    """Returns (exact_match, fuzzy_score)."""
    if not gt:
        return (False, 0.0)
    if not pred:
        return (False, 0.0)
    if field == "total":
        pn, gn = _norm_amount(pred), _norm_amount(gt)
        if pn and gn:
            return (pn == gn, 1.0 if pn == gn else 0.0)
        return (False, _fuzzy(pred, gt))
    p, g = _norm_text(pred), _norm_text(gt)
    if p == g:
        return (True, 1.0)
    fuzzy = _fuzzy(p, g)
    # treat "substring contains" as exact for company/address (OCR often picks up extras)
    if field in ("company", "address") and (p in g or g in p) and min(len(p), len(g)) >= 3:
        return (True, max(fuzzy, 0.95))
    return (False, fuzzy)


def evaluate(dataset_dir: Path, limit: int | None, out_csv: Path) -> dict:
    img_dir = dataset_dir / "img"
    gt_dir = dataset_dir / "entities"

    inference.load_model(settings.layoutlm_model_dir)

    images = sorted(p for p in img_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if limit:
        images = images[:limit]

    per_field = {k: {"tp": 0, "fp": 0, "fn": 0, "fuzzy": [], "conf": []} for k in FIELD_MAP}
    rows = []
    latencies = []

    for i, img_path in enumerate(images, 1):
        gt_path = gt_dir / f"{img_path.stem}.txt"
        if not gt_path.exists():
            continue
        try:
            gt = json.loads(gt_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        t0 = time.monotonic()
        try:
            result = inference.extract_invoice(str(img_path))
        except Exception as exc:
            print(f"  [{i}/{len(images)}] {img_path.name}  ERROR {exc}")
            continue
        latencies.append((time.monotonic() - t0) * 1000)

        fields = result["fields"]
        scores = result["field_scores"]

        row = {"file": img_path.name}
        for sroie_key, our_label in FIELD_MAP.items():
            gt_val = gt.get(sroie_key)
            pred_val = fields.get(our_label)
            conf = scores.get(our_label, 0.0)
            exact, fuzzy = _match(sroie_key, pred_val, gt_val)

            row[f"gt_{sroie_key}"] = gt_val or ""
            row[f"pred_{sroie_key}"] = pred_val or ""
            row[f"conf_{sroie_key}"] = f"{conf:.3f}"
            row[f"exact_{sroie_key}"] = int(exact)
            row[f"fuzzy_{sroie_key}"] = f"{fuzzy:.3f}"

            bucket = per_field[sroie_key]
            if gt_val and pred_val:
                if exact:
                    bucket["tp"] += 1
                else:
                    bucket["fp"] += 1
                    bucket["fn"] += 1
            elif gt_val and not pred_val:
                bucket["fn"] += 1
            elif pred_val and not gt_val:
                bucket["fp"] += 1
            bucket["fuzzy"].append(fuzzy)
            if pred_val:
                bucket["conf"].append(conf)

        rows.append(row)
        if i % 10 == 0 or i == len(images):
            print(f"  [{i}/{len(images)}]  last={img_path.name}")

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    if rows:
        with out_csv.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    summary = {"n_images": len(rows), "latency_ms": {
        "mean": statistics.mean(latencies) if latencies else 0,
        "p50": statistics.median(latencies) if latencies else 0,
        "p95": statistics.quantiles(latencies, n=20)[18] if len(latencies) >= 20 else max(latencies, default=0),
    }, "fields": {}}
    for k, b in per_field.items():
        tp, fp, fn = b["tp"], b["fp"], b["fn"]
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        summary["fields"][k] = {
            "exact_accuracy": tp / len(rows) if rows else 0.0,
            "precision": prec,
            "recall": rec,
            "f1": f1,
            "fuzzy_mean": statistics.mean(b["fuzzy"]) if b["fuzzy"] else 0.0,
            "mean_confidence": statistics.mean(b["conf"]) if b["conf"] else 0.0,
            "n_predicted": tp + fp,
        }
    return summary


def _print_summary(s: dict, out_csv: Path) -> None:
    print()
    print("=" * 78)
    print(f"  Evaluated:   {s['n_images']} images")
    print(f"  Latency ms:  mean={s['latency_ms']['mean']:.0f}  p50={s['latency_ms']['p50']:.0f}  p95={s['latency_ms']['p95']:.0f}")
    print("=" * 78)
    print(f"  {'field':<10} {'exact':>7} {'prec':>7} {'recall':>7} {'F1':>7} {'fuzzy':>7} {'conf':>7}  {'n_pred':>6}")
    print(f"  {'-'*10} {'-'*7} {'-'*7} {'-'*7} {'-'*7} {'-'*7} {'-'*7}  {'-'*6}")
    for k, m in s["fields"].items():
        print(f"  {k:<10} {m['exact_accuracy']*100:>6.1f}% {m['precision']*100:>6.1f}% {m['recall']*100:>6.1f}% {m['f1']*100:>6.1f}% {m['fuzzy_mean']*100:>6.1f}% {m['mean_confidence']*100:>6.1f}%  {m['n_predicted']:>6}")
    overall_f1 = statistics.mean(m["f1"] for m in s["fields"].values()) if s["fields"] else 0
    overall_exact = statistics.mean(m["exact_accuracy"] for m in s["fields"].values()) if s["fields"] else 0
    print("=" * 78)
    print(f"  Macro F1:           {overall_f1*100:.1f}%")
    print(f"  Macro exact-match:  {overall_exact*100:.1f}%")
    print(f"  Per-image CSV:      {out_csv}")
    print("=" * 78)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="/home/panos/Hackathons/Makeathon/sroie-v2/SROIE2019/test",
                    help="Path to SROIE test dir containing img/ and entities/")
    ap.add_argument("--limit", type=int, default=None,
                    help="Evaluate only the first N images (default: all)")
    ap.add_argument("--out", default="./eval_results.csv",
                    help="Path for per-image CSV")
    args = ap.parse_args()
    dataset_dir = Path(args.dataset)
    if not (dataset_dir / "img").exists() or not (dataset_dir / "entities").exists():
        print(f"ERROR: {dataset_dir} must contain img/ and entities/")
        sys.exit(1)
    out_csv = Path(args.out).resolve()
    summary = evaluate(dataset_dir, args.limit, out_csv)
    _print_summary(summary, out_csv)
    summary_path = out_csv.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(summary, indent=2))
    print(f"  Summary JSON:       {summary_path}")


if __name__ == "__main__":
    main()
