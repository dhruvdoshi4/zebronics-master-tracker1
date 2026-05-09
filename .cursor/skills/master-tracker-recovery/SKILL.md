---
name: master-tracker-recovery
description: Restore Zebronics Master Tracker working context and machine setup after Cursor reinstall. Use when user says reinstall happened, chat was lost, context is missing, or wants to continue from previous work safely.
disable-model-invocation: true
---

# Master Tracker Recovery

Use this skill when the user says Cursor was reinstalled, chat disappeared, or they want to resume work without re-explaining everything.

## Goal

Recover project context fast, without deleting user work.

## Recovery workflow

1. Confirm project path is available:
   - `Desktop/zebronics/zebronics-master-tracker`
2. Read project memory:
   - `SKILL.md` (repo root)
   - `.cursor/RECOVERY-CONTEXT.md`
3. Check workspace health:
   - Verify git repo is accessible.
   - Run `git status --short` and report if there are uncommitted files.
   - Never reset or discard files unless user explicitly asks.
4. Check local environment:
   - `node -v`, `npm -v`, `git --version`
   - If dependencies missing: run `npm install`
5. Verify runtime config:
   - Ensure `.env.local` exists.
   - If missing keys, ask user for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
6. Start app when user asks:
   - `npm run dev`
7. Before finishing recovery, tell user exactly what is ready and what still needs input.

## Safety rules

- Never print secrets (PAT, API keys) in chat.
- Never commit `.env.local`.
- Never force push unless user explicitly says `force push`.
- Do not modify git global config unless user asks.
- Do not run destructive git commands.

## Response style for this user

- Use plain English and short steps.
- Explain actions before running them.
- Assume user is non-technical.
