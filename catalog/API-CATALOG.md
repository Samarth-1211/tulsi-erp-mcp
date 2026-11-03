# Tulsi ERP API catalog

> Generated, don't edit by hand. Run `node scripts/build-catalog.js`; human parts live in `catalog/overrides.json`.

Generated 2026-11-03T13:30:43.255Z from `RCRM_Backend`.

**189 routes**: 95 exposed, 94 excluded.

| Exposed by kind/risk | Count |
|---|---:|
| low | 8 |
| read | 60 |
| high | 14 |
| normal | 13 |

| Excluded because | Count |
|---|---:|
| user management (blocked in v1: creates, changes or removes logins) | 14 |
| super-admin only (super admins never connect) | 10 |
| public route | 8 |
| integration setup (webhook URLs and sheet links are secrets) | 8 |
| integration setup (takes or shows WhatsApp/Meta secrets) | 7 |
| debug route | 7 |
| org settings (admin screens only) | 6 |
| webhook (public, called by Meta / relays) | 5 |
| file upload (chats cannot send files reliably yet) | 4 |
| file download | 4 |
| browser push setup (device only) | 4 |
| org settings (admin map/spelling fixes) | 3 |
| user management (blocked in v1) | 3 |
| app-only screen state (new-lead dot, chat read marks) | 3 |
| bulk operation (blocked) | 3 |
| lead imports (Excel uploads are handled in the app) | 3 |
| session-only: takes the user's password | 2 |

## activities

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `log_activity` | `POST /activities` | create | low | any | Log what you did today (call, WhatsApp, site visit, etc.) — optionally linked to a lead |
| `employee_activity` | `GET /activities/:employeeId` | read |  | any | Activity log for a specific employee (self, their Manager, or Admin) |
| `my_activity` | `GET /activities/me` | read |  | any | Get the caller's own activity log for a single day (defaults to today) |
| `org_activity` | `GET /activities/org` | read |  | ADMIN | Org-wide activity rollup for a single day (Admin/Super Admin only) |
| `activity_report` | `GET /activities/report` | read |  | any | Day-by-day attendance + activity report for one employee over a date range (self, their Manager, or Admin) — the source for the Daily/Weekly/Monthly employee report |
| `team_activity` | `GET /activities/team` | read |  | MANAGER | Manager's rollup of their team's activity for a single day (defaults to today) |

## attendance

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `attendance_list` | `GET /attendance` | read |  | ADMIN, MANAGER | Attendance rows for a date range — Admin: whole org; Manager: own team only. Optional userId filter. |
| `employee_attendance` | `GET /attendance/:employeeId` | read |  | any | Attendance history for a specific employee (self, their Manager, or Admin) |
| `check_in` | `POST /attendance/check-in` | create | high | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | Check in for today (once per org-local day; a second check-in returns 409) |
| `check_out` | `POST /attendance/check-out` | create | high | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | Check out with the required work summary (min length from org settings, else 400); computes workedMinutes |
| `my_attendance` | `GET /attendance/me` | read |  | any | Get the caller's own attendance history for a date range |
| `org_attendance_day` | `GET /attendance/org` | read |  | ADMIN | Org-wide attendance rollup for a single day; no row = ABSENT (Admin only) |
| `team_attendance_day` | `GET /attendance/team` | read |  | MANAGER | Manager's rollup of their team's attendance for a single day (defaults to today) |
| `my_attendance_today` | `GET /attendance/today` | read |  | any | Get the caller's own attendance status for today |

## auth

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~auth_forgot_password~~ — public route | `POST /auth/forgot-password` | create | normal | any | Request a password-reset OTP be emailed to the account |
| ~~auth_login~~ — public route | `POST /auth/login` | create | normal | any | Authenticate with email/password and receive an access + refresh token pair |
| ~~auth_logout~~ — public route | `POST /auth/logout` | create | normal | any | Revoke a refresh token, ending the session |
| ~~auth_refresh~~ — public route | `POST /auth/refresh` | create | normal | any | Rotate a refresh token for a new access + refresh token pair |
| ~~auth_reset_password~~ — public route | `POST /auth/reset-password` | create | normal | any | Reset a password using the OTP emailed via forgot-password |
| ~~auth_super_admin_login~~ — public route | `POST /auth/super-admin/login` | create | normal | any | Super admin portal login — SUPER_ADMIN accounts only, unreachable from the public login form |
| ~~auth_verify_email~~ — public route | `POST /auth/verify-email` | create | normal | any | Consume an emailed verification token to activate an account (and its organization, for org admins) |

