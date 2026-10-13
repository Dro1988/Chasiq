#!/usr/bin/env python3
"""Lens batch 3 — casting-page gallery pass.

For gap releases whose Versions row has no usable photo, search the
casting page's full image list (Fandom API) and match by filename
evidence: SKU digits (strong), else year + color tokens + series with a
unique winner. A file may be claimed by only one release per casting,
and files already used by sibling entries are excluded (that photo
belongs to that release). Conservative by design; output is staged,
never written to the catalog here.
"""
import json, re, sys, time, hashlib, urllib.parse, urllib.request
from collections import defaultdict

API = "https://hotwheels.fandom.com/api.php"
UA = {"User-Agent": "Chasiq-Lens/1.0 (photo recovery; chasiq.onrender.com)"}
BAD = re.compile(r"image_not_available|INA\.jpg|sketch|drawing|artwork|poster|blueprint|illustrat|dream1|logo|icon", re.I)
STAGED = "/home/hatch/workspace/goals/chasiq-die-cast-collection-app/hidden_files/research-team/staged"
PILOT_CASTINGS = int(sys.argv[1]) if len(sys.argv) > 1 else 60

def construct_url(fn):
    h = hashlib.md5(fn.encode("utf-8")).hexdigest()
    return ("https://static.wikia.nocookie.net/hotwheels/images/"
            f"{h[0]}/{h[:2]}/{urllib.parse.quote(fn)}"
            "/revision/latest/scale-to-width-down/800")

def fetch_images(title):
    files, cont = [], None
    for _ in range(6):
        q = {"action":"query","prop":"images","format":"json","imlimit":"500","titles":title}
        if cont: q["imcontinue"] = cont
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(q), headers=UA)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=45) as r: d = json.load(r)
                break
            except Exception:
                if attempt == 2: raise
                time.sleep(1.5)
        for p in d.get("query",{}).get("pages",{}).values():
            for im in p.get("images", []):
                t = im["title"].replace("File:", "").replace(" ", "_")
                if re.search(r"\.(jpg|jpeg|png)$", t, re.I) and not BAD.search(t):
                    files.append(t)
        cont = (d.get("continue") or {}).get("imcontinue")
        if not cont: break
    return files

def toks(s):
    s = re.sub(r"[^a-z0-9]+", " ", str(s or "").lower())
    return [t for t in s.split() if len(t) >= 3]

def digits(s): return re.sub(r"\D", "", str(s or ""))

def fname_of(url):
    try:
        p = urllib.parse.urlparse(url).path.split("/")
        return urllib.parse.unquote(p[p.index("revision")-1]).lower()
    except Exception: return ""

def main():
    catalog = json.load(open("tools/catalog_dump.json"))
    hw = [e for e in catalog if e["id"].startswith("hwr")]
    gaps_by = defaultdict(list)
    used_by = defaultdict(set)
    for e in hw:
        if e.get("img"): used_by[e["name"]].add(fname_of(e["img"]))
        else: gaps_by[e["name"]].append(e)
    names = sorted(gaps_by, key=lambda n: -len(gaps_by[n]))[:PILOT_CASTINGS]
    assignments, stats = [], {"castings":0, "gaps":0, "files":0, "sku":0, "tokens":0, "conflicts":0}
    for name in names:
        todo = gaps_by[name]
        stats["castings"] += 1; stats["gaps"] += len(todo)
        try: files = fetch_images(name)
        except Exception as ex:
            print("FETCH FAIL", name, str(ex)[:70]); continue
        pool = [f for f in files if f.lower() not in used_by[name]]
        stats["files"] += len(pool)
        claimed = {}
        scored = []
        for e in todo:
            esku = digits(e.get("sku"))
            ecol = digits(e.get("col_no"))
            cands = []
            for f in pool:
                fl = f.lower()
                fd = digits(f)
                sc, parts = 0, []
                sku_hit = len(esku) >= 3 and esku in fd
                if sku_hit: sc += 6; parts.append("sku")
                if ecol and len(ecol) >= 2 and ecol in fd: sc += 2; parts.append("colno")
                if e.get("year") and str(e["year"]) in fl: sc += 3; parts.append("year")
                ctoks = [t for t in toks(e.get("color")) if t not in ("hot","wheels")]
                chit = [t for t in ctoks if t in fl]
                if ctoks and len(chit) == len(ctoks): sc += 3; parts.append("color")
                elif chit: sc += 1; parts.append("color~")
                stoks = [t for t in toks(e.get("series")) if t not in ("series",)]
                shit = [t for t in stoks if t in fl]
                if shit: sc += min(2, len(shit)); parts.append("series")
                ntoks = [t for t in toks(name)][:3]
                if any(t in fl for t in ntoks): sc += 1; parts.append("casting")
                strong = sku_hit and ("year" in parts or "color" in parts)
                ok = (strong and sc >= 7) or (sc >= 8 and "color" in parts and "year" in parts)
                if ok: cands.append((sc, f, parts))
            if not cands: continue
            cands.sort(key=lambda t: -t[0])
            top, second = cands[0], cands[1][0] if len(cands) > 1 else -1
            if len(cands) == 1 or top[0] - second >= 2:
                scored.append((top[0], e, top[1], top[2]))
        scored.sort(key=lambda t: -t[0])
        for sc, e, f, parts in scored:
            if f in claimed: stats["conflicts"] += 1; continue
            claimed[f] = e["id"]
            assignments.append({"id": e["id"], "img": construct_url(f),
                                "via": "gallery-sku" if "sku" in parts else "gallery-tokens",
                                "file": f, "score": sc, "parts": parts, "casting": name})
            stats["sku" if "sku" in parts else "tokens"] += 1
        time.sleep(0.3)
    print(json.dumps(stats))
    out = STAGED + "/lens-gallery-pilot.json"
    json.dump({"stats": stats, "assignments": assignments}, open(out, "w"), indent=1)
    print("wrote", out, len(assignments), "assignments")

if __name__ == "__main__":
    main()
