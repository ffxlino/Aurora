# Validation — Aurora 0.4.1

34 launcher tests and 4 cloud-server tests passed locally and in Windows/Linux CI. Server tests use native workerd via Miniflare, including the actual Aurora HubClient moving an existing pack from a previous hub to a fresh cloud hub, publishing chunks and pulling updates while retaining local worlds.

The final Windows portable EXE passed six-view interface tests, custom confirmation acceptance/cancellation, settings/backup/decoration/diagnostic controls, Modrinth resource cards, mod toggling and manual environment selection, HTTPS admin connection and close confirmation. No horizontal overflow in tested views.

Linux AppImage and pacman packaging passed in Ubuntu 22.04 CI. The packaged Linux interface passed six-view tests. A real Minecraft 1.20.1 / Fabric 0.16.10 / Java 17 installation generated the official launcher profile and successfully invoked downloaded Linux Java. Windows real installation was previously validated in 0.3; no new Windows licensed game launch is claimed.

Cloud worker dry-run bundle passed. The owner confirmed Workers Free without a payment card. Live deployment succeeded: owner authentication, reader invitation and immediate session revocation passed; chunk upload, immutable checked blobs and refusal of false checksums passed on the remote server. Owner credentials are encrypted in the local Aurora profile and a fresh process decrypted them and obtained administrator access. The server remains without a published user pack; temporary test staging expires automatically after 24 hours. R2 and paid resources are absent from the configuration. A 4 GB production upload has not been tested.

Not verified: licensed game start and Microsoft sign-in through the official launcher on this Windows machine (the official launcher is not installed), actual Arch/Wayland desktop, hardware-specific graphics/audio. Direct Microsoft sign-in in Aurora and CurseForge remain disabled pending approval. Aurora opens the prepared profile in the official launcher; the user signs in and presses Play there.

CI: https://github.com/ffxlino/Aurora/actions/runs/38437018091
Release: https://github.com/ffxlino/Aurora/releases/tag/v0.4.1