## cities

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~cities_list~~ — org settings (admin map/spelling fixes) | `GET /cities` | read |  | ADMIN | Every lead city with its map location, spelling status and lead count (Admin) |
| ~~cities_update~~ — org settings (admin map/spelling fixes) | `PATCH /cities/:id` | update | normal | ADMIN | Rename and/or place a city by hand; renaming onto an existing city merges the two (Admin) |
| ~~cities_retry~~ — org settings (admin map/spelling fixes) | `POST /cities/:id/locate` | create | normal | ADMIN | Look the city up on the map again (Admin) |

## dashboard

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `my_dashboard` | `GET /dashboard/me` | read |  | any | Role-specific stats: Admin — org lead totals + source breakdown; Manager — team leads + team attendance; Caller — my leads, today's follow-ups, my attendance; Delivery/Warehouse — attendance only |

## employees

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~employees_set_employee_code~~ — user management (blocked in v1) | `PATCH /employees/:id/employee-code` | update | normal | MANAGER, ADMIN | Assign a human-readable employee code (Manager for their own reports, Admin for anyone in the org) |
| `employee_overview` | `GET /employees/:id/overview` | read |  | any | Full detail for a single employee (Admin user detail page): profile, lead pipeline and assigned leads, leave history, target, projects, direct reports and tasks |
| `employee_profile` | `GET /employees/:id/profile` | read |  | any | Profile details (contact, joining date, manager, active status) for a single employee |
| `employee_lead_summary` | `GET /employees/:id/summary` | read |  | any | Active workload, conversions, and status breakdown for a single employee |
| ~~employees_change_my_email~~ — session-only: takes the user's password | `PATCH /employees/me/email` | update | normal | any | Change the caller's own login email (requires current password) |
| ~~employees_change_my_password~~ — session-only: takes the user's password | `PATCH /employees/me/password` | update | normal | any | Change the caller's own password (requires current password) |
| `update_my_profile` | `PATCH /employees/me/profile` | update | normal | any | Update the caller's own phone number / profile photo |
| `team_rollup` | `GET /employees/team-rollup` | read |  | MANAGER | Manager's single-view rollup: today's attendance + lead snapshot + target progress per team member |
| `team_workload` | `GET /employees/team-summary` | read |  | MANAGER | Manager's view of their direct team's active lead workload |

## follow-ups

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `followups_due_today` | `GET /follow-ups/today` | read |  | ADMIN, MANAGER, CALLER | Today's pending follow-ups (Caller: own leads; Manager: own + team; Admin: org) |

## health

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~health_check~~ — public route | `GET /health` | read |  | any | Liveness + database check for Docker, Nginx and uptime monitors (no auth) |

## integrations

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~whats_app_integration_disable~~ — integration setup (takes or shows WhatsApp/Meta secrets) | `DELETE /integrations/whatsapp` | delete | high | ADMIN |  |
| ~~whats_app_integration_get~~ — integration setup (takes or shows WhatsApp/Meta secrets) | `GET /integrations/whatsapp` | read |  | ADMIN, MANAGER, CALLER |  |
| ~~whats_app_integration_update~~ — integration setup (takes or shows WhatsApp/Meta secrets) | `PATCH /integrations/whatsapp` | update | normal | ADMIN |  |
| ~~whats_app_integration_connect~~ — integration setup (takes or shows WhatsApp/Meta secrets) | `POST /integrations/whatsapp` | create | normal | ADMIN |  |
| ~~whats_app_integration_enable~~ — integration setup (takes or shows WhatsApp/Meta secrets) | `POST /integrations/whatsapp/enable` | create | normal | ADMIN |  |
| ~~whats_app_integration_remove~~ — integration setup (takes or shows WhatsApp/Meta secrets) | `DELETE /integrations/whatsapp/permanent` | delete | high | ADMIN |  |
| ~~whats_app_integration_reveal_verify_token~~ — integration setup (takes or shows WhatsApp/Meta secrets) | `POST /integrations/whatsapp/reveal-verify-token` | create | normal | ADMIN |  |

