VOXA PRO UPDATE

Files:
- index.html: existing Voxa client UI plus maintenance screen and admin controls
- worker.js: existing Voxa Durable Object backend plus server-side maintenance enforcement

Added/updated:
- Site modes: active, read-only (blocks message sending), maintenance, closed until an administrator reopens
- Maintenance message and optional ETA, persisted in Durable Object storage
- Non-admin connections are rejected in maintenance/closed mode; connected non-admin users are disconnected when enabled
- Message send is enforced server-side in read-only mode
- Admin dashboard controls for these modes
- Admin message count uses persisted message totals and empty message channels are removed/hidden from picker

IMPORTANT:
This update uses the uploaded source snapshots as its base. Keep your existing Cloudflare bindings and environment secrets (especially HUB and DISCORD_SECRET) unchanged. Upload/replace the files in the same locations used by your current project; deployment behavior depends on your existing Cloudflare configuration. After uploading, test with a non-admin account before enabling maintenance/closed mode.
