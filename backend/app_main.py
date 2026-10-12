"""Chasiq API — accounts, cloud sync, marketplace. Roadmap phase 1."""
import hashlib, hmac, json, os, secrets, time
from datetime import datetime, timezone

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------- config ----------------
JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET env is required")
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}
FREE_GARAGE_LIMIT = int(os.environ.get("FREE_GARAGE_LIMIT", "200"))
FEE_BPS = int(os.environ.get("PLATFORM_FEE_BPS", "500"))  # 5% of sale price, recorded per sale
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ---------------- storage ----------------
if DATABASE_URL:
    import psycopg2
    def db():
        return psycopg2.connect(DATABASE_URL)
    PH = "%s"
    ID_COL = "id SERIAL PRIMARY KEY"
else:
    import sqlite3
    _path = os.path.join(os.path.dirname(__file__), "chasiq.db")
    def db():
        return sqlite3.connect(_path)
    PH = "?"
    ID_COL = "id INTEGER PRIMARY KEY AUTOINCREMENT"

def init_db():
    c = db(); cur = c.cursor()
    cur.execute(f"""CREATE TABLE IF NOT EXISTS users(
        {ID_COL}, email TEXT UNIQUE NOT NULL, pw TEXT NOT NULL,
        name TEXT DEFAULT '', plan TEXT DEFAULT 'free', created_at TEXT NOT NULL)""")
    cur.execute("""CREATE TABLE IF NOT EXISTS user_data(
        user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    cur.execute("""CREATE TABLE IF NOT EXISTS listings(
        id TEXT PRIMARY KEY, seller_id INTEGER NOT NULL, seller_name TEXT DEFAULT '',
        data TEXT NOT NULL, price REAL NOT NULL, brand TEXT DEFAULT '',
        status TEXT DEFAULT 'active', created_at TEXT NOT NULL)""")
    cur.execute("""CREATE TABLE IF NOT EXISTS orders(
        id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, buyer_id INTEGER NOT NULL,
        seller_id INTEGER NOT NULL, price REAL NOT NULL, fee REAL NOT NULL,
        status TEXT DEFAULT 'reserved', created_at TEXT NOT NULL)""")
    c.commit(); c.close()

def _rows(cur):
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]

def q1(sql, args=()):
    c = db(); cur = c.cursor(); cur.execute(sql, args)
    rows = _rows(cur); c.close()
    return rows[0] if rows else None

def qall(sql, args=()):
    c = db(); cur = c.cursor(); cur.execute(sql, args)
    rows = _rows(cur); c.close(); return rows

def ex(sql, args=()):
    c = db(); cur = c.cursor(); cur.execute(sql, args); c.commit(); c.close()

# ---------------- auth ----------------
def hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    return salt.hex() + "$" + dk.hex()

def check_pw(pw: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt_hex), 200_000)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False

def plan_for(email: str, stored_plan: str) -> str:
    return "admin" if email.lower() in ADMIN_EMAILS else stored_plan

def make_token(u) -> str:
    return jwt.encode({"sub": str(u["id"]), "email": u["email"],
                       "exp": int(time.time()) + 30 * 24 * 3600},
                      JWT_SECRET, algorithm="HS256")

def current_user(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in required")
    try:
        payload = jwt.decode(authorization[7:], JWT_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(401, "Session expired — sign in again")
    u = q1(f"SELECT * FROM users WHERE id={PH}", (int(payload["sub"]),))
    if not u:
        raise HTTPException(401, "Account not found")
    u["plan"] = plan_for(u["email"], u["plan"])
    return u

def public_user(u):
    paid = u["plan"] in ("premium", "admin")
    return {"id": u["id"], "email": u["email"], "name": u["name"], "plan": u["plan"],
            "limits": {"garage": None if paid else FREE_GARAGE_LIMIT, "canSell": paid}}

# ---------------- models ----------------
class AuthIn(BaseModel):
    email: str
    password: str
    name: str = ""

class DataIn(BaseModel):
    data: dict

class ListingIn(BaseModel):
    listing: dict

# ---------------- app ----------------
app = FastAPI(title="Chasiq API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
def _startup():
    init_db()

@app.get("/health")
def health():
    return {"ok": True, "service": "chasiq-api"}

@app.post("/auth/register")
def register(body: AuthIn):
    email = body.email.strip().lower()
    if "@" not in email or len(body.password) < 6:
        raise HTTPException(400, "Valid email and a 6+ character password required")
    if q1(f"SELECT id FROM users WHERE email={PH}", (email,)):
        raise HTTPException(409, "That email already has an account — sign in instead")
    now = datetime.now(timezone.utc).isoformat()
    ex(f"INSERT INTO users(email,pw,name,plan,created_at) VALUES({PH},{PH},{PH},{PH},{PH})",
       (email, hash_pw(body.password), body.name.strip()[:60], "free", now))
    u = q1(f"SELECT * FROM users WHERE email={PH}", (email,))
    u["plan"] = plan_for(u["email"], u["plan"])
    return {"token": make_token(u), "user": public_user(u)}

@app.post("/auth/login")
def login(body: AuthIn):
    email = body.email.strip().lower()
    u = q1(f"SELECT * FROM users WHERE email={PH}", (email,))
    if not u or not check_pw(body.password, u["pw"]):
        raise HTTPException(401, "Email or password is wrong")
    u["plan"] = plan_for(u["email"], u["plan"])
    return {"token": make_token(u), "user": public_user(u)}

@app.get("/me")
def me(u=Depends(current_user)):
    return {"user": public_user(u)}

@app.get("/me/data")
def get_data(u=Depends(current_user)):
    row = q1(f"SELECT data, updated_at FROM user_data WHERE user_id={PH}", (u["id"],))
    if not row:
        return {"data": None, "updated_at": None}
    return {"data": json.loads(row["data"]), "updated_at": row["updated_at"]}

@app.put("/me/data")
def put_data(body: DataIn, u=Depends(current_user)):
    data = body.data or {}
    coll = data.get("collection") or []
    if u["plan"] == "free" and len(coll) > FREE_GARAGE_LIMIT:
        raise HTTPException(403, f"Free plan syncs up to {FREE_GARAGE_LIMIT} garage cars — upgrade for unlimited")
    blob = json.dumps(data)
    if len(blob) > 30_000_000:
        raise HTTPException(413, "Sync payload too large")
    now = datetime.now(timezone.utc).isoformat()
    if q1(f"SELECT user_id FROM user_data WHERE user_id={PH}", (u["id"],)):
        ex(f"UPDATE user_data SET data={PH}, updated_at={PH} WHERE user_id={PH}", (blob, now, u["id"]))
    else:
        ex(f"INSERT INTO user_data(user_id,data,updated_at) VALUES({PH},{PH},{PH})", (u["id"], blob, now))
    return {"ok": True, "updated_at": now}

# ---------------- marketplace ----------------
@app.get("/listings")
def get_listings(brand: str = ""):
    if brand:
        rows = qall(f"SELECT * FROM listings WHERE status='active' AND brand={PH} ORDER BY created_at DESC LIMIT 500", (brand,))
    else:
        rows = qall("SELECT * FROM listings WHERE status='active' ORDER BY created_at DESC LIMIT 500")
    out = []
    for r in rows:
        l = json.loads(r["data"])
        l.update({"lid": r["id"], "seller_id": r["seller_id"], "seller_name": r["seller_name"],
                  "price": r["price"], "brand": r["brand"], "status": r["status"]})
        out.append(l)
    return {"listings": out}

@app.post("/listings")
def create_listing(body: ListingIn, u=Depends(current_user)):
    if u["plan"] not in ("premium", "admin"):
        raise HTTPException(403, "Selling is part of the paid plan — free accounts can buy")
    l = body.listing or {}
    price = float(l.get("price") or 0)
    if price <= 0 or not l.get("name"):
        raise HTTPException(400, "Listing needs a name and a price above 0")
    lid = "L" + secrets.token_hex(6)
    now = datetime.now(timezone.utc).isoformat()
    seller_name = u["name"] or u["email"].split("@")[0]
    data = {k: l.get(k, "") for k in ("cid", "name", "series", "year", "color", "img", "cond", "note")}
    data["qty"] = int(l.get("qty") or 1)
    ex(f"INSERT INTO listings(id,seller_id,seller_name,data,price,brand,status,created_at) VALUES({PH},{PH},{PH},{PH},{PH},{PH},'active',{PH})",
       (lid, u["id"], seller_name, json.dumps(data), price, str(l.get("brand") or "Other"), now))
    return {"ok": True, "lid": lid}

@app.delete("/listings/{lid}")
def delete_listing(lid: str, u=Depends(current_user)):
    r = q1(f"SELECT * FROM listings WHERE id={PH}", (lid,))
    if not r:
        raise HTTPException(404, "Listing not found")
    if r["seller_id"] != u["id"] and u["plan"] != "admin":
        raise HTTPException(403, "Not your listing")
    ex(f"UPDATE listings SET status='removed' WHERE id={PH}", (lid,))
    return {"ok": True}

@app.post("/listings/{lid}/buy")
def buy_listing(lid: str, u=Depends(current_user)):
    r = q1(f"SELECT * FROM listings WHERE id={PH} AND status='active'", (lid,))
    if not r:
        raise HTTPException(404, "Listing is no longer available")
    if r["seller_id"] == u["id"]:
        raise HTTPException(400, "You cannot buy your own listing")
    seller = q1(f"SELECT * FROM users WHERE id={PH}", (r["seller_id"],))
    seller_plan = plan_for(seller["email"], seller["plan"]) if seller else "free"
    fee = 0.0 if seller_plan == "admin" else round(r["price"] * FEE_BPS / 10000, 2)
    oid = "O" + secrets.token_hex(6)
    now = datetime.now(timezone.utc).isoformat()
    ex(f"INSERT INTO orders(id,listing_id,buyer_id,seller_id,price,fee,status,created_at) VALUES({PH},{PH},{PH},{PH},{PH},{PH},'reserved',{PH})",
       (oid, lid, u["id"], r["seller_id"], r["price"], fee, now))
    ex(f"UPDATE listings SET status='sold' WHERE id={PH}", (lid,))
    return {"ok": True, "order": oid, "fee": fee,
            "note": "Reserved. Payment and shipping are arranged with the seller — in-app payments arrive with the payments phase."}

@app.get("/me/orders")
def my_orders(u=Depends(current_user)):
    def enrich(rows):
        for o in rows:
            l = q1(f"SELECT data FROM listings WHERE id={PH}", (o["listing_id"],))
            if l:
                d = json.loads(l["data"])
                o["listing_name"] = d.get("name", "")
                o["listing_brand"] = d.get("brand", "")
        return rows
    bought = enrich(qall(f"SELECT * FROM orders WHERE buyer_id={PH} ORDER BY created_at DESC", (u["id"],)))
    sold = enrich(qall(f"SELECT * FROM orders WHERE seller_id={PH} ORDER BY created_at DESC", (u["id"],)))
    return {"bought": bought, "sold": sold}

@app.post("/orders/{oid}/complete")
def complete_order(oid: str, u=Depends(current_user)):
    o = q1(f"SELECT * FROM orders WHERE id={PH}", (oid,))
    if not o:
        raise HTTPException(404, "Order not found")
    if o["seller_id"] != u["id"] and u["plan"] != "admin":
        raise HTTPException(403, "Only the seller completes a sale")
    ex(f"UPDATE orders SET status='completed' WHERE id={PH}", (oid,))
    return {"ok": True, "fee": o["fee"]}
