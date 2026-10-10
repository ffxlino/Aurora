# Publishing the Aurora project website

The complete static website is in `docs/`. It does not require npm, a database or a separate server.

Expected URL after a successful GitHub Pages deployment:
https://ffxlino.github.io/CraftSync/

This URL must not be represented as live until deployment succeeds.

1. Review the Aurora changes and merge the `aurora-project` branch into `main`.
2. Resolve repository visibility with the owner. This repository was private when this update was prepared. Making it public exposes **all existing Git history**, not just Aurora's latest files. GitHub Free supports Pages for public repositories; private-repository Pages requires an eligible plan.
3. In repository Settings → Pages, choose **GitHub Actions** as the source.
4. Run the **Project website** workflow on `main`, or push a website change after enabling Pages.
5. Wait for the workflow deployment to succeed and open its reported URL.

The CurseForge form's Git URL should be an accessible repository URL. If the repository stays private, arrange reviewer access; a private URL alone does not provide the source to reviewers.

The Windows build workflow creates a downloadable Actions artifact. It does not publish a release or embed API credentials. The owner should finish Microsoft and CurseForge application setup and end-to-end validation before presenting the launcher as fully configured for end users.
