# Validation — Aurora 0.3.0

26 Node tests pass, including official profile preparation, preserving existing profiles, refusing corrupt JSON, passing workDir without a shell, platform-specific library rules, encrypted account flow, mod/resource installation, checksums, backups and shared-hub access controls.

Real engine checks passed on Windows and Linux (Ubuntu CI): Minecraft 1.20.1, Fabric 0.16.10, Java 17; Java executable invoked successfully; standalone official launcher profile and client JAR generated. The Linux check uses downloaded Linux Java and platform libraries, not Windows binaries.

The final Windows portable EXE passed interface smoke tests: official launch mode enabled, only Modrinth listed, five views without horizontal overflow, installed resource cards, mod toggling and manual side selection, custom confirmation acceptance/cancellation, HTTPS admin connection and close confirmation. Screenshots visually inspected.

Linux AppImage and pacman packaging completed successfully. Packaged Linux interface tests passed under Xvfb in Ubuntu 22.04 CI, including five views, Modrinth-only selection, official mode, custom dialogs and HTTPS hub.

Runtime production dependency audit: zero known vulnerabilities at verification time.

Not verified: actual Microsoft sign-in and licensed game launch through the official launcher (not installed on the current Windows computer), launch on an actual Arch/Wayland desktop, runtime graphics/audio on the user's hardware, always-on external hosting. Aurora hands off a profile; it does not claim the game itself has started or import official launcher tokens. Direct Aurora sign-in and CurseForge access remain disabled pending approval.

CI: https://github.com/ffxlino/Aurora/actions/runs/38411267577
Release: https://github.com/ffxlino/Aurora/releases/tag/v0.3.0
