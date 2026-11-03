# Tulsi ERP MCP connector — test report

Run 2026-11-03T13:33:47.448Z against `http://localhost:3070` (tulsi_erp_demo). Connector 1.0.0.

**181 checks: 174 passed, 0 failed, 7 informational.**

Tool definitions: ≈2300 tokens (ADMIN, catalog mode).

## Reads × roles (every exposed read action)

| Role | OK | Refused by role (as expected) | Tulsi ERP 4xx | Failed |
|---|---:|---:|---:|---:|
| ADMIN | 50 | 5 | 1 | 0 |
| MANAGER | 50 | 6 | 1 | 0 |
| CALLER | 38 | 19 | 1 | 0 |
| WAREHOUSE_STAFF | 23 | 32 | 1 | 0 |
| DELIVERY_PARTNER | 23 | 32 | 1 | 0 |

<details><summary>ADMIN notes (5)</summary>

- get_team_member: skipped (no id fixture)
- get_task: skipped (no id fixture)
- get_trip: skipped (no id fixture)
- trip_leads: skipped (no id fixture)
- whatsapp_templates: Tulsi ERP 400 WhatsApp is not connected for your organization

</details>

<details><summary>MANAGER notes (4)</summary>

- get_task: skipped (no id fixture)
- get_trip: skipped (no id fixture)
- trip_leads: skipped (no id fixture)
- whatsapp_templates: Tulsi ERP 400 WhatsApp is not connected for your organization

</details>

<details><summary>CALLER notes (3)</summary>

- get_trip: skipped (no id fixture)
- trip_leads: skipped (no id fixture)
- whatsapp_templates: Tulsi ERP 400 WhatsApp is not connected for your organization

</details>

<details><summary>WAREHOUSE_STAFF notes (5)</summary>

- lead_whatsapp_messages: skipped (no leadId fixture)
- get_task: skipped (no id fixture)
- get_trip: skipped (no id fixture)
- trip_leads: skipped (no id fixture)
- whatsapp_templates: Tulsi ERP 400 WhatsApp is not connected for your organization

</details>

<details><summary>DELIVERY_PARTNER notes (5)</summary>

- lead_whatsapp_messages: skipped (no leadId fixture)
- get_task: skipped (no id fixture)
- get_trip: skipped (no id fixture)
- trip_leads: skipped (no id fixture)
- whatsapp_templates: Tulsi ERP 400 WhatsApp is not connected for your organization

</details>

## OAuth per client type

| Check | DCR (Claude, client_secret_post) | DCR public + loopback (Claude Code / Gemini CLI) | CIMD (ChatGPT, resource on both legs) | Pre-registered (Gemini Enterprise, add-client.js) |
|---|---|---|---|---|
| unlisted host refused at register | pass | — | — | — |
| #fragment refused | pass | — | — | — |
| registered 201 with secret | pass | — | — | — |
| iss on redirect | pass | pass | pass | pass |
| PKCE failure refused | pass | pass | pass | pass |
| code reuse refused | pass | pass | pass | pass |
| wrong resource refused | pass | pass | pass | pass |
| token issued | pass | pass | pass | pass |
| whoami works | pass | pass | pass | pass |
| credential named after client | info: Claude (session mode; PAT name needs backend Phase 2) | info: Claude Code (session mode; PAT name needs backend Phase 2) | info: ChatGPT (session mode; PAT name needs backend Phase 2) | info: Gemini Enterprise (session mode; PAT name needs backend Phase 2) |
| refresh rotates | pass | pass | pass | pass |
| revoke → 401 | pass | pass | pass | pass |
| wrong client secret → 401 | pass | — | — | — |
| registered 201 without secret | — | pass | — | — |
| loopback port may differ | — | pass | — | — |
| plain http on a real host refused | — | pass | — | — |
| document naming another id refused | — | — | pass | — |
| document with unlisted redirect refused | — | — | pass | — |
| sign-in page names ChatGPT | — | — | pass | — |
| unlisted redirect refused by add-client | — | — | — | pass |
| client created, secret printed once | — | — | — | pass |
| --list shows it without the secret | — | — | — | pass |

## Writes

