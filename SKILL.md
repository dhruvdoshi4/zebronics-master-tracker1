---
name: zebronics-master-tracker
description: >-
  Zebronics Master Tracker — React/Vite app for Monitor + Projector SKUs on Amazon
  and Flipkart: Excel uploads to Supabase, PO metrics, dashboards, product lookup,
  sellout report, Product Master images. Use when continuing development, debugging
  uploads, Supabase RLS, or deployment on a new machine.
license: Private
compatibility: Cursor, Claude Code, any agent reading markdown
metadata:
  project: zebronics-master-tracker
  stack: React, TypeScript, Vite, Tailwind, Supabase, Recharts, SheetJS
tags:
  - zebronics
  - supabase
  - excel-upload
  - internal-tool
---

# Zebronics Master Tracker — Project Memory (SKILL)

Single reference for **everything implemented** in this repo so you (or Cursor on another laptop) can resume without re-discovery. Keep this file **in the repo** so `git pull` brings it everywhere.

**Optional:** Copy into Cursor’s skills folder on another machine:

`cp SKILL.md ~/.cursor/skills/zebronics-master-tracker/SKILL.md`

---

## 1. Purpose

Internal **upload-first** portal for Zebronics **Monitor** and **Projector** SKUs only:

- Daily **Excel** upload → parse → **Supabase** → dashboards + ASIN/FSN lookup + historical sellout-style views.
- **Purchase order** guidance: `PO = max(0, 28-day avg DRR × 28 − marketplace inventory)` (units), aligned with sheet logic where applicable.
- **Amazon** vs **Flipkart** separated (different dashboards, code labels ASIN vs FSN).

Non-technical users: Upload Center, plain wording (avoid “database”, “RLS” in UI where possible).

---

## 2. Tech stack

| Layer | Choice |
|-------|--------|
| UI | React 19 + TypeScript + Vite 8 |
| Styling | Tailwind CSS 3, `clsx`, `tailwind-merge` |
| Routing | `react-router-dom` v7 |
| Charts | Recharts |
| Backend | Supabase (Auth, Postgres, Row Level Security, Storage) |
| Excel | SheetJS (`xlsx`) |
| Deploy | Vercel (env: `VITE_SUPABASE_*`) |

---

## 3. Repo layout (important files)

```
zebronics-master-tracker/
├── src/
│   ├── App.tsx                 # Routes; default `/app/upload`
│   ├── layout.tsx              # Sidebar + full-width main (`minmax(0,1fr)` main column)
│   ├── ui.tsx                  # Card, Button, ChartTooltip, Logo, StatCard, …
│   ├── utils.ts                # cn, normalizeKey, asNumber, formatInteger/Decimal
│   ├── types.ts                # Marketplace, ComputedMetric, MetricInput, UploadRun, …
│   ├── supabase.ts             # Browser client
│   ├── auth-context.tsx / auth-store.ts / use-auth.ts
│   ├── parsers.ts              # Excel → ParsedUploadPayload (Amazon sheet enforced)
│   ├── metrics.ts              # buildComputedMetric (DOC, PO); Excel DRR/DOC preferred
│   ├── data.ts                 # All Supabase reads/writes, ingest, delete upload
│   ├── page-upload.tsx         # Upload Center + history + delete
│   ├── page-dashboard.tsx      # Amazon / Flipkart KPIs + charts + table
│   ├── page-asin.tsx           # Product lookup + CTA → sellout report
│   ├── page-sellout.tsx        # Historical snapshots + “Coming Soon” daily/monthly chart
│   ├── page-products.tsx       # Product Master + local image upload (Storage)
│   ├── page-login.tsx
│   └── index.css
├── public/zebronics-logo.png
├── supabase/
│   ├── schema.sql              # Full DDL + RLS (source of truth for new projects)
│   └── migrations/
│       ├── 001_upload_snapshot_date.sql
│       └── 002_computed_metrics_upload_id.sql
├── .env.example                # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── README.md
└── SKILL.md                    # This file
```

---

## 4. Environment / local run

