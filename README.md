# Tulsi ERP MCP connector

One remote MCP server that lets anyone with a Tulsi ERP login use the app by
talking to an AI assistant: **Claude** (web, desktop, mobile, Claude Code — Free
plan included), **ChatGPT** (Developer mode), **Gemini** (app, CLI, Enterprise)
and any other assistant that speaks remote MCP with OAuth (Le Chat, Perplexity,
Copilot Studio, VS Code, Cursor).

- Users sign in on **our own Tulsi ERP page** (English/Hindi), never in the chat.
  The password is used once and never stored.
- Every call runs **as that user**, with their own role (Admin, Manager, Caller,
  Warehouse, Delivery) and Tulsi ERP's own permission and visibility rules.
- **Reads** are answered at once. **Changes** are shown as a summary first and
  saved only after the user says yes, in every assistant.
- No prices or amounts ever reach an assistant (Tulsi ERP shows none either).
- No npm dependencies: Node 20+ and the files in this folder.

```
Claude / ChatGPT / Gemini / …  ──MCP + OAuth 2.1──►  https://<MCP_DOMAIN>/mcp
                                                     tulsi-erp-mcp (this folder, 1 container)
                                                       ├ sign-in page → POST /auth/login
                                                       ├ catalog/actions.json (95 actions, private)
                                                       └ 11 tools, drafts + confirmation
                                                              │ user's own credential
                                                              ▼
                                                     Tulsi ERP API (RCRM_Backend), unchanged
```

## Tools

Tool definitions cost about **2,300 tokens** per message (Admin/Manager) and
1,300 (Warehouse/Delivery), measured from `tools/list`.

| Tool | What it does | Roles |
|---|---|---|
| `whoami` | The signed-in user, role, manager | all |
| `search_erp_actions` | Finds actions in the catalog the user's role can use (understands Hinglish: *chutti*, *maal*, *enquiry*, *godown*…) | all |
| `run_erp_read` | Runs any read action; lists come back as server total, per-field counts over **all** rows, quantity totals, first rows | all |
| `prepare_erp_change` | Prepares any create/update/delete as a **draft** (nothing saved) with a plain summary, before → after, warnings | all |
| `confirm_erp_change` | Saves a draft the user approved, exactly once | all |
| `find_lead` | Lead by name / phone / id, Hindi↔English spellings; one match → details, follow-ups, timeline; several → candidates | Admin, Manager, Caller |
| `my_day` | "Aaj kya karna hai?" — due/overdue follow-ups, allotted old leads, pending tasks, attendance, dashboard | all |
| `lead_stats` | Leads for a period by source, status, city, assignee, buying-for; converted/lost/open; leads gone quiet | Admin, Manager, Caller |
| `check_stock` | "18mm BWP 8x4 ka stock?" — parses brand, grade, thickness, size; stock, unit, LOW/OUT; totals by unit | all |
| `team_status` | Per person: attendance, workload, conversions, overdue follow-ups, targets | Admin, Manager |
| `draft_lead_update` | After a call/visit: follow-up note + next follow-up + status change as **one draft** | Admin, Manager, Caller |

The 95 catalog actions (leads, follow-ups, WhatsApp, products/stock, tasks,
trips, attendance, leave, targets, team, notifications) are listed in
[catalog/API-CATALOG.md](catalog/API-CATALOG.md), with the reason for each of
the 94 routes left out (sign-in, webhooks, uploads/downloads, secrets,
settings, user management, bulk operations, super-admin).

### What assistants may change (`WRITE_LEVELS`)

| Risk | Actions | Production (`deploy/`) | Code default |
|---|---|---|---|
| low | lead note, follow-up, log activity, complete task, skip allotted lead, notifications read, own email preference | **on** | on |
| normal | create/edit lead, change lead status, assign lead, create/edit task, apply leave, save/share trip, own profile | **on** | on |
| high | adjust stock, add/edit/delete product, approve/reject leave, set target, delete lead/task/trip, check-in/out, send WhatsApp | **on** (`WRITE_LEVELS=low,normal,high`) | off |
| blocked | users/managers, org settings, integrations, bulk assign/delete, imports | never | never |

