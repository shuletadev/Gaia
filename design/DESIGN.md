# Gaia design notes

What the interface looks like today, read from the code on 2026-10-03. Nothing here is a new decision: it records
what exists so UI work starts from it. Update this file when a design decision changes.

## What Gaia is, for the design

A control room one person runs on their own machine to see and tidy an Azure sandbox. The reader is technical, looks
at tables of resources and costs, and takes actions that can delete things. Clarity and trust come before decoration.

## Tokens (source: `web/src/styles.css`)

| Role | Value | Notes |
|---|---|---|
| Signal | `#ff6a3d` | The one accent: primary actions and things that need attention |
| Calm | `#3dd6b0` | Healthy / safe / done |
| Dark ground | `#0c0d10` | Default theme |
| Light ground | Tailwind `stone-100` | Toggle; text `stone-900` |
| Neutrals | Tailwind `stone` scale | Text, borders and surfaces in both themes |
| Sans | Segoe UI Variable Display, Segoe UI, system-ui | Everything |
| Mono | Cascadia Code, Cascadia Mono, Consolas | Resource names, IDs, amounts |

The page background can carry `.grain`: two soft radial glows, signal top-left and calm right. It is the only
gradient in the app.

Theme is chosen by the app, not the OS: `html.dark` (see `web/src/theme.ts`), dark unless the user switched.

## Where things live

- Screens: `web/src/screens/` (Overview, Inventory, Hunt, Labs, Catalog, Log, Settings, Setup).
- Shared pieces: `web/src/components/ui.tsx`, `Modal.tsx`, `charts.tsx`, `Icons.tsx`, `ResourceIcon.tsx`.

## Not decided yet (fill in during the first UI pass)

- A type scale and spacing scale (sizes are set per component today).
- Rules for tables: density, numeric alignment, row actions.
- How destructive actions look and confirm, across every screen.
- What we do not want the app to look like.

## References

Put screenshots of interfaces you like in `design/references/` and add one line here saying what to take from each.