| Action | Role | Result | Detail |
|---|---|---|---|
| log_follow_up | CALLER | pass | Patel Furniture 108 · +919710855252 — next follow-up stored as 11:00 IST |
| add_lead_note | CALLER | pass | Patel Furniture 108 · +919710855252 |
| update_lead | CALLER | pass | Patel Furniture 108 · +919710855252 |
| change_lead_status | CALLER | pass | रमेश कुमार 36 · +919710285084 |
| create_lead | CALLER | pass |  |
| create_task | CALLER | pass |  — "tomorrow 11 am" stored as 11:00 IST |
| edit_task | CALLER | pass | Call Jain Hardware |
| complete_task | CALLER | pass | Call Jain Hardware |
| log_activity | CALLER | pass |  |
| apply_leave | CALLER | pass |  |
| set_my_email_preference | CALLER | pass |  |
| mark_all_notifications_read | CALLER | pass |  |
| assign_lead | MANAGER | pass | Test Lead MCP · +919876501234 |
| assign_lead_to_team_member | MANAGER | pass |  |
| create_task | MANAGER | pass |  |
| approve_leave | MANAGER | pass | Amit Verma |
| reject_leave | MANAGER | pass | Priya Sharma |
| set_target | ADMIN | pass |  |
| adjust_stock | ADMIN | pass | Century Blockboard 25mm · Century · 25mm — stock 30 → 80 |
| add_product | ADMIN | pass |  |
| edit_product | ADMIN | pass | Test Ply 9mm MR · 9mm · 8x4 ft |
| delete_product | ADMIN | pass | Test Ply 9mm MR · 9mm · 8x4 ft |
| delete_lead | ADMIN | pass | Test Lead MCP · +919876501234 |
| delete_task | CALLER | pass | Call Jain Hardware |
| check_in | DELIVERY_PARTNER | pass |  |
| check_out | WAREHOUSE_STAFF | pass |  |
| send_whatsapp_message | CALLER | info | Tulsi ERP rejected the input. This lead has no WhatsApp conversation to reply to |

## Discovery & protocol

| Check | Result | Detail |
|---|---|---|
| protected resource names /mcp | pass | http://127.0.0.1:10967/mcp |
| protected resource at …/mcp too | pass |  |
| auth server metadata: S256, CIMD, iss | pass |  |
| /.well-known/oauth-authorization-server/mcp answers | pass |  |
| /.well-known/openid-configuration answers | pass |  |
| 401 without token + WWW-Authenticate | pass | Bearer realm="tulsi-erp", resource_metadata="http://127.0.0.1:10967/.well-known/oauth-protected-resource" |
| 401 invalid_token with a bad token | pass |  |
| GET /mcp → 405 Allow: POST | pass |  |
| OPTIONS → 204 with CORS | pass |  |
| /health → app up | pass | {"ok":true,"app":"up","version":"1.0.0","mode":"catalog","actions":95,"catalogGeneratedAt":"2026-11-03T13:30:43.255Z"} |
| home page with CSP | pass |  |
| initialize echoes 2025-06-18 | pass |  |
| initialize has instructions with the STOP rule | pass |  |
| unknown protocol → newest | pass |  |
| ping → {} | pass |  |
| unknown method → -32601 | pass |  |
| parse error → 400 -32700 | pass |  |
| notification → 202 | pass |  |
| batch → 2 answers | pass |  |
| resources/list → empty | pass |  |
| resources/templates/list → empty | pass |  |
| prompts/list → empty | pass |  |
| every tool: title, openWorldHint false, additionalProperties false, safe name | pass |  |
| confirm tool is the only non-read-only one | pass |  |
| no $ref/oneOf/anyOf/patternProperties (Gemini-safe) | pass |  |

## OAuth

| Check | Result | Detail |
|---|---|---|
| DCR (Claude, client_secret_post): unlisted host refused at register | pass |  |
| DCR (Claude, client_secret_post): #fragment refused | pass |  |
| DCR (Claude, client_secret_post): registered 201 with secret | pass |  |
| DCR (Claude, client_secret_post): iss on redirect | pass |  |
| DCR (Claude, client_secret_post): PKCE failure refused | pass |  |
| DCR (Claude, client_secret_post): code reuse refused | pass |  |
| DCR (Claude, client_secret_post): wrong resource refused | pass |  |
| DCR (Claude, client_secret_post): token issued | pass |  |
| DCR (Claude, client_secret_post): whoami works | pass | Claude |
| DCR (Claude, client_secret_post): refresh rotates | pass |  |
| DCR (Claude, client_secret_post): revoke → 401 | pass |  |
| DCR (Claude, client_secret_post): wrong client secret → 401 | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): registered 201 without secret | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): loopback port may differ | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): plain http on a real host refused | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): iss on redirect | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): PKCE failure refused | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): code reuse refused | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): wrong resource refused | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): token issued | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): whoami works | pass | Claude Code |
| DCR public + loopback (Claude Code / Gemini CLI): refresh rotates | pass |  |
| DCR public + loopback (Claude Code / Gemini CLI): revoke → 401 | pass |  |
| CIMD (ChatGPT, resource on both legs): document naming another id refused | pass |  |
| CIMD (ChatGPT, resource on both legs): document with unlisted redirect refused | pass |  |
| CIMD (ChatGPT, resource on both legs): sign-in page names ChatGPT | pass |  |
| CIMD (ChatGPT, resource on both legs): iss on redirect | pass |  |
| CIMD (ChatGPT, resource on both legs): PKCE failure refused | pass |  |
| CIMD (ChatGPT, resource on both legs): code reuse refused | pass |  |
| CIMD (ChatGPT, resource on both legs): wrong resource refused | pass |  |
| CIMD (ChatGPT, resource on both legs): token issued | pass |  |
| CIMD (ChatGPT, resource on both legs): whoami works | pass | ChatGPT |
| CIMD (ChatGPT, resource on both legs): refresh rotates | pass |  |
| CIMD (ChatGPT, resource on both legs): revoke → 401 | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): unlisted redirect refused by add-client | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): client created, secret printed once | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): --list shows it without the secret | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): iss on redirect | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): PKCE failure refused | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): code reuse refused | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): wrong resource refused | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): token issued | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): whoami works | pass | Gemini Enterprise |
| Pre-registered (Gemini Enterprise, add-client.js): refresh rotates | pass |  |
| Pre-registered (Gemini Enterprise, add-client.js): revoke → 401 | pass |  |