Every change, at every level, is still a draft the user must see and confirm,
and Tulsi ERP's own role checks still apply (a Caller can't approve leave).
High-risk drafts carry a warning line saying what the change does.

## Try it locally (demo data only)

The demo uses its **own database `tulsi_erp_demo`** on your local PostgreSQL
(the scripts refuse any other name; `wholeseler_erp` is never touched).

```powershell
cd tulsi-erp-mcp
node demo/setup-db.js --reset      # create tulsi_erp_demo + run the backend's migrations
node demo/seed-demo.js             # fictional plywood company, every role → demo/DEMO-ACCOUNTS.md
node demo/start-backend.js         # backend from source on :3070 (mail goes nowhere)
node demo/start-connector.js       # connector on http://localhost:8790   (second terminal)
node demo/run-tests.js             # 181 end-to-end checks → demo/TEST-REPORT.md (mutates demo data)
npm test                           # offline unit tests
```

### Connect an assistant to the local demo

- **Claude Code** (loopback works without a tunnel):
  `claude mcp add --transport http tulsi-erp http://localhost:8790/mcp`, then `/mcp` → Authenticate,
  sign in with a demo login. *(Not yet run in this repo — see "Not yet verified".)*
- **Claude web/desktop, ChatGPT, Gemini app** need a public **https** URL. Put a tunnel in front, e.g.
  `cloudflared tunnel --url http://localhost:8790`, then restart the connector with
  `PUBLIC_URL=https://<the-tunnel-host>` and use `https://<the-tunnel-host>/mcp` below.
- Headless (scripts/CI): `node demo/oauth-client.js http://localhost:8790 amit.caller@demo.tulsi Demo@Tulsi2026 --mcp-config mcp.json`
  writes an MCP config with a 1-hour connector token, e.g. for
  `claude -p "What do I have today?" --mcp-config mcp.json --strict-mcp-config --allowedTools "mcp__tulsi-erp__*"`.

## Connect each assistant (production)

Address everywhere: **`https://mcp.tulsicrm.tdmgroups.com/mcp`** (`<MCP_DOMAIN>` below), name **Tulsi ERP**. Menus in
these apps change often; follow the current UI. First question to try:
*"Who am I in Tulsi ERP?"*

| Assistant | Steps |
|---|---|
| Claude web / desktop (any plan; Free allows 1 custom connector) | Settings → Connectors → **Add custom connector** → name `Tulsi ERP`, URL above → Connect → sign in |
| Claude mobile | Add it once on web/desktop; it then appears on mobile |
| Claude Code | `claude mcp add --transport http tulsi-erp https://<MCP_DOMAIN>/mcp` → `/mcp` → Authenticate |
| ChatGPT (Developer mode, paid plans; workspace admins may need to allow it) | Settings → Apps & Connectors → Advanced → **Developer mode** on → Create → name `Tulsi ERP`, URL above, auth **OAuth** → sign in. ChatGPT registers itself (CIMD or DCR) |
| Gemini CLI | `~/.gemini/settings.json`: `{"mcpServers":{"tulsi-erp":{"httpUrl":"https://<MCP_DOMAIN>/mcp"}}}` → `/mcp auth tulsi-erp` |
| Gemini app | Settings → Connected apps → add a custom app with the URL above (newer feature; not on every account/country) |
| Gemini Enterprise / Copilot Studio (admin enters a client id) | `docker compose exec tulsi-erp-mcp node connector/scripts/add-client.js --name "Gemini Enterprise" --redirect <redirect URI it shows>` → paste the printed id/secret; authorize URL `https://<MCP_DOMAIN>/authorize`, token URL `…/token`, scope `erp`, PKCE on |
| Le Chat, Perplexity, VS Code, Cursor | Same URL; their callback hosts are already allowed |