## inventory

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~inventory_import~~ — file upload (chats cannot send files reliably yet) | `POST /inventory/import` | create | normal | ADMIN, MANAGER, WAREHOUSE_STAFF | Upload products from .xlsx / .csv — new SKUs are created, existing SKUs updated |
| ~~inventory_template~~ — file download | `GET /inventory/import/template` | read |  | ADMIN, MANAGER, WAREHOUSE_STAFF | Download the Excel template for uploading products |
| `list_products` | `GET /inventory/products` | read |  | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | List products (search, category, lowStock, paging) |
| `add_product` | `POST /inventory/products` | create | high | ADMIN, MANAGER, WAREHOUSE_STAFF | Add a product (optional opening stock) |
| `delete_product` | `DELETE /inventory/products/:id` | delete | high | ADMIN, MANAGER | Soft-delete a product — body { "confirmation": "delete" } |
| `get_product` | `GET /inventory/products/:id` | read |  | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | One product with its last 20 stock movements |
| `edit_product` | `PATCH /inventory/products/:id` | update | high | ADMIN, MANAGER, WAREHOUSE_STAFF | Edit product details (stock changes go through /stock) |
| `adjust_stock` | `PATCH /inventory/products/:id/stock` | update | high | ADMIN, MANAGER, WAREHOUSE_STAFF | Add or remove stock with a reason (recorded as a stock movement) |
| `inventory_summary` | `GET /inventory/summary` | read |  | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | Totals: products, units, stock value, low / out of stock, per category |

