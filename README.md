# Zebronics Master Tracker

Minimal upload-first analytics portal for **Monitor + Projector** SKUs across **Amazon** and **Flipkart**.

## What this app does

- Upload daily marketplace sheets manually (admin only).
- Filters only Monitor/Projector rows.
- Syncs parsed data to Supabase tables.
- Computes:
  - Total SO
  - May MTD
  - Apr SO
  - DRR
  - DOC (`inventory / drr`)
  - Purchase Order (`max(0, drr * 45 - inventory)`)
- Provides:
  - Amazon dashboard
  - Flipkart dashboard
  - ASIN/SKU lookup
  - Product master (image URL management)

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS
- Supabase (Auth + Postgres + RLS)
- Recharts for visuals
- SheetJS (`xlsx`) for Excel parsing
- Vercel deployment

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

3. Add Supabase values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — **service_role** secret from [API settings](https://supabase.com/dashboard/project/niaexyzfpuzidgrzjhlo/settings/api) (local/scripts only; do not add to Vercel)

Run `npm run auth:check-env` to confirm keys are set (not placeholders).

4. Run app:

```bash
npm run dev
```

## Supabase setup

1. Open Supabase SQL editor.
2. Run [`supabase/schema.sql`](supabase/schema.sql).
3. Create auth users (pick one):

   - **Script** (needs real `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`):

     ```bash
     npm run auth:ensure-user -- --email qcom@zebronics.com --password admin --name "Quick Commerce" --role admin
     ```

   - **Dashboard**: Authentication → Users → Add user → `qcom@zebronics.com` / `admin`, enable **Auto Confirm User**, then set profile role to `admin` if needed.

4. Promote one user to admin (if not set via script):

```sql
update public.profiles
set role = 'admin'
where id = '<AUTH_USER_UUID>';
```

## Daily operator workflow (non-technical)

1. Login.
2. Open **Upload Center**.
3. Choose marketplace (Amazon / Flipkart).
4. Select snapshot date.
5. Upload the sheet file.
6. Wait for success message and verify in upload history.
7. Open dashboard and ASIN lookup to verify PO numbers.

## Data assumptions

- App expects columns like ASIN/SKU + Product Name.
- Product images are managed in **Product Master**, not sheet uploads.
- Scope is only Monitor / Projector rows.
- If daily date-wise columns are available, DRR is computed from rolling 17-day daily sales.
- If date-wise columns are missing, parser falls back to available monthly columns where possible.

## Deploy live on Vercel

1. Import this repo in Vercel.
2. Set environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Deploy.
4. Ensure `vercel.json` SPA rewrites are active.

## Notes

- RLS is enabled. Admin users can upload/edit; viewers are read-only.
- If parsing fails, check ingestion errors in Supabase table `ingestion_errors`.
- You can tune parser aliases in [`src/parsers.ts`](src/parsers.ts) for future sheet variations.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