## Sign-in page rules

| Check | Result | Detail |
|---|---|---|
| unknown client → HTML error page, no redirect | pass |  |
| unregistered redirect → HTML error page | pass |  |
| no PKCE → redirect invalid_request | pass |  |
| response_type=token → unsupported_response_type | pass |  |
| wrong resource at authorize → invalid_target | pass |  |
| page shows client and redirect host | pass |  |
| Hindi page | pass |  |
| Cancel → access_denied | pass |  |
| client name is HTML-escaped | pass |  |
| super admin refused with the normal message | pass |  |
| inactive user refused | pass |  |
| wrong password: "2 more tries" | pass |  |
| 3rd wrong try → 15-minute pause | pass |  |
| correct password still paused | pass |  |
| expired sign-in request → error page | pass |  |
| forgot password → backend message shown | info | 400: demo mail is off, so Tulsi ERP answers "can't email the reset code" () |

## Curated tools

| Check | Result | Detail |
|---|---|---|
| ADMIN find_lead | pass |  |
| ADMIN my_day | pass |  |
| ADMIN lead_stats | pass |  |
| ADMIN check_stock | pass |  |
| ADMIN team_status | pass |  |
| MANAGER find_lead | pass |  |
| MANAGER my_day | pass |  |
| MANAGER lead_stats | pass |  |
| MANAGER check_stock | pass |  |
| MANAGER team_status | pass |  |
| CALLER find_lead | pass |  |
| CALLER my_day | pass |  |
| CALLER lead_stats | pass |  |
| CALLER check_stock | pass |  |
| WAREHOUSE_STAFF my_day | pass |  |
| WAREHOUSE_STAFF check_stock | pass |  |
| DELIVERY_PARTNER my_day | pass |  |
| DELIVERY_PARTNER check_stock | pass |  |
| check_stock parses "18 mm", "8 by 4", grade, brand | pass | {"thickness":"18","size":["8","4"],"grade":"bwp","words":"century"} |
| check_stock with no query → summary + low stock | pass |  |
| search "ramesh" also finds "रमेश कुमार" | pass | 9 matches |
| search "रमेश" also finds "Ramesh" | pass |  |
| lead_stats counts every lead (admin, all time) | pass | 160/160 |

## Reads × roles

| Check | Result | Detail |
|---|---|---|
| ADMIN: tools/list fits the role | pass | whoami,search_erp_actions,run_erp_read,prepare_erp_change,confirm_erp_change,find_lead,my_day,lead_stats,check_stock,team_status,draft_lead_update |
| MANAGER: tools/list fits the role | pass | whoami,search_erp_actions,run_erp_read,prepare_erp_change,confirm_erp_change,find_lead,my_day,lead_stats,check_stock,team_status,draft_lead_update |
| CALLER: tools/list fits the role | pass | whoami,search_erp_actions,run_erp_read,prepare_erp_change,confirm_erp_change,find_lead,my_day,lead_stats,check_stock,draft_lead_update |
| WAREHOUSE_STAFF: tools/list fits the role | pass | whoami,search_erp_actions,run_erp_read,prepare_erp_change,confirm_erp_change,my_day,check_stock |
| DELIVERY_PARTNER: tools/list fits the role | pass | whoami,search_erp_actions,run_erp_read,prepare_erp_change,confirm_erp_change,my_day,check_stock |

## Core tools

| Check | Result | Detail |
|---|---|---|
| run_erp_read where-filter total = server count | pass | 25 vs 25 |
| list summary counts cover all rows | pass |  |
| product totals by unit | pass | 2,458 sheets · 18 pieces · 0 boxes |
| search understands "enquiry" (synonym for lead) | pass | log_follow_up,get_lead,my_allotted_leads,create_lead,list_leads |

