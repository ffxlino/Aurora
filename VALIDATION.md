# Validation — Aurora 0.4.0

34 launcher tests and 4 cloud-server tests passed locally and in Windows/Linux CI. Server tests use native workerd via Miniflare, including the actual Aurora HubClient publishing chunks and pulling updates while retaining local worlds.

The final Windows portable EXE passed six-view interface tests, custom confirmation acceptance/cancellation, settings/backup/decoration/diagnostic controls, Modrinth resource cards, mod toggling and manual environment selection, HTTPS admin connection and close confirmation. No horizontal overflow in tested views.

Linux AppImage and pacman packaging passed in Ubuntu 22.04 CI. The packaged Linux interface passed six-view tests. A real Minecraft 1.20.1 / Fabric 0.16.10 / Java 17 installation generated the official launcher profile and successfully invoked downloaded Linux Java. Windows real installation was previously validated in 0.3; no new Windows licensed game launch is claimed.

Cloud worker dry-run bundle passed. Authentication to the owner's Cloudflare account succeeded; live deployment awaits Workers activation and Free-plan confirmation. R2 and paid resources are absent from the configuration. A 4 GB production upload has not been tested.

Not verified: licensed game start and Microsoft sign-in through the official launcher on this Windows machine (the official launcher is not installed), actual Arch/Wayland desktop, hardware-specific graphics/audio. Direct Microsoft sign-in in Aurora and CurseForge remain disabled pending approval. Aurora opens the prepared profile in the official launcher; the user signs in and presses Play there.

CI: https://github.com/ffxlino/Aurora/actions/runs/38433792642
Release: https://github.com/ffxlino/Aurora/releases/tag/v0.4.0