## leads

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `list_leads` | `GET /leads` | read |  | ADMIN, MANAGER, CALLER | List leads (Admin: org; Manager: own + team; Caller: own) |
| `create_lead` | `POST /leads` | create | normal | ADMIN, MANAGER, CALLER | Manually create a lead (MANUAL / WALK_IN / REFERRAL / OTHER) |
| `delete_lead` | `DELETE /leads/:id` | delete | high | ADMIN | Soft-delete a lead (Admin only) |
| `get_lead` | `GET /leads/:id` | read |  | ADMIN, MANAGER, CALLER | One lead with assignee, attribution, recent follow-ups and counts |
| `update_lead` | `PATCH /leads/:id` | update | normal | ADMIN, MANAGER, CALLER | Edit a lead's fields (Admin: any; Manager: own + team's; Caller: own) |
| `lead_timeline` | `GET /leads/:id/activities` | read |  | ADMIN, MANAGER, CALLER | The lead's timeline (activity log), newest first |
| `assign_lead` | `PATCH /leads/:id/assign` | update | normal | ADMIN, MANAGER | Manually (re)assign a lead |
| `log_follow_up` | `POST /leads/:id/follow-ups` | create | low | ADMIN, MANAGER, CALLER | Log a follow-up — sets nextFollowUpAt / lastActivityAt and writes a FOLLOW_UP activity |
| `add_lead_note` | `POST /leads/:id/notes` | create | low | ADMIN, MANAGER, CALLER | Add a note to the lead's timeline — from a Manager/Admin it also notifies the assignee |
| `change_lead_status` | `PATCH /leads/:id/status` | update | normal | ADMIN, MANAGER, CALLER | Change a lead's status (Admin: any; Manager: own + team's; Caller: own) |
| ~~whats_app_chat_send_media~~ — file upload (chats cannot send files reliably yet) | `POST /leads/:leadId/whatsapp/media` | create | normal | any |  |
| `lead_whatsapp_messages` | `GET /leads/:leadId/whatsapp/messages` | read |  | any |  |
| `send_whatsapp_message` | `POST /leads/:leadId/whatsapp/messages` | create | high | any |  |
| ~~whats_app_chat_media~~ — file download | `GET /leads/:leadId/whatsapp/messages/:messageId/media` | read |  | any |  |
| ~~whats_app_chat_mark_read~~ — app-only screen state (new-lead dot, chat read marks) | `POST /leads/:leadId/whatsapp/read` | create | normal | any |  |
| `send_whatsapp_template` | `POST /leads/:leadId/whatsapp/template` | create | high | any |  |
| ~~leads_bulk_assign~~ — bulk operation (blocked) | `POST /leads/bulk-assign` | create | normal | ADMIN, MANAGER | Assign several leads to one person at once |
| ~~leads_bulk_delete~~ — bulk operation (blocked) | `POST /leads/bulk-delete` | create | normal | ADMIN | Soft-delete several leads at once (Admin only) |
| `lead_cities` | `GET /leads/cities` | read |  | ADMIN, MANAGER, CALLER | Every city the org’s leads have come from, A–Z (options for the City filter) |
| `lead_filter_options` | `GET /leads/filter-options` | read |  | ADMIN, MANAGER, CALLER | Values in use for the Buying For and Requirement filters with lead counts; ad ids for an Admin |
| ~~leads_import_leads~~ — file upload (chats cannot send files reliably yet) | `POST /leads/import` | create | normal | ADMIN, MANAGER | Upload leads from an Excel (.xlsx) or CSV sheet (Admin or Manager) |
| ~~leads_preview_import~~ — file upload (chats cannot send files reliably yet) | `POST /leads/import/preview` | create | normal | ADMIN, MANAGER | Count the leads in a sheet before uploading it (Admin or Manager) |
| ~~leads_import_template~~ — file download | `GET /leads/import/template` | read |  | ADMIN, MANAGER | Download the Excel template for uploading leads (Admin or Manager) |
| ~~leads_list_imports~~ — lead imports (Excel uploads are handled in the app) | `GET /leads/imports` | read |  | ADMIN | Every uploaded lead sheet, newest first — who uploaded it, when, who it was shared with and its outcome (Admin only) |
| ~~leads_get_import~~ — lead imports (Excel uploads are handled in the app) | `GET /leads/imports/:id` | read |  | ADMIN, MANAGER | Progress and outcome of a lead upload (Admin, or the Manager who uploaded it) |
| ~~leads_download_import_file~~ — file download | `GET /leads/imports/:id/file` | read |  | ADMIN | Download an uploaded lead sheet exactly as it was uploaded (Admin only) |
| ~~leads_remove_import_leads~~ — lead imports (Excel uploads are handled in the app) | `DELETE /leads/imports/:id/leads` | delete | high | ADMIN | Soft-delete every lead that came from one uploaded Excel sheet (Admin only) |
| ~~leads_shuffle_lost_leads~~ — bulk operation (blocked) | `POST /leads/lost/shuffle` | create | normal | ADMIN, MANAGER | Manually shuffle lost leads to different team members (never back to whoever lost them) — omit leadIds to shuffle every lost lead in scope |
| ~~leads_mark_seen~~ — app-only screen state (new-lead dot, chat read marks) | `PATCH /leads/seen` | update | normal | ADMIN, MANAGER, CALLER | Mark the Leads list as seen by the caller (clears the "new leads" nav dot) |
| `team_performance` | `GET /leads/team-performance` | read |  | ADMIN, MANAGER | Per-caller leads, open, converted, lost, conversion % and overdue follow-ups (Manager: own team) |
| ~~leads_count_unseen~~ — app-only screen state (new-lead dot, chat read marks) | `GET /leads/unseen-count` | read |  | ADMIN, MANAGER, CALLER | Count leads that arrived since the caller last opened the Leads list (the "new leads" nav dot) |

## leave

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `approve_leave` | `PATCH /leave/:id/approve` | update | high | MANAGER, ADMIN | Approve a leave request (leave days block check-in; reports show them as leave, not absence) |
| `reject_leave` | `PATCH /leave/:id/reject` | update | high | MANAGER, ADMIN | Reject a leave request |
| `apply_leave` | `POST /leave/apply` | create | normal | any | Apply for leave for a date range, pending Manager approval |
| `my_leave` | `GET /leave/me` | read |  | any | Caller's own leave request history |
| `org_leave` | `GET /leave/org` | read |  | ADMIN | All leave requests org-wide, optionally filtered by status (Admin/Super Admin only) |
| `team_pending_leave` | `GET /leave/team/pending` | read |  | MANAGER | Pending leave requests from the Manager's direct team |

