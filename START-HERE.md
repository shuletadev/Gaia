# Project Gaia — start here

Version 0.1.0 · build 33e065b · packaged 2026-10-03

Gaia is a local control room for your own Azure sandbox: cost and orphan audits, park/resume,
dependency-aware delete and preconfigured labs.

## Is it safe to run?

- It runs only on your machine and listens on 127.0.0.1 (not reachable from the network).
- It acts as **you**, through your own Azure CLI sign-in, and only on the subscriptions you pick at setup.
- Your settings and history stay in this folder (`labctl.config.json`, `data/`). Nothing is sent anywhere else:
  it talks only to Azure Resource Manager, the public Azure Retail Prices API and — only if you choose to —
  the official Azure icons download.
- This package contains source code only: no one else's settings, data or credentials.
- Deletes outside expired Gaia labs always need your typed confirmation.

## You need

- Node.js 22.13 or later (24 recommended) — https://nodejs.org
- Azure CLI — https://aka.ms/installazurecli
- Bicep CLI — run `az bicep install`
- A sandbox subscription you own, with Contributor (Owner if you want Gaia to register resource providers)

## Run it

```powershell
cd Gaia
npm install
npm start
```

Open http://127.0.0.1:4870 — a short setup wizard connects Gaia to your tenant and subscription.
Everything can be changed later under **Settings**.

## Updating to a newer package

Unzip the new version into a new folder, copy `labctl.config.json` and the `data` folder across from the old
one, then `npm install` and `npm start` there.

## Removing it

Destroy any running labs first (Labs screen), then delete the folder.

See README.md for the full guide.
