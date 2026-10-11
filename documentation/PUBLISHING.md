# Project publication

Repository: https://github.com/ffxlino/Aurora
Project website: https://ffxlino.github.io/Aurora/

The former CraftSync repository is public and renamed Aurora. Its previous implementation remains in Git history. The site is deployed from `docs/` through the **Project website** GitHub Actions workflow.

To update the site, push changes under `docs/` to `main`. Settings → Pages uses **GitHub Actions**. Check the workflow's reported deployment URL after publication.

The **Windows build** workflow produces an EXE artifact. It does not publish a release or embed private API credentials. Aurora's public Microsoft application ID is in launcher.config.json; public client flows must be enabled in Entra, and live login and game launch still need validation.

For the CurseForge application, use the public repository and website addresses above. Project API access has not yet been approved; do not represent it as operational in the application form.