## manager

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `assign_lead_to_team_member` | `PATCH /manager/leads/:leadId/assign` | update | normal | MANAGER, ADMIN | Assign a lead to one of the manager's own team members |
| `manager_peers` | `GET /manager/peers` | read |  | MANAGER, ADMIN | The other active Managers in the org — who a manager can hand one of their leads over to |
| `list_team_members` | `GET /manager/team-members` | read |  | MANAGER, ADMIN | List the manager's team, filterable by role/status |
| ~~manager_create~~ — user management (blocked in v1: creates, changes or removes logins) | `POST /manager/team-members` | create | normal | MANAGER, ADMIN | Create a CALLER, DELIVERY_PARTNER or WAREHOUSE_STAFF under the acting manager (managerId = self) |
| ~~manager_remove~~ — user management (blocked in v1: creates, changes or removes logins) | `DELETE /manager/team-members/:id` | delete | high | MANAGER, ADMIN | Delete a team member — their open leads and tasks go to the chosen teammate |
| `get_team_member` | `GET /manager/team-members/:id` | read |  | MANAGER, ADMIN | Fetch a single team member |
| ~~manager_update~~ — user management (blocked in v1: creates, changes or removes logins) | `PATCH /manager/team-members/:id` | update | normal | MANAGER, ADMIN | Update a team member (name / active status) |
| ~~manager_deletion_impact~~ — user management (blocked in v1) | `GET /manager/team-members/:id/deletion-impact` | read |  | MANAGER, ADMIN | What deleting a team member would hand over (open leads, tasks) and who can take it |
| ~~manager_resend_verification~~ — user management (blocked in v1: creates, changes or removes logins) | `POST /manager/team-members/:id/resend-verification` | create | normal | MANAGER, ADMIN | Resend a team member's verification email with a fresh 24-hour link |

## managers

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `list_managers` | `GET /managers` | read |  | ADMIN | List all Managers in the Admin's organization |
| ~~managers_create~~ — user management (blocked in v1: creates, changes or removes logins) | `POST /managers` | create | normal | ADMIN | Create a Manager within the Admin's organization |
| ~~managers_remove~~ — user management (blocked in v1: creates, changes or removes logins) | `DELETE /managers/:id` | delete | high | ADMIN | Delete a Manager — their team and open work must be handed over (see GET /users/:id/deletion-impact) |
| `get_manager` | `GET /managers/:id` | read |  | ADMIN | Fetch a single Manager, enforcing organization scoping |
| ~~managers_update~~ — user management (blocked in v1: creates, changes or removes logins) | `PATCH /managers/:id` | update | normal | ADMIN | Update a Manager's details |
| ~~managers_deactivate~~ — user management (blocked in v1: creates, changes or removes logins) | `PATCH /managers/:id/deactivate` | update | normal | ADMIN | Deactivate a Manager account |
| ~~managers_reactivate~~ — user management (blocked in v1: creates, changes or removes logins) | `PATCH /managers/:id/reactivate` | update | normal | ADMIN | Reactivate a deactivated Manager account |
| ~~managers_resend_verification~~ — user management (blocked in v1: creates, changes or removes logins) | `POST /managers/:id/resend-verification` | create | normal | ADMIN | Resend a Manager's verification email with a fresh 24-hour link |

## notifications

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `list_notifications` | `GET /notifications` | read |  | any | List the caller's notifications (newest first, max 50) |
| `mark_notification_read` | `PATCH /notifications/:id/read` | update | low | any | Mark a single notification as read |
| `my_email_preference` | `GET /notifications/email-preference` | read |  | any | Whether CRM updates are emailed to the caller, and which kinds the org emails |
| `set_my_email_preference` | `PATCH /notifications/email-preference` | update | low | any | Turn CRM update emails on or off for the caller |
| ~~notifications_push_public_key~~ — browser push setup (device only) | `GET /notifications/push/public-key` | read |  | any | VAPID public key for subscribing this browser to push notifications (null when push is off) |
| ~~notifications_push_subscribe~~ — browser push setup (device only) | `POST /notifications/push/subscribe` | create | normal | any | Turn on device (phone/desktop) notifications for this browser — send its PushSubscription |
| ~~notifications_push_test~~ — browser push setup (device only) | `POST /notifications/push/test` | create | normal | any | Send a test notification to every device the caller turned push on for |
| ~~notifications_push_unsubscribe~~ — browser push setup (device only) | `POST /notifications/push/unsubscribe` | create | normal | any | Turn off device notifications for this browser (e.g. on logout) |
| `mark_all_notifications_read` | `PATCH /notifications/read-all` | update | low | any | Mark all of the caller's notifications as read |
| `unread_notification_count` | `GET /notifications/unread-count` | read |  | any | Get the caller's unread notification count (for the bell badge) |

