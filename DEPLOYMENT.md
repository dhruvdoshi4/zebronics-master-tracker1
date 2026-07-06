# Production deployment

**Live URL:** https://zebronics-master-tracker.vercel.app

| Workspace | Example |
|-----------|---------|
| Rithika | https://zebronics-master-tracker.vercel.app/app/ri/amazon |
| Karan | https://zebronics-master-tracker.vercel.app/app/pa/amazon |
| Hari | https://zebronics-master-tracker.vercel.app/app/amazon |

## After every change (developers & agents)

```bash
git push origin main
npm run deploy:prod
```

`deploy:prod` runs `npm run build` then `vercel deploy --prod` to the linked project.

First time on a machine:

```bash
npx vercel login
npx vercel link   # if not already linked to zebronics-master-tracker
```

## Automatic deploy on push (GitHub Actions)

Workflow: `.github/workflows/deploy-production.yml`

Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|--------|-----------------|
| `VERCEL_TOKEN` | [Vercel account tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Vercel project → Settings → General (Team ID) |
| `VERCEL_PROJECT_ID` | Vercel project → Settings → General (Project ID) |

Until secrets are set, the workflow still runs `npm run build` on push but skips deploy with a warning.

## Vercel Git integration (optional)

In Vercel: Project → Settings → Git → connect `dhruvdoshi4/zebronics-master-tracker1`, production branch `main`.  
Then pushes to `main` also trigger deploys; keep `npm run deploy:prod` as a backup when Git deploy lags.
