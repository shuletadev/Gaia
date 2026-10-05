---
name: windows-tooling-quirks
description: "Gotchas working on Gaia from Claude Code on Windows: line endings, shell escaping, detaching the dev server, testing the UI without touching Azure"
metadata:
  node_type: memory
  type: feedback
  modified: 2026-10-05T12:56:38.978Z
  originSessionId: 8c633da8-44a4-4227-a1dd-10ebf615cc32
---

Hard-won rules for editing and testing this repo on Windows:
- **Edit code with the Edit/Write tools, never through shell escaping.** A Node one-liner with template literals inside bash mangled a function (backslashes lost); a stray `sed` cut a sentence in half. Both had to be repaired. If a scripted edit is unavoidable, write the script to a file first.
- **Line endings are mixed** in the repo: some files are CRLF (for example `web/src/App.tsx`), some LF. Multi-line matches fail on CRLF files; normalise `\r\n` before matching and restore it after. Do not append LF text to a CRLF file.
- PowerShell 5.1 `Get-Content`/`Set-Content` corrupt UTF-8; long non-ASCII heredocs in bash break. Use the Write tool.
- Background processes started from the Bash tool die when the call ends: start the server with PowerShell `Start-Process npm.cmd -ArgumentList start -WindowStyle Hidden` (port 4870), and stop it by the process listening on the port.
- `npm start` runs `vite build` first, so the served UI is current after a restart; server code changes need a restart.
- **Test the UI without touching Azure:** patch `window.fetch` in the browser pane to return fixtures (and to intercept POST and DELETE), then re-mount the screen. The pane blocks the clipboard. Reset the viewport to desktop afterwards.
- Do not name a browser-script variable `status` (a reserved browser global); a test guards the lab pages against it.
- Bash `/tmp` differs between Git Bash and Node/az on Windows; use the session scratchpad for files shared between tools.
- `az deployment sub validate` on these templates only proves the top level: nested resources in a group that does not exist yet are not deeply checked.

**Why:** each of these cost a repair or a wrong result during the build.

**How to apply:** follow them by default; mention to the user only when one changes what was verified.
