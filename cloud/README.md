# Aurora shared pack server

Private HTTPS pack synchronization on Cloudflare Workers Free and SQLite Durable Objects. No R2, D1, KV or paid-plan resources. One hub per deployment; one file per Durable Object. The server is independent of the desktop application.

## Setup

Install development dependencies with `npm ci` in this folder. Authenticate using `npx wrangler login --device --scopes account:read user:read workers_scripts:write --use-keyring`. Verify the account is on Workers Free before deployment. Do not upgrade the plan or add billing details. Deploy with `npm run deploy`, then set a randomly generated master password of at least 16 characters through `npx wrangler secret put MASTER_PASSWORD`; pass it through stdin and keep it out of repository files, command arguments and logs. Never commit `.dev.vars`, `.env`, `.wrangler`, credentials or a plaintext master password.

Set the deployed HTTPS origin as cloudHubUrl in the desktop launcher.config.json. Configure the owner through the launcher's encrypted setup or connect by master password; distribute invitations with reader/editor roles. MICROSOFT_APPROVED is enabled after actual Mojang approval and live Minecraft API verification. Invite names are owner-assigned labels, not verified Microsoft identities. The server does not host Minecraft gameplay or share worlds.

## Limits

4,000,000,000 bytes per pack; 512 MiB per file; 4,500,000,000 bytes including staged uploads. Cloudflare's 5 GB free storage is account-wide; other projects and SQLite overhead also consume it. Updates need room for new changed blobs; the current pack remains published when a reservation is refused. Obsolete published blobs are collected after publishing; orphan staging expires after 24 hours. Daily provider quotas can suspend access until reset. Free-tier behavior: https://developers.cloudflare.com/durable-objects/platform/pricing/ .

## Verification

`npm test` uses the native workerd runtime via Miniflare. It verifies chunk upload, checksum refusal, immutable verified files, invitations and revocation, reader permissions, revision conflicts, storage reservation limits, path restrictions, and publication/pull through the actual Aurora HubClient while preserving local worlds. It does not constitute a full 4 GB production load test.

## GitHub pack releases

GITHUB_REPOSITORY points to ffxlino/Aurora-Packs. Set GITHUB_TOKEN as a Cloudflare Secret using a fine-grained GitHub token scoped only to this repository with Contents: Read and write. Never put the token in launcher configuration, source files or a distributed build. Public GET /packs endpoints allow players to install without a GitHub account. Authorized editors publish through draft releases; a completed release becomes the next catalog revision. Configs are bundled into checked mrpack overrides; known Modrinth files retain their original URLs. Custom assets have a 512 MiB limit, with at most 998 assets plus the mrpack and metadata. Pack size is limited to 4,000,000,000 bytes. This has not been load-tested with a full 4 GB pack.

The desktop checks updates before either launch mode, creates a backup, detects conflicting local changes and verifies downloads before replacing files. History retains author, timestamp, changed paths and old/new file metadata. Worlds stay local. Failed ordinary updates restore the old files; recovery after a power failure may require restoring a backup.
