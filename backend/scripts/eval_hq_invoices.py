#!/usr/bin/env python
"""Evaluate the LayoutLMv3 invoice extractor on the HQ-invoice dataset.

This is the assignment's target distribution: clean, business-style invoices
with full structured ground truth (seller, invoice number, date, items, totals).

Usage (from backend/):
    ./venv/bin/python scripts/eval_hq_invoices.py \\
        --csv /tmp/hq_invoices/batch_1/batch_1/batch1_1.csv \\
        --img-dir /tmp/hq_invoices/batch_1/batch_1/batch1_1 \\
        --limit 50 --out eval_hq.csv
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

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import inference  # noqa: E402

_AMOUNT_RE = re.compile(r"-?\d[\d.,]*")


def _norm(s: str) -> str:
    s = (s or "").lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s.,/-]", "", s)
    return s


def _fuzzy(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def _all_amounts(s: str) -> list[float]:
    if not s:
        return []
    s = s.replace(" ", "").replace("$", "").replace("€", "")
    out: list[float] = []
    for m in _AMOUNT_RE.finditer(s):
        tok = m.group(0)
        if re.match(r"^-?\d{1,3}(?:\.\d{3})+,\d+$", tok):
            tok = tok.replace(".", "").replace(",", ".")
        else:
            tok = tok.replace(",", "")
        try:
            out.append(float(tok))
        except ValueError:
            pass
    return out


def _amount_match(pred: str, gt: str, tol: float = 0.5) -> bool:
    gs = _all_amounts(gt)
    if not gs:
        return False
    ps = _all_amounts(pred)
    return any(abs(p - g) <= tol for p in ps for g in gs)


def _date_match(pred: str, gt: str) -> bool:
    if not pred or not gt:
        return False
    p = re.sub(r"\D", "", pred)
    g = re.sub(r"\D", "", gt)
    return len(g) >= 6 and (p == g or g in p or p in g)


def _truth(j: dict) -> dict:
    inv = j.get("invoice", {}) or {}
    sub = j.get("subtotal", {}) or {}
    items = []
    for it in (j.get("items") or []):
        items.append({
            "name": (it.get("description") or "").replace("\n", " ").strip(),
            "qty": (it.get("quantity") or "").strip(),
            "price": (it.get("total_price") or it.get("unit_price") or "").strip(),
        })
    return {
        "COMPANY": (inv.get("seller_name") or "").strip(),
        "INVOICE_NO": (inv.get("invoice_number") or "").strip(),
        "DATE": (inv.get("invoice_date") or "").strip(),
        "ADDRESS": (inv.get("seller_address") or "").replace("\n", " ").strip(),
        "SUBTOTAL": "",  # HQ doesn't have a clean subtotal field
        "TAX": (sub.get("tax") or "").strip(),
        "TOTAL": (sub.get("total") or "").strip(),
        "items": items,
    }


def _match_field(label: str, pred: str, gt: str, fuzzy_threshold: float) -> bool:
    if not gt:
        return False
    if label in ("SUBTOTAL", "TAX", "TOTAL"):
        return _amount_match(pred, gt, tol=0.5)
    if label == "DATE":
        return _date_match(pred, gt)
    if label == "INVOICE_NO":
        # exact or one is contained in the other (strict, since these are numeric)
        p = re.sub(r"\W", "", pred).lower()
        g = re.sub(r"\W", "", gt).lower()
        return bool(p) and bool(g) and (p == g or g in p)
    # COMPANY / ADDRESS: fuzzy
    return _fuzzy(pred, gt) >= fuzzy_threshold


def _match_items(pred_items: list[dict], gt_items: list[dict],
                 fuzzy_threshold: float) -> dict:
    pairs_scored = []
    for i, p in enumerate(pred_items):
        for j, g in enumerate(gt_items):
            s = _fuzzy(p.get("name", ""), g.get("name", ""))
            pairs_scored.append((s, i, j))
    pairs_scored.sort(reverse=True)
    used_p, used_g, pairs = set(), set(), []
    for s, i, j in pairs_scored:
        if s < fuzzy_threshold:
            break
        if i in used_p or j in used_g:
            continue
        used_p.add(i); used_g.add(j); pairs.append((i, j, s))

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


SCALAR = ("COMPANY", "INVOICE_NO", "DATE", "ADDRESS", "TAX", "TOTAL")


def evaluate(csv_path: Path, img_dir: Path, limit: int, threshold: float,
             model_dir: str, fuzzy_threshold: float):
    inference.load_model(model_dir)
    agg = {f: {"tp": 0, "n_gt": 0, "n_pred": 0,
               "conf_c": [], "conf_w": []} for f in SCALAR}
    item_agg = {"tp_name": 0, "tp_qty": 0, "tp_price": 0, "n_pred": 0, "n_gt": 0}
    rows: list[dict] = []
    t_total = 0.0

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

            t0 = time.monotonic()
            try:
                result = inference.extract_invoice(str(img_path), model_dir=model_dir)
            except Exception as exc:
                print(f"  {img_path.name}: extract failed: {exc}")
                continue
            dt = (time.monotonic() - t0) * 1000
            t_total += dt

            row = {"image": img_path.name, "latency_ms": round(dt, 1)}
            for f in SCALAR:
                gt_val = truth[f]
                pred_val = result["fields"].get(f, "")
                conf = float(result["field_scores"].get(f, 0.0))
                if conf < threshold:
                    pred_val = ""
                ok = _match_field(f, pred_val, gt_val, fuzzy_threshold)
                row[f"{f}_gt"] = gt_val
                row[f"{f}_pred"] = pred_val
                row[f"{f}_conf"] = round(conf, 3)
                row[f"{f}_ok"] = int(ok)
                if gt_val:
                    agg[f]["n_gt"] += 1
                    if ok:
                        agg[f]["tp"] += 1
                        agg[f]["conf_c"].append(conf)
                    elif pred_val:
                        agg[f]["conf_w"].append(conf)
                if pred_val:
                    agg[f]["n_pred"] += 1

            pred_items = []
            for it in result["line_items"]:
                if it.get("name_score", 0.0) < threshold:
                    continue
                pred_items.append({
                    "name": it.get("name", ""),
                    "qty": it.get("qty", ""),
                    "price": it.get("price", ""),
                })
            m = _match_items(pred_items, truth["items"], fuzzy_threshold)
            for k in item_agg:
                item_agg[k] += m[k]
            row["items_gt"] = m["n_gt"]
            row["items_pred"] = m["n_pred"]
            row["items_name_tp"] = m["tp_name"]
            row["items_qty_tp"] = m["tp_qty"]
            row["items_price_tp"] = m["tp_price"]
            rows.append(row)
            if used % 5 == 0:
                print(f"  processed {used}  avg {t_total/used:.0f} ms/img")

    summary = {}
    for f, a in agg.items():
        prec = a["tp"] / a["n_pred"] if a["n_pred"] else 0.0
        rec = a["tp"] / a["n_gt"] if a["n_gt"] else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        summary[f] = {
            "n_gt": a["n_gt"], "n_pred": a["n_pred"],
            "precision": prec, "recall": rec, "f1": f1,
            "mean_conf_correct": (sum(a["conf_c"]) / len(a["conf_c"])
                                  if a["conf_c"] else 0.0),
            "mean_conf_wrong": (sum(a["conf_w"]) / len(a["conf_w"])
                                if a["conf_w"] else 0.0),
        }
    for tp_k, lab in (("tp_name", "ITEM_NAME"),
                      ("tp_qty", "ITEM_QTY"),
                      ("tp_price", "ITEM_PRICE")):
        prec = item_agg[tp_k] / item_agg["n_pred"] if item_agg["n_pred"] else 0.0
        rec = item_agg[tp_k] / item_agg["n_gt"] if item_agg["n_gt"] else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        summary[lab] = {
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
    for f in ("COMPANY", "INVOICE_NO", "DATE", "ADDRESS", "TAX", "TOTAL",
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
          f"threshold={o['threshold']}")
    print("=" * 86)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--img-dir", required=True)
    ap.add_argument("--model-dir", default="./models/layoutlmv3-invoice")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--threshold", type=float, default=0.6)
    ap.add_argument("--fuzzy-threshold", type=float, default=0.7)
    ap.add_argument("--out", default="eval_hq.csv")
    args = ap.parse_args()

    rows, summary = evaluate(
        Path(args.csv), Path(args.img_dir), args.limit, args.threshold,
        args.model_dir, args.fuzzy_threshold,
    )
    if rows:
        with open(args.out, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader(); w.writerows(rows)
        print(f"\nPer-image rows: {args.out}")
    print_summary(summary)
    Path(args.out).with_suffix(".json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