## organizations

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~organizations_find_all~~ — super-admin only (super admins never connect) | `GET /organizations` | read |  |  | List all Organizations, optionally filtered by status/plan/search |
| ~~organizations_create~~ — super-admin only (super admins never connect) | `POST /organizations` | create | normal |  | Create a new Organization and its first Admin user |
| ~~organizations_archive~~ — super-admin only (super admins never connect) | `DELETE /organizations/:id` | delete | high |  | Archive (soft-delete) an Organization |
| ~~organizations_find_one~~ — super-admin only (super admins never connect) | `GET /organizations/:id` | read |  |  | Fetch a single Organization by id |
| ~~organizations_update~~ — super-admin only (super admins never connect) | `PATCH /organizations/:id` | update | normal |  | Partially update an Organization's editable details |
| ~~organizations_replace~~ — super-admin only (super admins never connect) | `PUT /organizations/:id` | update | normal |  | Replace an Organization's editable details (full update) |
| ~~organizations_add_admin~~ — super-admin only (super admins never connect) | `POST /organizations/:id/admin` | create | normal |  | Add an Admin user to an Organization — any number of Admins allowed, any time |
| ~~organizations_reactivate~~ — super-admin only (super admins never connect) | `PATCH /organizations/:id/reactivate` | update | normal |  | Reactivate a suspended Organization |
| ~~organizations_resend_admin_verification~~ — super-admin only (super admins never connect) | `POST /organizations/:id/resend-verification` | create | normal |  | Resend the verification email to every not-yet-verified admin in this organization |
| ~~organizations_suspend~~ — super-admin only (super admins never connect) | `PATCH /organizations/:id/suspend` | update | normal |  | Suspend an Organization, disabling all of its users |

## platform-integrations

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~platform_integration_find_all~~ — integration setup (webhook URLs and sheet links are secrets) | `GET /platform-integrations` | read |  | ADMIN, MANAGER |  |
| ~~platform_integration_create~~ — integration setup (webhook URLs and sheet links are secrets) | `POST /platform-integrations` | create | normal | ADMIN |  |
| ~~platform_integration_deactivate~~ — integration setup (webhook URLs and sheet links are secrets) | `DELETE /platform-integrations/:id` | delete | high | ADMIN |  |
| ~~platform_integration_find_one~~ — integration setup (webhook URLs and sheet links are secrets) | `GET /platform-integrations/:id` | read |  | ADMIN, MANAGER |  |
| ~~platform_integration_update~~ — integration setup (webhook URLs and sheet links are secrets) | `PATCH /platform-integrations/:id` | update | normal | ADMIN |  |
| ~~platform_integration_reveal_secret~~ — integration setup (webhook URLs and sheet links are secrets) | `POST /platform-integrations/:id/reveal-secret` | create | normal | ADMIN |  |
| ~~platform_integration_sync~~ — integration setup (webhook URLs and sheet links are secrets) | `POST /platform-integrations/:id/sync` | create | normal | ADMIN |  |
| ~~platform_integration_google_sheet_setup~~ — integration setup (webhook URLs and sheet links are secrets) | `GET /platform-integrations/google-sheet-setup` | read |  | ADMIN |  |

## settings

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~lead_allocation_settings_get~~ — org settings (admin screens only) | `GET /settings/allocation` | read |  | ADMIN | Allocation mode, round-robin target role and allocateOnlyCheckedIn (Admin) |
| ~~lead_allocation_settings_update~~ — org settings (admin screens only) | `PATCH /settings/allocation` | update | normal | ADMIN | Set allocation mode (ROUND_ROBIN / MANUAL), target role and allocateOnlyCheckedIn (Admin) |
| ~~notification_settings_get~~ — org settings (admin screens only) | `GET /settings/notifications` | read |  | ADMIN | Which notification types are emailed to users (Admin) |
| ~~notification_settings_update~~ — org settings (admin screens only) | `PATCH /settings/notifications` | update | normal | ADMIN | Choose which notification types are emailed to users (Admin) |
| ~~task_allotment_settings_get~~ — org settings (admin screens only) | `GET /settings/task-allotment` | read |  | ADMIN | Automated Task Allotment settings (Admin) |
| ~~task_allotment_settings_update~~ — org settings (admin screens only) | `PATCH /settings/task-allotment` | update | normal | ADMIN | Set batch size, look-back window, eligibility, priority and filters (Admin) |