```bash
cd zebronics-master-tracker
npm install
cp .env.example .env.local
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Prod build: `npm run build` → `dist/` for Vercel static hosting.

---

## 5. Routes

| Path | Page |
|------|------|
| `/login` | Login |
| `/app/upload` | Upload Center (admin upload) |
| `/app/asin` | Product lookup |
| `/app/amazon` | Amazon dashboard |
| `/app/flipkart` | Flipkart dashboard |
| `/app/products` | Product Master |
| `/app/sellout/:marketplace/:code` | Sellout-style report (snapshots table + charts) |

Default redirect: `/app` → `/app/upload`.

---

## 6. Supabase — schema essentials

Run **`supabase/schema.sql`** on a new project (SQL Editor). For **existing** projects that predate changes, run migrations **in order**:

1. `001_upload_snapshot_date.sql` — `uploads.snapshot_date` (picker date per upload).
2. `002_computed_metrics_upload_id.sql` — `computed_metrics.upload_id` → `uploads.id`.

### Core tables

- **`profiles`** — `id` = `auth.users.id`, `role` = `admin` | `viewer`.
- **`uploads`** — one row per upload attempt; includes **`snapshot_date`** (must match ingest picker).
- **`product_master`** — SKU catalog + optional image URL; upsert key `(marketplace, product_code)`.
- **`computed_metrics`** — numeric snapshot per SKU per day; unique `(marketplace, product_code, as_of_date)`; optional **`upload_id`** linking to `uploads`.
- **`ingestion_errors`** — optional row-level errors; FK `upload_id` → `uploads` CASCADE delete.
- **`daily_sales`** — optional bulk daily rows (currently **not** filled from parser — sellout daily chart is “Coming Soon”).
- **Storage bucket `product-images`** — product photos; public read, admin write (see schema).

### Critical SQL function: `public.is_admin()`

Must be **`SECURITY DEFINER`** + `set search_path = public` so it **does not recurse** into `profiles` RLS (otherwise `uploads` INSERT hits **stack depth limit** / `54001`). If uploads fail with `is_admin` in Postgres logs, recreate function per **`schema.sql`**.

### RLS summary

- Authenticated users: read broadly on metrics/products/uploads as defined in policies.
- **Writes** (uploads, product_master images, computed_metrics upsert): **`admin`** via `is_admin()`.

Promote user to admin:

```sql
update public.profiles
set role = 'admin'
where id = '<uuid from auth.users>';
```

---

## 7. Parser behavior (`src/parsers.ts`)

- **Amazon:** Only sheet **`Consolidated (TEZ + Ecom)`**. Missing sheet → upload error.
- **Flipkart:** Prefers sheets named `Flipkart`, `Sellout`, or `Sheet1`, else first sheet.
- **Sub Category:** Column must exist; value must normalize to exactly **`monitor`** or **`projector`** (case-insensitive via `normalizeKey`). No fuzzy inference from other columns.
- **Headers:** Row detected when ASIN/SKU column + product name column found (`detectHeaderRow`).
- **Product name:** Prefer **Model Name** columns over long titles (`COLUMN_ALIASES.productName`).
- **Excel precision:** `sheet_to_json` uses **`raw: false`** so displayed strings match Excel for DRR/DOC-style fields.
- **Daily columns:** Parser **does not** currently emit `dailySales` (empty array) — bulk daily DB ingest was disabled for performance / Postgres limits.

---

## 8. Metrics (`src/metrics.ts`)

- **`MetricInput`** includes `doc_days_excel` when DOC column exists → **`doc_days`** prefers Excel value (numeric).
- **DRR** taken from sheet (`drr_units`); **PO** = `max(0, 28-day avg × 28 − marketplace inventory)` with rounded fields per existing logic.
- Upsert into **`computed_metrics`** includes **`upload_id`** after upload row is created (`data.ts`).

---

## 9. Ingest pipeline (`ingestParsedUpload` in `src/data.ts`)

1. Insert **`uploads`** with **`snapshot_date`** = UI date picker value (`snapshotDate` must be destructured in function args — bug fixed in history).
2. Upsert **`product_master`**.
3. **`buildComputedMetric`** per row with **`upload_id`** → upsert **`computed_metrics`**.
4. Optional **`ingestion_errors`** batch.
5. Mark upload **`completed`** or **`failed`**.

**Dedupe:** `dedupeRowsByConflict` before batched upserts to avoid PostgreSQL “cannot affect row a second time” on duplicates.

**Performance:** Excel read optimized — enumerate sheets cheaply, then read **only** the target sheet (not whole 17MB workbook twice unnecessarily — see `parseUploadFile`).

---

## 10. Dashboard / lookup semantics (`src/data.ts`)

- **`getDashboardRecords`:** Loads all metrics for marketplace, sorts `as_of_date` descending, keeps **first row per `product_code`** → **latest snapshot only** on dashboards.
- **`findProductWithMetrics`:** Latest metric for one code (lookup).
- **`getProductSelloutHistory`:** **All** `computed_metrics` rows for a SKU, ascending date (sellout page table + inventory chart).

Uploading a **new file** with **different ASINs** **does not delete** old SKUs; it **adds/updates** overlapping keys. Old SKUs remain until metrics deleted (e.g. delete upload) or manual SQL.

---

## 11. Delete upload (`deleteUploadRecord`)

Deletes:

1. **`computed_metrics`** where **`upload_id`** = this upload (precise).
2. **Legacy cleanup:** rows with **`upload_id` IS NULL** but same **`marketplace`** + **`as_of_date`** = upload’s **`snapshot_date`** (covers old rows before `upload_id` column).
3. **`daily_sales`** / **`inventory_snapshots`** where **`upload_id`** matches (if any).
4. **`uploads`** row ( **`ingestion_errors`** CASCADE).

Does **not** delete **`product_master`** (names/images preserved).

**Caveat:** Two uploads **same channel + same sheet date** share one metric row per SKU (unique constraint). Deleting one upload may remove metrics tied to the other if both share null `upload_id` legacy data — UI copy explains briefly.

---

## 12. UI / branding

- **Logo:** `/public/zebronics-logo.png` — login, sidebar, sellout header, favicon.
- **Layout:** No `max-w-7xl` on shell — **full width** beside sidebar for laptop screens (`layout.tsx`).
- **Copy:** Upload delete confirmation uses **plain language** (channel name, formatted sheet date, no jargon).

---

## 13. Sellout page (`page-sellout.tsx`)

- Shows **snapshot history** table + **Inventory & Target** line chart when ≥2 snapshots.
- **Daily/monthly sellout from Excel day-columns** was scoped as **Coming Soon** after disabling heavy `daily_sales` ingest.
- Route from Product Lookup via CTA when user searches a code.

---

## 14. Troubleshooting (historical)

| Symptom | Likely cause |
|---------|----------------|
| `stack depth limit exceeded` on upload | **`is_admin()`** not `SECURITY DEFINER` — fix in `schema.sql` |
| Upload slow (~77s parse) | Was parsing whole workbook; now target sheet only |
| Delete upload but dashboard still shows numbers | Metrics not matching delete filter — fixed with **`upload_id`** + migration `002` |
| `54001` / `is_admin` spam in logs | RLS recursion on `profiles` read policy |

---

## 15. Deployment (Vercel)

- Connect GitHub repo; production env: **`VITE_SUPABASE_URL`**, **`VITE_SUPABASE_ANON_KEY`**.
- SPA: ensure history fallback (e.g. `vercel.json` rewrites to `index.html` if configured).

---

## 16. Git / remote

Typical remote: `https://github.com/dhruvdoshi4/zebronics-master-tracker1.git` (verify with `git remote -v`).

---

## 17. What to do on a **new laptop**

1. Clone repo, `npm install`, `.env.local` with Supabase keys.
2. Supabase: run **`schema.sql`** on empty DB **or** apply **`001`** then **`002`** migrations on existing DB.
3. Ensure **`is_admin()`** is **`SECURITY DEFINER`** (see §6).
4. Create auth user; set **`profiles.role = 'admin'`** for upload users.
5. `npm run dev` — open `/app/upload`, sign in, upload Consolidated Amazon sheet.

---

## 18. Intentional non-goals / deferred

- **Daily/M monthly sellout** from Excel date columns: parser stub empty; UI placeholder on sellout page until a safe bulk strategy (RPC or smaller batches).
- **Full catalog replace** on upload (delete SKUs not in file): not implemented — additive upserts only.

---

*Last aligned with codebase patterns described above; if behavior drifts, compare `src/data.ts`, `src/parsers.ts`, and `supabase/schema.sql` as source of truth.*
