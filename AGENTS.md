# Repository Agent Guidelines (`MyArtifact`)

All coding and DevOps agents working in this repository must follow this release pipeline, verification gate, and security hygiene policy.

---

## 1. Branching & Release Pipeline (`feat/*` -> `dev` -> `main`)

```text
local branch (feat/*, fix/*, sec/*)
   │  1. Local CI gate passes
   ▼
dev branch  ──(git push origin dev)──▶  GH Actions CI + Neon `dev` migrate  ──▶  Vercel Preview (dev.example.com)
   │  2. Verify staging health, auth, and UI on dev
   ▼
main branch ──(git push origin main)─▶  GH Actions CI + Neon `main` migrate ──▶  Vercel Production (example.com)
```

1. **Develop on short-lived topic branches** (`feat/*`, `fix/*`, `sec/*`, `docs/*`, `chore/*`) created from `dev`. **Never commit directly to `main`.**
2. **Stage in `dev` first:** Merge or PR your topic branch into `dev` and push `git push origin dev`. Pushing `dev` automatically triggers:
   - GitHub Actions (`build-and-test` + `migrate` against the `dev` database secret).
   - Vercel Preview deployment routed to the `dev` domain.
3. **Promote to `main` only after `dev` is verified:** Once staging checks pass, merge `dev` into `main` (via PR or fast-forward) and push `git push origin main` to run production CI, migrate the `main` database, and promote to production.
4. **Commit discipline:**
   - Use small, logical Conventional Commits (`feat(scope): ...`, `fix(scope): ...`, `sec(scope): ...`, `docs: ...`).
   - Always stage explicit file paths (`git add -- <paths>`); **never** run `git add -A` or `git add .` blindly.

---

## 2. Mandatory Local Verification Gate (Before Every Push)

Run the same checks enforced by `.github/workflows/ci.yml` before pushing to `dev` or `main`:

```bash
npm audit --omit=dev --audit-level=moderate
npx tsc --noEmit
npm run build
npm test
```

---

## 3. Deployment & Database Migration Rules

- **Do not run manual `vercel deploy` or `vercel deploy --prod` for routine releases.** Manual CLI deploys bypass GitHub Actions CI, skip the automated PostgreSQL schema migration job, and can leave `origin/dev`, `origin/main`, and live deployments out of sync. Deploy through `git push origin dev` -> `git push origin main` unless the user explicitly asks for an emergency manual deploy.
- **Keep migrations idempotent & backward-compatible:** Any schema updates in `src/cloud/migrations/001_cloud_schema.sql` (and `src/cloud/migrations/schema-sql.ts`) must use additive, idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) so zero-downtime rollouts and Vercel Instant Rollbacks remain safe.
- **Keep serverless invariants intact:** See `docs/cloud-deployment.md` for full deployment methodology (pooled vs. direct Postgres URLs, `MYARTIFACT_SECRET` key derivation, direct-to-S3/R2 presigned transfers above the `4.5 MB` serverless body limit, and conditional ETag `/api/sync`).

---

## 4. Security, Secrets & Documentation Hygiene

- **Never commit or print secrets:** Never stage `.env`, `.env.*`, or `.vercel` files (only `.env.example` is tracked; keep `!.env.example` positioned **after** `.env*` in `.gitignore`). Never echo secret values to stdout or logs.
- **Safe CLI secret piping:** When updating environment variables or repository secrets (`vercel env add`, `gh secret set`), pass values via `stdin` without a trailing newline (`printf '%s'`, never `echo`).
- **Keep repository docs generic:** `AGENTS.md`, `README.md`, and `docs/*` must describe **methodology only**—never hardcode real domains, account IDs, project/branch IDs, org/team slugs, regions, or credentials (always use placeholders such as `example.com`, `dev.example.com`, `<account-id>`, `<region>`).
