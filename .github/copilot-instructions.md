# Copilot instructions for letslearnalgebra

Purpose: quick reference so Copilot-powered sessions can act effectively in this repo.

## Quick commands
- Lint (recommended):
  - Project-wide: npx eslint . --ext .js --cache
  - Single file: npx eslint s/auth.js
- Run / preview locally:
  - Open the static site files in a browser (files under `s/`).
  - Serve the `s/` directory with a static server (example): npx serve s  or npx http-server s -p 8080
- Tests: none (no test scripts present). If tests are added, follow package.json scripts.
- Supabase (DB + functions):
  - Migrations are under `supabase/migrations/`.
  - Edge/HTTP functions are under `supabase/functions/` (TypeScript / Deno import maps present).
  - Use the Supabase CLI (supabase) to deploy functions and apply migrations when managing the backend.

## High-level architecture (big picture)
- Frontend: static site and client-side JS under `s/`.
  - `s/server.js`, `s/auth.js`, `s/commands.js` implement the realtime chat UI and Supabase integration.
  - `s/schoolwork/` contains many static HTML lesson pages (the educational content).
- Backend: Supabase PostgreSQL + Edge/HTTP functions.
  - DB schema and non-destructive migrations live in `supabase/migrations/`.
  - Server-side functions in `supabase/functions/` (TS/Deno). These implement link previews, push send, message censorship, GIF resolution, etc.
- Realtime model: clients use Supabase realtime channels to subscribe to Postgres changes (tables such as channels, categories, messages, typing, server_members). Frontend code uses patterns like `supabaseClient.channel(...).on('postgres_changes', ...)`.

## Key conventions and patterns
- Local state keys (important for continuity & automation):
  - chatUsername (localStorage) — primary username key the frontend expects.
  - chatSysAdmin, chatSysManager — flags stored as "true"/"false" in localStorage.
  - lla_seen_before_<auth_id> — tracks first-login tutorial completion.
- Ordering and identity conventions:
  - Many tables use `sort_order` for UI ordering (channels, server_members, etc.).
  - `server_id` (UUID) scopes most rows. Expect `server_id` filters on many queries.
- Database and migration style:
  - Migrations are non-destructive where possible and add indexes for read-heavy realtime patterns (see `20260417_server_settings_and_perf.sql`).
  - Custom enum-like checks may be enforced via SQL constraints (e.g., custom_emojis.visibility check: 'everyone'|'admins'|'owner').
- Supabase functions:
  - Functions use Deno/TypeScript with import maps (see `deno.json` files and `supabase/config.toml`). Deploy with the Supabase CLI.
- Linting / JS environment:
  - `eslint.config.js` targets browser globals (window, document, fetch, etc.) and allows `console`.
  - Rule: `no-unused-vars` is relaxed for some named patterns (see config). Run npx eslint with --ext .js.
- Real-time subscription management:
  - Subscriptions are frequently created per-server (channel names include server id). Before subscribing, code unsubscribes previous subscriptions — follow this pattern when adding realtime listeners to avoid leaks.

## Files/places to inspect for context
- s/server.js — main frontend realtime/chat logic (large file, good entry point for behavior).
- s/auth.js — auth and profile provisioning (localStorage keys and signup/signin flows).
- supabase/migrations — DB migrations and index additions.
- supabase/functions — server-side functions (TS) and deno import maps.
- eslint.config.js — linting assumptions and globals.

## Existing AI / assistant configs checked
- No CLAUDE.md, AGENTS.md, .cursorrules, .windsurfrules, AIDER_CONVENTIONS.md, .clinerules, or other assistant rule files detected to merge.

## Notes for Copilot sessions
- Prefer reading `s/server.js` and `s/auth.js` for UI/data-flow rather than guessing data flows from a single file.
- When suggesting code that modifies DB columns or queries, cross-check `supabase/migrations/` and existing SQL to avoid schema mismatches.
- Realtime code must unsubscribe old channels before creating new subscriptions — keep that pattern.

---

If anything should be added (examples: common refactors, test harness suggestions, or CI automation steps), say which area and a short justification and the repo will be updated accordingly.