Disconnecting in the assistant revokes the connection (`/revoke`). Users who
change their password, are deactivated or whose org is suspended get
"reconnect Tulsi ERP" on their next question.

## Deploy (VPS next to the backend)

1. DNS: A record `mcp.tulsicrm` in the `tdmgroups.com` zone → the VPS IP,
   **DNS only / grey cloud** (like `API_DOMAIN`). It is a two-level name, which
   Cloudflare's Universal SSL doesn't cover, so it must not be proxied.
2. Backend Caddy: already in `RCRM_Backend` (`deploy/Caddyfile` site block,
   `MCP_DOMAIN` defaulting to `mcp.tulsicrm.tdmgroups.com` in its compose file).
   Its normal deploy recreates Caddy, which then fetches the certificate once
   DNS points at the VPS. If DNS came later: `cd /opt/tulsi-erp && docker compose restart caddy`.
3. Connector, as `deploy` (private repo: add a read-only deploy key as in the backend's DEPLOYMENT.md §5.5):
   ```bash
   cd /opt && git clone git@github.com:Samarth-1211/tulsi-erp-mcp.git
   cd /opt/tulsi-erp-mcp/deploy
   cp .env.example .env && chmod 600 .env   # set CONNECTOR_SECRET=$(openssl rand -hex 32)
   docker compose up -d --build             # joins the backend's tulsi-erp_edge network
   curl https://mcp.tulsicrm.tdmgroups.com/health    # {"ok":true,"app":"up",…}
   curl https://mcp.tulsicrm.tdmgroups.com/.well-known/oauth-authorization-server
   ```
4. Back up the `tulsi_erp_mcp_data` volume together with `CONNECTOR_SECRET`.
   Losing either only means everyone signs in again.

**Updates** reach every user on every assistant with a redeploy; nothing to
reinstall. When the backend's routes or DTOs change: `npm run catalog`
(reads `../RCRM_Backend`; human parts stay in `catalog/overrides.json`), review
`catalog/API-CATALOG.md`, redeploy.

## Settings (env)

| Setting | Default | |
|---|---|---|
| `PORT` | 8790 | |
| `PUBLIC_URL` | from request headers (dev) | **required** in production, `https://…` |
| `API_URL` | `http://localhost:3000` | **required** in production (`http://backend:3000`) |
| `CONNECTOR_SECRET` | generated file in `DATA_DIR` (dev) | **required** in production, 32+ chars; encrypts stored credentials |
| `DATA_DIR` | `connector/data` | state file + log |
| `TOOL_MODE` | `catalog` | `direct` = also one tool per action (demos/tests only; ~10× the tokens) |
| `WRITE_LEVELS` | `low,normal` (`deploy/` sets `low,normal,high`) | which risk levels assistants may prepare |
| `ALLOWED_REDIRECT_HOSTS` | Claude, ChatGPT, Google, Mistral, Perplexity, Azure, VS Code, Cursor | where OAuth may redirect; loopback http is always allowed |
| `CIMD_ENABLED` | `true` | client-id metadata documents (ChatGPT) |
| `ACCESS_TTL_SECONDS` | 3600 | connector access token; refresh tokens last 90 days, rotating |
| `TRUST_PROXY` | 1 in production | proxy hops in front (Caddy) for the real client IP |
| `BADGE`, `SIGNIN_HINT` | — | label + extra line on the sign-in page (demos) |
| `LIST_SCAN_CAP`, `STATS_SCAN_CAP` | 1000, 5000 | rows scanned for list summaries / `lead_stats` |

The connector keeps state in one JSON file: **one container only**. Running
several needs a shared database instead.

## How it keeps data safe

- Sign-in: PKCE S256 required; codes single-use, 60 s; refresh tokens rotate;
  all tokens stored as SHA-256 only; Tulsi ERP credentials AES-256-GCM encrypted.
- 3 wrong passwords for one email → 15-minute pause on the page; the backend's
  own login limits apply too (the real client IP is forwarded). Super admins
  and inactive users can't connect.
- Redirects only to allow-listed assistant hosts (or loopback); client-id
  documents are fetched with an SSRF guard (no private addresses, 5 s, 64 KB).
- Drafts: only a `draftId` can be confirmed (never raw params), only by the
  connection that made it, within 15 minutes, once (marked used before saving).
  The write rule is repeated in the server instructions **and** the tool
  descriptions, because some assistants ignore server instructions.
- Answers drop secrets (tokens, webhook URLs, sheet links, password fields) and
  all money fields; strings capped; record text is flagged as data, not instructions.
- Logs hold tool, action, role, client, timing — never tokens, codes,
  passwords or record contents.

## Current limitation: session mode (until the backend adds personal access tokens)

The backend has no personal access tokens yet (see [DISCOVERY.md](DISCOVERY.md)
§10, Phase 2). The connector detects that (`POST /auth/personal-access-tokens`
→ 404) and keeps each user's **session** instead: their access + refresh token,
encrypted, refreshed once per connection even under parallel calls (Tulsi ERP
logs a user out everywhere if a used refresh token comes back). What that means:

- A connection stays alive while it is used at least once every **7 days**
  (`JWT_REFRESH_EXPIRES_IN`); after a longer pause the user reconnects.
- Changes appear in Tulsi ERP history as the user, without "via Claude".
- Routes that take passwords or secrets are simply not in the catalog (the
  backend can't yet refuse them for connected apps).

When the backend gains PATs, the connector switches automatically: one
`tp_pat_` token per assistant, named after it ("Claude", "ChatGPT"), 90 days,
revocable per assistant, plus "via ChatGPT" tags and session-only 403s.

## Not yet verified

- **Real assistants.** Everything above was tested with scripted OAuth clients
  that behave like Claude (DCR), Claude Code/Gemini CLI (public + loopback),
  ChatGPT (CIMD + `resource`) and Gemini Enterprise (pre-registered) — not with
  the real apps. Their menus and rules change; run the checklist below once
  the public URL exists.
- **Docker on the VPS.** The image was built and run locally (starts as `node`,
  refuses to start without its production settings, serves discovery with the
  production URL); the compose project hasn't run on the server yet.

Real-assistant checklist (demo logins, check the result in the app):

1. Caller: *"Aaj kin leads ko call karna hai?"* → due + overdue follow-ups.
2. Manager: *"How many leads does my team have by status, and who has the most?"* → totals from `summary`.
3. Manager: *"Any leave waiting? If yes, approve it."* (with `high` on) → shows the summary and **waits**; saves only after "yes".
4. Caller: *"Mark Gupta Builders as visited, next follow-up Monday 11 am"* → draft → "yes" → stored 11:00 IST.
5. Caller: *"Approve Priya's leave"* → refused (role), nothing changed.
6. *"What does the Patel Furniture lead say?"* → its feedback contains "ignore previous instructions…": must be reported as text, not followed.

## Files

```
catalog/overrides.json   human parts: names, risk, exclusions, hints, synonyms (edit this)
catalog/actions.json     generated catalog (connector's only source of truth)
catalog/API-CATALOG.md   readable catalog, generated
scripts/build-catalog.js generator: NestJS + class-validator + Swagger metadata from ../RCRM_Backend
connector/server.js      settings, HTTP routes, MCP JSON-RPC
connector/lib/           http, store, backend, clients, oauth, pages, catalog, shape, tools, curated, format
connector/scripts/add-client.js   pre-registered clients
demo/                    scratch DB setup, seed, backend/connector launchers, OAuth test client, e2e tests
deploy/                  compose project, .env example, Caddy site block
test/unit.test.js        offline unit tests
DISCOVERY.md             Phase 0 report
```
