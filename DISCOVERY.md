# Tulsi ERP MCP connector — Phase 0 discovery

Date: 2026-11-03 · Read-only: no code, database or deploy file was changed.
Sources: `RCRM_Backend/` (NestJS source, Prisma schema, docs, compose files) and
`Tulsi_Frontend/` (navigation). No live API calls were made.

> **Biggest finding.** The ERP modules in the prompt's example (quotations,
> sales orders, dispatch, invoices, payments, dues/ageing, schemes, multiple
> godowns) **do not exist yet**. The backend's own `CLAUDE.md` says "Phase 2
> (inventory, customers, orders, dispatch, billing) is out of scope". What
> exists today is a **sales CRM + field-staff app + simple product stock**.
> And by design **no money ever leaves the API** (`MoneyFieldsInterceptor`
> strips `price`, `costPrice`, `estimatedValue`, `autoAllotMinValue`). The tool
> design below is built on what really exists; the catalog generator will pick
> up orders/billing automatically when those modules are built.

---

## 1. Project sheet (filled in)

| Key | Value | Status |
|---|---|---|
| `<PRODUCT>` | **Tulsi ERP** (Swagger title "Tulsi ERP API"; frontend "Tulsi ERP"). It's multi-tenant; Tulsi Plywood is the first org | confirm name staff use |
| `<slug>` | `tulsi-erp` | proposed |
| `<dw>` | `erp` → `search_erp_actions`, `run_erp_read`, `prepare_erp_change`, `confirm_erp_change` | proposed |
| `<px>` | `tp` → `tp_pat_`, `tp_at_`, `tp_rt_`, client ids `tp_` | proposed |
| `<MCP_DOMAIN>` | `mcp.<domain>` — the real domain isn't in the repo (`.env.production.example` uses `api.example.com`) | **open** |
| `<API_URL>` | `http://backend:3000` on the compose `edge` network (prod); `http://localhost:3000` (dev) | found |
| `<BUSINESS_TZ>` | `Asia/Kolkata` (hard-coded in `common/utils/business-date.util.ts`; also `OrgSettings.timezone`) | found |
| `<CURRENCY>` | INR, but **no amounts are exposed** (see above). Connector will format quantities only | found |
| Access | **A** — full backend source, we can change it (separate git repo, `origin` = `Samarth-1211/Tulsi_ERP`) | found |
| Software type | In-house: NestJS 10 · Prisma 5 · PostgreSQL 16 · class-validator · Swagger · passport-jwt | found |
| Roles | `SUPER_ADMIN` (platform; never connects), `ADMIN`, `MANAGER`, `CALLER`, `DELIVERY_PARTNER`, `WAREHOUSE_STAFF` | found |
| Scope v1 | proposed in §6 | **approve** |
| Hosting | One Hostinger VPS, Docker Compose: `postgres` + `backend` + `caddy` (Let's Encrypt, DNS-only, not proxied through Cloudflare). Frontend is a static SPA on Cloudflare Workers. One backend instance | found |
| Who approves | — | **open** |

---

## 2. Stack and hosting

- **Backend:** NestJS modular monolith, MVC per module folder. Global
  `ValidationPipe` with `whitelist + forbidNonWhitelisted` (unknown fields → 400).
  Global `HttpExceptionFilter` already maps Prisma errors to 4xx and hides 500
  details. `helmet`, `x-powered-by` off, `TRUST_PROXY` already supported
  (default 1 in prod).
- **Already in place** (prompt §6.2 "hardening" is mostly done):
  `GET /health` (`{status:'ok', database:'up'}` / 503), Swagger off in
  production unless `SWAGGER_ENABLED=true`, generic 500 messages.
- **Rate limiting:** `@nestjs/throttler`, 600 req/min per user; login 10/min,
  forgot-password 3 per 10 min, reset 10/min — keyed by IP + email.
- **Deploy:** `docker-compose.yml` (backend runs `prisma migrate deploy` on
  start), `deploy/Caddyfile` serves only `{$API_DOMAIN}`. The connector would be
  a 4th service plus a second Caddy site block.
- **Databases:** local dev DB is `wholeseler_erp` (in `.env`). I'll treat it as
  shared and **not** migrate it; Phase 2 would use a scratch DB `tulsi_erp_demo`.
- **Tests:** `node:test` via ts-node, 17 spec files (~170 cases).
- **Bilingual UI:** Hindi/English (`t()` + `src/i18n/hi.ts`). Lead and product
  search already matches names across scripts ("ramesh" finds "रमेश") through a
  phonetic `searchKey`.

## 3. Auth

| Item | Finding |
|---|---|
| Login | `POST /auth/login {email, password}` → `{accessToken, refreshToken, expiresIn, user{id,email,name,role,orgId}}`. Email is globally unique, so **no company picker** is needed |
| Tokens | JWT access 15 min (`JWT_ACCESS_EXPIRES_IN`); opaque refresh token 7 days, SHA-256 stored, **rotating with reuse detection**: a rotated token reused after 60 s revokes **all** the user's sessions |
| Refresh / logout | `POST /auth/refresh`, `POST /auth/logout {refreshToken}` |
| Forgot / reset | Email **OTP**: `POST /auth/forgot-password {email}` then `POST /auth/reset-password {email, otp, newPassword}`. Reset revokes all refresh tokens. Returns 503 if SMTP isn't configured |
| 2FA | None |
| Verification | Unverified accounts get 401 "Please verify your account…" |
| Inactive / deleted / suspended org | Refused at login **and** on every request (`JwtStrategy.validate` reloads the user) |
| Super-admin | Same `/auth/login` accepts SUPER_ADMIN (plus a separate `/auth/super-admin/login`). Connector must refuse them |
| Guard | `JwtAuthGuard` (passport `jwt`) + `RolesGuard` + `@Roles(...)`. **Role and orgId come from the JWT payload**, not the DB (status is fresh, role is up to 15 min stale) |
| Per-user API keys / own OAuth | **None** |

**→ Sign-in path A (add personal access tokens).** We can change the backend,
and path C would be fragile here: the refresh-token reuse detection would log
users out of the web app if the connector ever raced a refresh.

## 4. Roles and tenancy

- Every tenant row has `orgId`; every query is scoped by the caller's `orgId`.
- Lead visibility (`common/utils/lead-scope.util.ts`): ADMIN = whole org;
  MANAGER = own + direct team; CALLER = own; DELIVERY_PARTNER / WAREHOUSE_STAFF
  = none.
- Inventory: read for all org roles; write for ADMIN, MANAGER, WAREHOUSE_STAFF;
  delete ADMIN, MANAGER.
- Hierarchy: ADMIN creates MANAGER/CALLER/DELIVERY/WAREHOUSE; MANAGER creates
  team members under self. No branches or warehouses in the model.

## 5. Route inventory (189 routes, 26 controllers)

| Module | Routes | Notes |
|---|---:|---|
| leads (+ follow-ups/today) | 26 | CRUD, status, assign, notes, follow-ups, timeline, team-performance, filter options; **imports (multipart), downloads, bulk-assign, bulk-delete, lost/shuffle** |
| trips | 17 | route planning (OSM), saved trips, sharing, trip → site-visit tasks; `cities` admin fixes |
| notifications | 12 | list/read; **push subscribe/test** (device-only); admin email settings |
| organizations | 10 | **SUPER_ADMIN only** |
| employees | 9 | team summary/rollup, profile/overview; **`me/email`, `me/password` take passwords** |
| inventory | 9 | products list/summary/detail, create, edit, **stock adjust**, delete; **import (multipart), template download** |
| manager (team) | 9 | create/edit/delete team members (**create takes a password**), assign lead to team |
| attendance | 8 | check-in/out (lat/lng optional; check-out needs a work summary), today/me/team/org/range |
| platform-integrations | 8 | ADMIN; GET returns **webhook URL with secret token, Google Sheet URL, Meta verify token**; `reveal-secret` |
| managers | 8 | ADMIN; create (**password**), deactivate, delete |
| whatsapp chat | 8 | inbox, templates, per-lead messages; **send message/template, media upload/download** |
| users | 7 | create (**password**), list, deactivate, delete |
| auth | 7 | handled by the connector's sign-in page |
| tasks | 7 | personal + delegated to-dos, reminders |
| whatsapp debug / integration / webhook / ad-sources | 7+7+2+1 | admin/debug/secrets/webhooks |
| activities · leave · task-allotment | 6 · 6 · 5 | daily activity log + reports; leave apply/approve/reject; auto-allotted old leads |
| targets · settings (allocation) · dashboard · health · lead webhooks | 3 · 2 · 1 · 1 · 3 | |

**Pagination:** `page` + `pageSize`, response `{items, total, page, pageSize}`
everywhere. Leads max pageSize 200 (default 25); products default 50 with
**no max**. Server-side totals: lead `total`, `GET /inventory/summary`
(products, units, low/out of stock, per category), `GET /leads/team-performance`
(per caller: leads, open, converted, lost, %, overdue), `GET /leads/filter-options`
(counts per Buying-For/Requirement value), `GET /dashboard/me` (role-specific
stats), `employees/team-rollup`, `attendance/org|team`, `targets/team`.
**Missing:** counts *by source / status / city* for a date range — the connector
would have to page through leads (200 per page) and count.

**Document life cycles:** only leads (`NEW → ASSIGNED → IN_PROGRESS →
CONVERTED | LOST`; CONVERTED needs a note, LOST needs `lostReason`; LOST may
auto-reassign the lead if `autoReallocateLostLeads` is on), leave
(`PENDING → APPROVED | REJECTED | CANCELLED`), tasks (`PENDING → COMPLETED |
CANCELLED`). Deletes are soft (`deletedAt`). No accounting or tax postings exist.

**Units:** products have `unit` (SHEET, PIECE, BOX, SQFT, KG), integer `stock`,
`reorderLevel`, free-text `thickness` ("18mm"), `size` ("8x4 ft"), `grade`
(MR/BWR/BWP/Marine…), `brand`, `category`. **One stock number per product — no
warehouses/godowns, no reserved vs free.** Stock changes go through
`PATCH /inventory/products/:id/stock {change, reason, note}` and are recorded as
`StockMovement` rows (RECEIVED, SOLD, DAMAGED, CORRECTION…).

**Existing AI features:** none. **Audit:** `LeadActivityLog` (userId, type,
message, `meta` JSON) for leads; `StockMovement.userId` for stock;
`UserAuditLog` / `OrganizationAuditLog` for admin actions; `Task.createdById`;
`EmployeeActivity`.

## 6. Proposed write scope for version 1

| Risk | Actions | v1 |
|---|---|---|
| `low` | add lead note · log follow-up (note, outcome, next date) · log my activity · create / edit / complete my own task · skip an allotted lead · mark notifications read | **on** |
| `normal` | create lead · edit lead details · change lead status (incl. CONVERTED/LOST, with a warning when LOST may auto-reassign) · assign lead (Admin/Manager) · create a task for a team member · apply for leave | **on** |
| `high` | stock adjustment (received/sold/damaged) · create / edit product · approve / reject leave · set targets · delete task · delete lead · delete product · **send a WhatsApp message to a customer** · check-in / check-out | off unless you approve; I suggest turning on **stock adjustment** and **approve/reject leave**, since those are daily asks |
| `blocked` | users/managers/team-member create/deactivate/delete · organizations · all settings (allocation, task allotment, notification emails, cities) · integrations + WhatsApp setup + debug · bulk assign / bulk delete / lost shuffle · imports · deleting a lead import's leads | never exposed |
| excluded | auth, webhooks, push setup, file downloads/uploads/media, `leads/seen`, `unseen-count`, `me/email`, `me/password`, `reveal-*` | never exposed |

Attendance check-in/out via chat is listed as `high` on purpose: it's a
time-and-presence record, and the web app can capture location. Your call.

## 7. Business question inventory

R = read, W = write. "Calls" = calls with the 5 core tools after the
action is known (search adds 1). ★ = top 15 by expected frequency.

| # | Who | Question (as staff would ask) | R/W | Actions | Calls | Server total? |
|---|---|---|---|---|---:|---|
| 1★ | Caller | "Aaj kin leads ko call karna hai?" — today's + overdue follow-ups | R | follow_ups_today | 1 | yes (list total) |
| 2★ | Caller | "What's on my plate today?" (follow-ups, allotted leads, tasks, attendance) | R | dashboard_me, follow_ups_today, task_allotment_me, tasks_mine, attendance_today | 5 | partly |
| 3★ | All lead roles | "Sharma Interiors ka lead kahan tak pahuncha?" / "who is 98xxxxxx?" | R | list_leads(search), get_lead, lead_activities | 2–3 | n/a |
| 4★ | Admin/Mgr | "How many new enquiries this week, and from which source?" | R | list_leads(from,to) × pages | 1–N | total yes, **by source no** |
| 5★ | Caller | "Mark Gupta Builders as visited today, next follow-up Monday" | W | list_leads, add_lead_follow_up (+ change_lead_status) | 3–4 | — |
| 6★ | Caller | "Add a lead: Ramesh, 98…, Indore, needs 18mm BWP 40 sheets" | W | create_lead | 1+confirm | — |
| 7★ | Wh/Mgr | "18mm BWP 8x4 ka stock kitna hai?" | R | list_products(search) — thickness/grade/size aren't server filters | 1–N | no |
| 8★ | Admin/Mgr | "Which products are low or out of stock?" | R | list_products(lowStock), inventory_summary | 1–2 | yes |
| 9★ | Mgr/Admin | "Who on my team converted the most this month?" | R | team_performance | 1 | yes |
| 10★ | Mgr | "Who hasn't checked in today?" | R | attendance_team / attendance_org | 1 | yes |
| 11★ | Mgr | "Any leave waiting? approve Rahul's" | R+W | leave_team_pending, approve_leave | 2+confirm | — |
| 12★ | Caller | "Mark lead X as lost — price too high" | W | list_leads, change_lead_status | 2+confirm | — |
| 13★ | Mgr/Admin | "Assign the Indore leads from yesterday to Priya" | W | list_leads, users list, assign_lead × n | 3+ | — |
| 14★ | All | "My target vs actual this month?" | R | targets_me | 1 | yes |
| 15★ | Wh | "Got 50 sheets of 18mm Century BWP today — add to stock" | W | list_products, adjust_stock | 2+confirm | — |
| 16 | Admin | "How many leads converted vs lost this month, by city?" | R | list_leads × pages | N | no |
| 17 | Admin/Mgr | "Leads with no follow-up for 7+ days" | R | list_leads × pages (filter on lastActivityAt) | N | no |
| 18 | Mgr | "Show Amit's leads that are still open" | R | users, list_leads(assignedToId,status) | 2 | yes |
| 19 | Caller | "Last thing said to Verma ji?" (timeline) | R | list_leads, lead_activities | 2 | n/a |
| 20 | Caller | "Kya Verma ji ne WhatsApp pe reply kiya?" | R | list_leads, lead_whatsapp_messages | 2 | n/a |
| 21 | Admin/Mgr | "Unread WhatsApp chats?" | R | whatsapp_inbox | 1 | ? |
| 22 | Caller | "Add a note to Patel Furniture: wants a quote for laminates" | W | list_leads, add_lead_note | 2+confirm | — |
| 23 | Caller | "Change Ramesh's city to Dewas and add alt phone" | W | list_leads, update_lead | 2+confirm | — |
| 24 | Mgr | "Remind Sunil tomorrow 11 am to call Jain Hardware" | W | users, list_leads, create_task | 3+confirm | — |
| 25 | All | "My pending tasks?" | R | tasks_mine | 1 | ? |
| 26 | Mgr | "Tasks I gave to my team that are still pending" | R | tasks_assigned_by_me | 1 | ? |
| 27 | All | "Apply leave 10–12 Nov, sister's wedding" | W | apply_leave | 1+confirm | — |
| 28 | All | "Mera attendance is mahine?" | R | attendance_me | 1 | partly |
| 29 | Admin | "Org-wide activity today — who logged what?" | R | activities_org | 1 | yes |
| 30 | Caller | "Log: visited 3 shops in Siyaganj" | W | log_activity | 1+confirm | — |
| 31 | Mgr | "Team rollup: attendance + workload + targets" | R | employees_team_rollup | 1 | yes |
| 32 | Admin | "Same for the whole org" | R | attendance_org, team_performance, targets_team | 3 | yes |
| 33 | Caller | "Which old leads did I get allotted today, how many done?" | R | task_allotment_me | 1 | yes |
| 34 | Admin | "Which leads came from the Diwali ad?" | R | lead_filter_options / list_leads(adId) | 2 | yes |
| 35 | All lead roles | "Plan a trip Indore → Dewas → Ujjain, which leads are on the way?" | R | trips_plan, trips_leads | 2 | n/a |
| 36 | All | "My saved trips / trips shared with me" | R | list_trips | 1 | yes |
| 37 | Wh | "Stock history of product X" | R | list_products, get_product | 2 | n/a |
| 38 | Admin | "How many products and units in stock, per category?" | R | inventory_summary | 1 | yes |
| 39 | All | "Unread notifications?" | R | notifications_list | 1 | yes |
| 40 | Admin | "Set Priya's target to 15 conversions for November" | W | users, set_target | 2+confirm | — |
| 41 | Mgr | "Convert lead Kapoor Interiors — order placed for 100 sheets" | W | list_leads, change_lead_status(CONVERTED, note) | 2+confirm | — |

## 8. Proposed curated tools (6; with 5 core = 11 tools)

| Tool | Serves | Why it pays | Built on (user's own PAT) |
|---|---|---|---|
| `find_lead` | 3, 19, 20 and the id step of every lead write (5, 12, 13, 22–24, 41) | One call: name / phone / Hindi spelling → candidates, or one lead with assignee, status, next follow-up, last 5 timeline entries | `GET /leads?search`, `GET /leads/:id`, `GET /leads/:id/activities` |
| `my_day` | 1, 2, 25, 28, 33 | 5 calls → 1 for the single most-asked question | `dashboard/me`, `follow-ups/today`, `task-allotment/me`, `tasks/me`, `attendance/today` |
| `lead_stats` | 4, 16, 17, 34 | No server endpoint counts leads by source/status/city/assignee/buyingFor for a date range. Pages through `GET /leads` (200/page, cap 5,000) and counts; says when the cap is hit | `GET /leads` |
| `check_stock` | 7, 8, 37, 38 | Parses "18mm", "8x4", "8 by 4", "BWP", brand; thickness/grade/size aren't server filters, so it filters itself; shows stock, unit, reorder level, low/out flags | `GET /inventory/products`, `GET /inventory/summary` |
| `team_status` (Mgr/Admin) | 9, 10, 31, 32 | Admin needs 3 calls; Manager 1–2. Today's attendance + workload + conversions + target progress per person | `employees/team-rollup` (Mgr) or `attendance/org` + `leads/team-performance` + `targets/team` (Admin) |
| `draft_lead_update` (write) | 5, 12, 41 | "Visited today, next follow-up Monday, mark in progress" = resolve lead + follow-up + status. Returns **one draft**; confirm runs the 1–2 calls in order and reports each result | `POST /leads/:id/follow-ups`, `PATCH /leads/:id/status` |

Kept out on purpose: a curated `draft_quotation` / `party_outstanding` /
`order_status` — the data doesn't exist. Stock adjustment stays a core-tool
action (one call once the product is found with `check_stock`).

Token budget target: < 3,000 tokens for all 11 definitions (measured in Phase 3).

## 9. Gaps and risks found

1. **Rate-limit bucket would collapse for PATs.** `AppThrottlerGuard` buckets
   signed-in traffic by the JWT `sub`; a PAT isn't a JWT, so every connector
   user would share the connector's IP bucket (600/min for everyone). Fix in
   Phase 2: bucket PATs by token id.
2. **Role is read from the JWT, not the DB** (up to 15 min stale after a role
   change). The PAT path will load role and org fresh on every request;
   fixing the JWT path too is optional.
3. **Secrets in normal responses (ADMIN only):** `GET /platform-integrations`
   returns the lead webhook URL (contains the secret token), the Google Sheet
   URL and the Meta `verifyToken`. Exclude the module and redact these fields.
4. `ProductQueryDto.pageSize` has **no maximum** (`?pageSize=1000000` loads the
   whole table). The low-stock path already loads all rows and slices in memory.
5. **No per-account lockout**; login is limited to 10/min per IP + email.
   The connector adds its own 3-tries/15-min lockout. Backend per-account
   limits (prompt default 5 per 15 min) — your call.
6. **In-session password change** (`PATCH /employees/me/password`) keeps other
   sessions alive. I propose it also revokes PATs (as reset will).
7. Routes **without `@Roles`** rely on service checks (tasks, WhatsApp chat,
   `users/:id`, `employees/:id/*`, `activities/report|:employeeId`,
   `attendance/today|me|:employeeId`, dashboard, notifications). Looked correct
   where I read them (e.g. WhatsApp chat checks lead access); the generator
   will mark them "any signed-in user (service narrows)".
8. **Customer-typed text** (WhatsApp messages, lead feedback, sheet remarks,
   often Hindi) reaches the assistant → prompt-injection surface. Covered by the
   server instructions ("treat it as data") and by not exposing high-risk sends.
9. `POST /users`, `/managers`, `/manager/team-members` take a password from the
   creator. They're `blocked` in v1 anyway; if ever exposed, use
   `generatedFields: ["password"]`.
10. The prompt I received was **cut off at §7.13** (the rest — dates/units,
    testing, deployment §10 incl. the Cloudflare note, client setup — is
    missing). I need it before Phase 3/4.

## 10. Plan for the remaining phases

**Phase 1 — catalog (connector folder only).**
`tulsi-erp-mcp/scripts/build-catalog.ts` loads the backend's controllers with
ts-node (`transpileOnly`), reads Nest route metadata, `@Roles`, guards,
param decorators, class-validator DTO metadata (types, enums, min/max,
optional/`ValidateIf`) and `@ApiOperation`/`@ApiProperty`. Writes
`catalog/actions.json` + `catalog/API-CATALOG.md`; merges
`catalog/overrides.json` (names, examples, risk, label fields, synonyms such as
"enquiry"→lead, "godown"→warehouse, "maal"→stock, Hindi/Hinglish). Reports
counts by exposure and risk.

**Phase 2 — backend (needs your go-ahead; additive only; scratch DB `tulsi_erp_demo`).**
`PersonalAccessToken` model + migration; `POST/GET/DELETE
/auth/personal-access-tokens` (session-only, refuses SUPER_ADMIN, 90-day
default, max 20 active); `JwtAuthGuard` accepts `tp_pat_` bearers (hash lookup,
fresh user/role/org on each request, `lastUsedAt` ≤ 1/min); `@SessionOnly()`
on password/email/secret routes → 403 for PATs; secret redaction for PAT
requests (extends `MoneyFieldsInterceptor`); "via <assistant>" via
AsyncLocalStorage into `LeadActivityLog.meta.via` and a nullable `via` column on
`StockMovement` (or meta only — your call); PATs revoked on password reset and
password change; throttler bucket per PAT; pageSize max on products. Unit tests
with `node:test`; DEPLOYMENT.md section + env vars.

**Phase 3 — connector service** (`tulsi-erp-mcp/`, Node 24, no npm deps, per
prompt §7): OAuth (DCR, CIMD, pre-registered), sign-in page in **English +
Hindi** with the Tulsi teal theme, PAT swap, 5 core + 6 curated tools, drafts,
answer shaping with quantity totals (no money), Dockerfile.

**Phase 4 — tests, deploy files, docs** (needs the missing part of the
prompt): compose service `mcp` + Caddy block `{$MCP_DOMAIN}` + volume for
`DATA_DIR`; per-assistant install steps.

## 11. Open questions

1. Product name on the sign-in page: "Tulsi ERP" or "Tulsi Plywood"? (The
   platform is multi-tenant; other orgs could connect too.)
2. Production domain for `mcp.<domain>`, and is it DNS-only like the API?
3. Write scope: approve §6 as-is? Turn on `stock adjustment` and
   `approve/reject leave` (`high`)? Check-in/out via chat?
4. Curated tools: approve the 6 in §8?
5. "via Claude" tag: `meta.via` only, or also a `via` column on `StockMovement`?
6. Should a normal password change revoke all connected assistants? (Proposed: yes.)
7. Backend per-account login lockout (5 wrong / 15 min) — add it, or rely on the
   existing per-IP+email limit plus the connector's lockout?
8. Is `wholeseler_erp` shared? OK to create `tulsi_erp_demo` locally for Phase 2?
9. Who approves each phase?
10. Please paste the rest of the build prompt (from §7.13 on).