## Prompt injection

| Check | Result | Detail |
|---|---|---|
| lead feedback with "ignore previous instructions…" reaches the assistant as data | info | returned inside the lead record, with the "treat as data" note; needs a real-model run to confirm behaviour |

## Draft safety

| Check | Result | Detail |
|---|---|---|
| prepare returns a draft, saved:false, STOP text | pass |  |
| another user's draft is refused | pass |  |
| saves once; second confirm changes nothing | pass |  |
| expired draft refused | pass |  |
| unknown draft refused | pass |  |
| prepare refuses reads | pass |  |
| bad enum → problems + expected schema | pass |  |
| unknown body field refused | pass |  |
| high-risk action switched off on connector A | pass | delete_task is a high-risk change that is switched off for connected assistants. Do it in the Tulsi ERP app. |
| caller can't use assign_lead (role) | pass | Your role (CALLER) can't use assign_lead; it is for ADMIN, MANAGER. |
| update of a missing/invisible record → no draft | pass |  |

## Writes

| Check | Result | Detail |
|---|---|---|
| log_follow_up | pass | next follow-up stored as 11:00 IST |
| add_lead_note | pass |  |
| update_lead | pass |  |
| update draft shows before → after | pass | {"city":{"from":"Indore","to":"Dewas-950"},"altPhone":{"to":"+919811100000"}} |
| change_lead_status | pass |  |
| LOST draft carries the reallocation warning | pass |  |
| create_lead | pass |  |
| create_task | pass | "tomorrow 11 am" stored as 11:00 IST |
| edit_task | pass |  |
| complete_task | pass |  |
| log_activity | pass |  |
| apply_leave | pass |  |
| set_my_email_preference | pass |  |
| mark_all_notifications_read | pass |  |
| skip_allotted_lead | info | no allotment today for the demo caller (the cron builds batches only when a caller has nothing else due) |
| draft_lead_update → one draft, readable time | pass | {"followUp":{"note":"Visited site, needs 30 sheets","outcome":"VISITED","nextFollowUpAt":"Mon, 9 Nov, 2026, 11:00 am IST"}} |
| draft_lead_update confirm saves | pass |  |
| draft_lead_update with an ambiguous name → candidates, no draft | pass |  |
| draft_lead_update LOST needs a reason | pass |  |
| assign_lead | pass |  |
| assign_lead_to_team_member | pass |  |
| create_task | pass |  |
| approve_leave | pass |  |
| approve_leave draft names the applicant | pass | Amit Verma |
| reject_leave | pass |  |
| set_target | pass |  |
| adjust_stock | pass | stock 30 → 80 |
| add_product | pass |  |
| edit_product | pass |  |
| delete_product | pass |  |
| delete draft carries a warning | pass |  |
| delete_lead | pass |  |
| delete_task | pass |  |
| check_in | pass |  |
| check_out | pass |  |
| save_trip | info | no lead cities on the map: {"cities":[],"notOnMap":[{"id":"2ee01d0d-b839-4484-b2b4-bbfe4cab144b","name":"Dewas-950","geoStatus":"PENDING","leads":{ |
| send_whatsapp_message | info | Tulsi ERP said: 400 This lead has no WhatsApp conversation to reply to |

## Token rules

| Check | Result | Detail |
|---|---|---|
| works before | pass |  |
| deactivated user → "reconnect" answer | pass | 200 {"error":"The Tulsi ERP session has ended (signed out, password changed or account deactivated). Ask the user to reconne |
| then /mcp → 401 (assistant shows Reconnect) | pass |  |
| reactivated user can connect again | pass |  |
| credential mode | pass | session |
| backend has no PAT route yet → session mode | info | the connector keeps an encrypted session (refresh token) per connection; PAT naming, "via <assistant>" and session-only 403 come with backend Phase 2 |
| revoked session → "reconnect" answer | pass | {"error":"The Tulsi ERP session has ended (signed out, password changed or account deactivated). Ask the user to reconne |
| state file holds no plain credentials | pass |  |
| log holds no tokens or passwords | pass |  |
| expired session refreshes once for 3 parallel calls | pass | [null,null,null] |
| still connected afterwards (no reuse-detection logout) | pass |  |

## Secrets

| Check | Result | Detail |
|---|---|---|
| no secret, token or money field in 415 tool answers | pass |  |

## Token budget

| Check | Result | Detail |
|---|---|---|
| tools/list for ADMIN: 11 tools, 9201 chars ≈ 2300 tokens | info | target < 3,000 |
| under 3,000 tokens | pass |  |
