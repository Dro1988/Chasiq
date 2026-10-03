# Chasiq 🏎️
*(cha-seek — chassis + IQ)*

Multi-brand die-cast collection tracker — **100% local-first**. No login, no server, no tracking. Your collection lives in your browser's IndexedDB and never leaves your device.

**Live:** *(Render URL added after first deploy)*
**Repo:** `Dro1988/chasiq`

## Brands (day one)
Hot Wheels · Matchbox · M2 Machines · GreenLight · Mini GT · Tomica · Auto World · Kaido House

## What's in this MVP
- 📦 **Starter catalog** — 139 real, verified castings across all 8 brands (`assets/catalog.js`). Labeled as a starter catalog in-app; the master database grows every release.
- 🔍 **Browse / search / filter** by brand, series, year, text
- 🏠 **My Garage** — add from catalog or as custom cars; per-item quantity, condition (carded/loose + grade), purchase price/date, notes, UPC, and own photos (camera or file upload, resized on-device)
- 📷 **UPC barcode scanner** — getUserMedia + native BarcodeDetector for carded cars
- ✨ **Identify from photo** — honest stub: vision AI is not configured yet, never fakes an ID
- ⭐ **Wishlist + series completion** — "you own X of Y in this series"
- 📊 **Stats dashboard** — total pieces, by brand, by year, total spend
- 💹 **Market values** — honest stub: connect an eBay API key (stored only on-device); no fake prices, ever
- 📥 **CSV import** (the Excel onboarding cheat code) + 📤 **JSON export/backup**
- ℹ️ **About page** — what's live vs. coming soon (AI photo ID, live values, trade matching, hunt mode, cloud sync)
- 📴 **Offline-first** — service worker caches the app shell; all data local

## Tech
Vanilla JS + IndexedDB. Static site — deploy anywhere (Render free static tier).

```
index.html            app shell (references ./assets/* — keep those paths!)
sw.js                 offline cache (bump CACHE name per release)
assets/styles.css     dark collector theme, mobile-first
assets/catalog.js     window.DC_CATALOG — the verified starter catalog
assets/app.js         all app logic
```

## Deploy (Render)
New **static site** named `chasiq`, publish directory = repo root. No build command. Deploys on every push to `main`. See `deploy.py`.