## targets

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `set_target` | `PUT /targets` | update | high | MANAGER, ADMIN | Set (or update) an employee's monthly target — a Manager for their direct reports, an Admin for any Manager or executive |
| `my_target` | `GET /targets/me` | read |  | any | Caller's own target vs actual for a given month (defaults to current month) |
| `team_targets` | `GET /targets/team` | read |  | MANAGER, ADMIN | Target vs actual for a month — a Manager's direct reports, or every Manager and executive for an Admin |

## task-allotment

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `skip_allotted_lead` | `PATCH /task-allotment/:id/skip` | update | low | ADMIN, MANAGER, CALLER | Skip one of today's allotted leads |
| `my_allotted_leads` | `GET /task-allotment/me` | read |  | ADMIN, MANAGER, CALLER | Today's automatically allotted old leads |
| `allotment_overview` | `GET /task-allotment/overview` | read |  | ADMIN, MANAGER | Per person: today's batch progress and allotted leads converted over the look-back window (Manager: self + team) |

## tasks

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `create_task` | `POST /tasks` | create | normal | any | Create a personal to-do task, optionally linked to a lead with reminder offsets |
| `delete_task` | `DELETE /tasks/:id` | delete | high | any | Delete a task (owner only) |
| `get_task` | `GET /tasks/:id` | read |  | any | Fetch a single task (owner only) |
| `edit_task` | `PATCH /tasks/:id` | update | normal | any | Edit a task (owner only) — recomputes reminders if dueAt or offsets change |
| `complete_task` | `PATCH /tasks/:id/complete` | update | low | any | Mark a task complete and cancel its pending reminders |
| `tasks_assigned_by_me` | `GET /tasks/assigned-by-me` | read |  | any | List tasks the caller has assigned to other users (Manager/Admin delegation view) |
| `my_tasks` | `GET /tasks/me` | read |  | any | List the caller's own tasks (personal + assigned to them), optionally filtered by source |

## trips

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `list_trips` | `GET /trips` | read |  | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | Trips you planned or that were shared with you (Admin: all in the org) |
| `save_trip` | `POST /trips` | create | normal | ADMIN, MANAGER, CALLER | Save a planned trip |
| `delete_trip` | `DELETE /trips/:id` | delete | high | ADMIN, MANAGER, CALLER | Delete a trip (planner or Admin); its visit tasks stay |
| `get_trip` | `GET /trips/:id` | read |  | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | One saved trip (planner, Admin, or someone it is shared with) |
| `edit_trip` | `PATCH /trips/:id` | update | normal | ADMIN, MANAGER, CALLER | Change a trip (planner or Admin) |
| `trip_leads` | `GET /trips/:id/leads` | read |  | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | The trip's leads by city, as its planner sees them |
| `share_trip` | `POST /trips/:id/share` | create | normal | ADMIN, MANAGER, CALLER | Set who the trip is shared with (planner or Admin); newly added people are notified |
| `trip_to_visit_tasks` | `POST /trips/:id/tasks` | create | normal | ADMIN, MANAGER, CALLER, DELIVERY_PARTNER, WAREHOUSE_STAFF | Save the trip as site-visit tasks (one per lead) for the planner or someone it is shared with |
| `lead_cities_on_map` | `GET /trips/cities` | read |  | ADMIN, MANAGER, CALLER | Every lead city on the map with its lead counts (your scope) |
| `leads_in_cities` | `POST /trips/leads` | read |  | ADMIN, MANAGER, CALLER | Your leads in the picked cities, grouped by city in the given order |
| `optimise_trip_order` | `POST /trips/optimise` | read |  | ADMIN, MANAGER, CALLER | Put the stops in the shortest driving order (first and last stay put); returns km/time before and after |
| `search_places` | `GET /trips/places` | read |  | ADMIN, MANAGER, CALLER | Search a From / To / stop: the org’s lead cities first, then towns from OpenStreetMap |
| `plan_trip_route` | `POST /trips/plan` | read |  | ADMIN, MANAGER, CALLER | Road route through the stops and the lead cities within corridorKm of it, in travel order |
| `trip_share_candidates` | `GET /trips/share-candidates` | read |  | ADMIN, MANAGER, CALLER | People in the org a trip can be shared with |

