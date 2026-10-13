#!/usr/bin/env python3
"""Lens recovery v2 — link Hot Wheels releases to their OWN wiki photos.

Uses the builders' checkpoint (tools/sku_cp_resolve.json): per-casting
Versions rows with `_photo_file`. Our catalog entries were generated from
these rows, so a rich composite match (sku, year, color, wheels, series,
tampo) can re-align a gap entry to its source row — and the row's photo is
then that release's own photo, assigned by the wiki's own table.

Safety rails:
- Self-test first: the same matcher runs on entries that ALREADY have a
  photo; we only trust it for gaps if it reproduces the known filename
  with high precision.
- A gap assignment needs a unique best row with a clear margin, and the
  row's file must not be a placeholder/sketch.
Output: staged assignments JSON; the catalog is never written here.
"""
import json, re, sys, hashlib, urllib.parse
from collections import defaultdict

BAD = re.compile(r"image_not_available|INA\.jpg|sketch|drawing|artwork|poster|blueprint|illustrat|dream1", re.I)
STAGED = "/home/hatch/workspace/goals/chasiq-die-cast-collection-app/hidden_files/research-team/staged"

def construct_url(fn):
    h = hashlib.md5(fn.encode("utf-8")).hexdigest()
    return ("https://static.wikia.nocookie.net/hotwheels/images/"
            f"{h[0]}/{h[:2]}/{urllib.parse.quote(fn)}"
            "/revision/latest/scale-to-width-down/800")

def clean(s):
    s = str(s or "")
    s = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", "", s)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"'{2,3}", "", s)
    return re.sub(r"\s+", " ", s).strip()

def norm(s):
    s = clean(s).lower()
    s = re.sub(r"\bseries\b", "", s)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", s)).strip()

def toks(s):
    return set(norm(s).split()) - {"", "hot", "wheels"}

def sku_of(s): return re.sub(r"\D", "", str(s or ""))

def year_of(s):
    m = re.search(r"(19|20)\d\d", str(s or ""))
    return int(m.group(0)) if m else None

def fname_of(url):
    try:
        p = urllib.parse.urlparse(url).path.split("/")
        i = p.index("revision")
        return urllib.parse.unquote(p[i-1]).lower()
    except Exception:
        return ""

def score(entry, row):
    sc, parts = 0, []
    es, rs = sku_of(entry.get("sku")), sku_of(row.get("toy #"))
    if es and rs:
        if es == rs: sc += 4; parts.append("sku")
        else: return -99, []
    ey, ry = entry.get("year"), year_of(row.get("year"))
    if ey and ry:
        if int(ey) == ry: sc += 3; parts.append("year")
        else: return -99, []
    if norm(entry.get("color")) and norm(row.get("color")):
        if norm(entry.get("color")) == norm(row.get("color")): sc += 3; parts.append("color")
        else: return -99, []
    ew, rw = toks(entry.get("wheels")), toks(row.get("wheel type"))
    if ew and rw:
        j = len(ew & rw) / max(1, len(ew | rw))
        if j >= 0.5: sc += 2; parts.append("wheels")
    if norm(entry.get("series")) and norm(row.get("series")):
        if norm(entry.get("series")) == norm(row.get("series")): sc += 2; parts.append("series")
    et, rt = toks(entry.get("tampo")), toks(row.get("tampo"))
    if et and rt and len(et & rt) >= 2: sc += 1; parts.append("tampo")
    return sc, parts

def best_match(entry, rows):
    scored = []
    for i, r in enumerate(rows):
        f = r.get("_photo_file") or ""
        if not f or BAD.search(f): continue
        sc, parts = score(entry, r)
        if sc >= 0: scored.append((sc, i, parts))
    if not scored: return None
    scored.sort(key=lambda t: -t[0])
    top = scored[0]
    second = scored[1][0] if len(scored) > 1 else -1
    return top, second

def main():
    cp = json.load(open("tools/sku_cp_resolve.json"))
    catalog = json.load(open("tools/catalog_dump.json"))
    rows_by = {t: (v.get("rows") or []) for t, v in cp.items()}
    hw = [e for e in catalog if e["id"].startswith("hwr")]
    # ---- self-test on entries WITH photos
    agree = disagree = tested = 0
    disagreements = []
    for e in hw:
        if not e.get("img"): continue
        rows = rows_by.get(e["name"])
        if not rows: continue
        bm = best_match(e, rows)
        if not bm: continue
        (sc, i, parts), second = bm
        if sc < 8 or sc - second < 2: continue
        tested += 1
        pred = (rows[i].get("_photo_file") or "").lower()
        if pred == fname_of(e["img"]): agree += 1
        else:
            disagree += 1
            if len(disagreements) < 8:
                disagreements.append({"id": e["id"], "name": e["name"], "pred": pred, "actual": fname_of(e["img"]), "score": sc})
    print(f"SELF-TEST: tested {tested} | agree {agree} | disagree {disagree} | precision {agree/max(1,tested):.3f}")
    for d in disagreements: print("  DISAGREE", d)
    # ---- gaps
    assignments, ambiguous, nofile = [], 0, 0
    for e in hw:
        if e.get("img"): continue
        rows = rows_by.get(e["name"])
        if not rows: nofile += 1; continue
        bm = best_match(e, rows)
        if not bm: nofile += 1; continue
        (sc, i, parts), second = bm
        if sc >= 8 and sc - second >= 2:
            f = rows[i]["_photo_file"]
            assignments.append({"id": e["id"], "img": construct_url(f), "via": "checkpoint-row",
                                "file": f, "score": sc, "parts": parts, "casting": e["name"]})
        else:
            ambiguous += 1
    print(f"GAPS: assignments {len(assignments)} | ambiguous/weak {ambiguous} | no usable row photo {nofile}")
    out = STAGED + "/lens-recovery-batch1.json"
    json.dump({"selftest": {"tested": tested, "agree": agree, "disagree": disagree},
               "assignments": assignments}, open(out, "w"), indent=1)
    print("wrote", out)

if __name__ == "__main__":
    main()
