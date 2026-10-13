# Aurora — Minecraft launcher

Aurora 0.3.0 manages Minecraft Java modpacks and resources on Windows and Linux x64.

While Mojang and CurseForge application approvals are pending, this release uses **Modrinth only** and hands prepared game installations to the **official Minecraft Launcher**. Players authenticate in that launcher; Aurora does not import its credentials. Select the generated "Aurora · pack name" profile and press Play there. Direct account login in Aurora and CurseForge downloads/imports are temporarily disabled. Existing pack files remain usable.

Windows portable EXE, Linux AppImage and Arch pacman packages are built in GitHub Actions. The official Minecraft Launcher is a separate prerequisite. Java is provisioned automatically for each platform. The Linux build and interface are tested on Ubuntu CI; specific Arch/Wayland environments still need testing on real devices.

Features include isolated instances, Modrinth catalogs with dependency resolution, installed resource cards, client/server categorization, local file import, .mrpack import/export, archive preservation, backups and change history, launcher path selection, alphabetical/newest sorting and access to the actual game log.

The built-in shared-pack HTTPS server runs only while Aurora is open. In the temporary mode, administrator access uses the master password; Minecraft-based participant authorization awaits direct API access. This is a pack file server, not a hosted service or Minecraft game server.

See [Russian user guide](documentation/USER_GUIDE_RU.md). Build with `npm ci`, `npm test`, `npm run dist` on Windows or `npm run dist:linux` on Linux. `npm run verify:engine` downloads and verifies a real Java/Fabric installation and generates an official launcher profile.

Website: https://ffxlino.github.io/Aurora/
