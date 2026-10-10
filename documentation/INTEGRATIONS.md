# API integration overview

Aurora is a Windows desktop launcher for Minecraft Java Edition, maintained by GitHub user ffxlino. Its source is in the CraftSync repository, which is being repurposed from an older project. The current application is an Electron desktop app; the website is a static project introduction.

## Intended CurseForge usage

- Search Minecraft modpacks, mods, resource packs and shaders.
- Query project information, compatible files and required dependencies.
- Download files allowed for third-party distribution, check their hashes and install them into the selected local instance.
- Display project title, description, author, provider badge and a link to the original project page.
- Match locally installed files through the fingerprint API and SHA-1 verification.
- Import CurseForge modpack manifests using official file metadata.

Aurora does not currently have a project-issued CurseForge API key. Live CurseForge access has not been validated; tests use controlled API fixtures. API access approval is being sought, not claimed. The production credential provisioning and distribution model will be finalized with the service's approval requirements before a general release. No third-party application's key is bundled.

Downloads with no available URL are rejected with an explanatory error. The application does not scrape alternative mirrors to bypass author restrictions. Private sharing is intended for small groups and requires users to respect each resource's redistribution permission; the launcher does not automatically grant that permission.

## Other integrations

Modrinth: public project search, versions, required dependencies, file hash recognition and mrpack import. Real resource downloads have been verified.

Microsoft: device-code sign-in followed by Xbox Live and Minecraft Services. An approved application registration and a licensed account are required. Live authorization remains unverified pending an appropriate Client ID.

## Data and hosting

Settings and instances are local. Sensitive stored credentials use Electron safeStorage on Windows. The optional shared modpack hub is hosted by a user, with HTTPS certificate pinning, password hashing, editor permissions and revision conflict checks. Aurora does not operate a public mod mirror or central account service.

The static website has no login, advertising, analytics, payment system or API key input. Screenshots use a test instance and are illustrative of the actual application UI.

Contact: https://github.com/ffxlino/CraftSync/issues
