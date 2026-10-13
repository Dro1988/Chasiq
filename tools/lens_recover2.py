#!/usr/bin/env python3
"""Lens recovery batch 2 — softer matching + ordinal tiebreak.

Changes vs batch 1 (lens_recover.py):
- color: exact +3, token-containment +2 (e.g. Blue vs Metalflake Blue),
  disjoint colors still hard-reject (wrong-variant protection).
- series: exact +2, containment +1, disjoint = 0 points (no reject;
  series naming is noisy, sku+year+color carry identity).
- ordinal tiebreak: entries of a casting are processed in catalog order
  (they were generated in Versions-row order). When rows tie at the top,
  the earliest tied row AFTER the last consumed row wins, if it is the
  only tied row after the cursor and the score is >= 9.
Self-test gate is unchanged in spirit: the matcher must reproduce known
photos with >= 99.9% precision overall, and the ordinal-only decisions
are reported separately so they can be gated on their own record.
"""
import json, re, hashlib, urllib.parse
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

def toks(s): return set(norm(s).split()) - {"", "hot", "wheels"}
def sku_of(s): return re.sub(r"\D", "", str(s or ""))
def year_of(s):
    m = re.search(r"(19|20)\d\d", str(s or ""))
    return int(m.group(0)) if m else None
def fname_of(url):
    try:
        p = urllib.parse.urlparse(url).path.split("/")
        return urllib.parse.unquote(p[p.index("revision")-1]).lower()
    except Exception: return ""

def score(e, r):
    sc, parts = 0, []
    es, rs = sku_of(e.get("sku")), sku_of(r.get("toy #"))
    if es and rs:
        if es == rs: sc += 4; parts.append("sku")
        else: return -99, []
    ey, ry = e.get("year"), year_of(r.get("year"))
    if ey and ry:
        if int(ey) == ry: sc += 3; parts.append("year")
        else: return -99, []
    ec, rc = toks(e.get("color")), toks(r.get("color"))
    if ec and rc:
        if ec == rc: sc += 3; parts.append("color")
        elif ec <= rc or rc <= ec: sc += 2; parts.append("color~")
        else: return -99, []
    ew, rw = toks(e.get("wheels")), toks(r.get("wheel type"))
    if ew and rw:
        j = len(ew & rw) / max(1, len(ew | rw))
        if j >= 0.5: sc += 2; parts.append("wheels")
    esr, rsr = toks(e.get("series")), toks(r.get("series"))
    if esr and rsr:
        if esr == rsr: sc += 2; parts.append("series")
        elif esr <= rsr or rsr <= esr: sc += 1; parts.append("series~")
    et, rt = toks(e.get("tampo")), toks(r.get("tampo"))
    if et and rt and len(et & rt) >= 2: sc += 1; parts.append("tampo")
    return sc, parts

def ranked(e, rows):
    out = []
    for i, r in enumerate(rows):
        f = r.get("_photo_file") or ""
        if not f or BAD.search(f): continue
        sc, parts = score(e, r)
        if sc >= 0: out.append((sc, i, parts))
    out.sort(key=lambda t: (-t[0], t[1]))
    return out

def decide(e, rows, cursor):
    """Returns (rowidx, via, score, parts) or None. Pure decision, no cursor mutation."""
    rk = ranked(e, rows)
    if not rk: return None
    top = rk[0][0]
    if top < 8: return None
    tied = [t for t in rk if t[0] == top]
    second = rk[len(tied)][0] if len(rk) > len(tied) else -1
    if len(tied) == 1 and top - second >= 2:
        return (rk[0][1], "composite", top, rk[0][2])
    # tie: ordinal rule
    if top >= 9:
        after = [t for t in tied if t[1] > cursor]
        if len(after) == 1:
            return (after[0][1], "ordinal", top, after[0][2])
        if len(after) > 1 and all(t[1] > cursor for t in tied):
            return (after[0][1], "ordinal-first", top, after[0][2])
    return None

def main():
    cp = json.load(open("tools/sku_cp_resolve.json"))
    catalog = json.load(open("tools/catalog_dump.json"))
    rows_by = {t: (v.get("rows") or []) for t, v in cp.items()}
    hw = [e for e in catalog if e["id"].startswith("hwr")]
    by_cast = defaultdict(list)
    for e in hw: by_cast[ e["name"] ].append(e)
    # ---------- self-test
    st = {"tested":0, "agree":0, "ordinal_tested":0, "ordinal_agree":0, "comp_tested":0, "comp_agree":0}
    disagreements = []
    assignments = []
    ambig = 0
    for name, entries in by_cast.items():
        rows = rows_by.get(name)
        if not rows: continue
        cursor = -1
        for e in entries:
            d = decide(e, rows, cursor)
            if e.get("img"):
                if d:
                    idx, via, sc, parts = d
                    pred = (rows[idx].get("_photo_file") or "").lower()
                    ok = pred == fname_of(e["img"])
                    st["tested"] += 1; st["agree"] += ok
                    if via == "composite": st["comp_tested"] += 1; st["comp_agree"] += ok
                    else: st["ordinal_tested"] += 1; st["ordinal_agree"] += ok
                    if not ok and len(disagreements) < 10:
                        disagreements.append({"id": e["id"], "name": name, "via": via, "pred": pred, "actual": fname_of(e["img"])})
                    cursor = max(cursor, idx)
                continue
            # gap entry
            if d:
                idx, via, sc, parts = d
                f = rows[idx]["_photo_file"]
                assignments.append({"id": e["id"], "img": construct_url(f), "via": via,
                                    "file": f, "score": sc, "parts": parts, "casting": name})
                cursor = max(cursor, idx)
            else:
                rk = ranked(e, rows)
                if rk and rk[0][0] >= 8: ambig += 1
    prec = st["agree"]/max(1, st["tested"])
    oprec = st["ordinal_agree"]/max(1, st["ordinal_tested"]) if st["ordinal_tested"] else 1.0
    print(f"SELF-TEST overall: {st['agree']}/{st['tested']} = {prec:.4f}")
    print(f"  composite: {st['comp_agree']}/{st['comp_tested']} | ordinal: {st['ordinal_agree']}/{st['ordinal_tested']} = {oprec:.4f}")
    for d in disagreements: print("  DISAGREE", d)
    print(f"GAP assignments: {len(assignments)} (ordinal among them: {sum(1 for a in assignments if a['via']!='composite')}) | still ambiguous: {ambig}")
    json.dump({"selftest": st, "assignments": assignments},
              open(STAGED + "/lens-recovery-batch2.json", "w"), indent=1)
    print("wrote staged/lens-recovery-batch2.json")

if __name__ == "__main__":
    main()
