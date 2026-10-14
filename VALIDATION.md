# Validation — Aurora 0.10.0

86 launcher tests and 8 cloud tests passed locally on Windows; one Linux-only AppImage test was skipped. The portable Windows EXE passed the isolated fresh-profile interface checks. All 55 packaged source files matched the tested sources. No real Minecraft game launch is claimed for this release.

SFTP was checked against a local server with reordered read responses and through a short read-only request to the user's real Bisect server. Full large-pack comparison, the newly created Bisect API key, and actual CPU/RAM/TPS remain user verification tasks. The key is not present in the source or release binary.

The friends Worker API passed tests for reciprocal requests, privacy, and immediate hiding of presence and was deployed compatibly. No requests were sent to actual users. Friend identity belongs to a personal community invitation; this is not a universal verified Microsoft social identity.

Discord IPC was tested with a local mock. A real Aurora Discord Application ID and actual Discord client verification remain pending. Russian/English cover the primary UI; some diagnostics and console messages remain Russian.

Linux packaging and interface checks run in GitHub Actions. Actual Arch/Wayland verification on the user's computer remains pending. The previously tested Microsoft login and game installation paths are retained; CurseForge stays disabled pending approved application access.

Windows SHA256: 5291bbcb0089ac4f422f8630ead0d2a79e705142e93cda1e64a696fde124d0f7

GitHub Actions (run 38629838403): Linux packaging (AppImage/pacman), the packaged graphical interface and real Minecraft/Fabric installation verification passed on Ubuntu 22.04. This verifies Linux packaging, not the user's actual Arch/Wayland hardware. Windows tests and packaging also run in this workflow; the release EXE is the previously tested local portable build.