## users

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `list_users` | `GET /users` | read |  | ADMIN, MANAGER | List users scoped to the caller organization (and team, for Managers) |
| ~~users_create~~ — user management (blocked in v1: creates, changes or removes logins) | `POST /users` | create | normal | ADMIN, MANAGER | Create a subordinate user account according to the role hierarchy |
| ~~users_remove~~ — user management (blocked in v1: creates, changes or removes logins) | `DELETE /users/:id` | delete | high | ADMIN | Delete a user — hands over their open work, archives the account and frees the email for re-use |
| `get_user` | `GET /users/:id` | read |  | any | Fetch a single user, enforcing organization/team scoping |
| ~~users_deactivate~~ — user management (blocked in v1: creates, changes or removes logins) | `PATCH /users/:id/deactivate` | update | normal | ADMIN | Deactivate a user account |
| ~~users_deletion_impact~~ — user management (blocked in v1) | `GET /users/:id/deletion-impact` | read |  | ADMIN | What deleting this user would hand over (open leads, tasks, team) and who can take it |
| ~~users_reactivate~~ — user management (blocked in v1: creates, changes or removes logins) | `PATCH /users/:id/reactivate` | update | normal | ADMIN | Reactivate a deactivated user account |

## webhooks

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| ~~leads_webhook_receive_relay~~ — webhook (public, called by Meta / relays) | `POST /webhooks/leads/:webhookToken` | create | normal | any | Common lead URL for n8n / Pabbly / Zapier / Make relays and website forms |
| ~~leads_webhook_verify_meta~~ — webhook (public, called by Meta / relays) | `GET /webhooks/meta/leadgen` | read |  | any | Meta Lead Ads webhook verification (hub.challenge) |
| ~~leads_webhook_receive_meta~~ — webhook (public, called by Meta / relays) | `POST /webhooks/meta/leadgen` | create | normal | any | Meta Lead Ads webhook — signed with META_APP_SECRET, routed by page_id |
| ~~whats_app_webhook_verify~~ — webhook (public, called by Meta / relays) | `GET /webhooks/whatsapp/:slug` | read |  | any |  |
| ~~whats_app_webhook_receive~~ — webhook (public, called by Meta / relays) | `POST /webhooks/whatsapp/:slug` | create | normal | any |  |

## whatsapp

| Action | Route | Kind | Risk | Roles | Summary |
|---|---|---|---|---|---|
| `whatsapp_ad_sources` | `GET /whatsapp/ad-sources` | read |  | ADMIN |  |
| ~~whats_app_debug_list_events~~ — debug route | `GET /whatsapp/debug/events` | read |  | ADMIN |  |
| ~~whats_app_debug_get_event~~ — debug route | `GET /whatsapp/debug/events/:id` | read |  | ADMIN |  |
| ~~whats_app_debug_health~~ — debug route | `GET /whatsapp/debug/health` | read |  | ADMIN |  |
| ~~whats_app_debug_send_test~~ — debug route | `POST /whatsapp/debug/send-test` | create | normal | ADMIN |  |
| ~~whats_app_debug_simulate_inbound~~ — debug route | `POST /whatsapp/debug/simulate-inbound` | create | normal | ADMIN |  |
| ~~whats_app_debug_subscribe_app~~ — debug route | `POST /whatsapp/debug/subscribe-app` | create | normal | ADMIN |  |
| ~~whats_app_debug_trace~~ — debug route | `GET /whatsapp/debug/trace` | read |  | ADMIN |  |
| `whatsapp_inbox` | `GET /whatsapp/inbox` | read |  | any |  |
| `whatsapp_templates` | `GET /whatsapp/templates` | read |  | any |  |
