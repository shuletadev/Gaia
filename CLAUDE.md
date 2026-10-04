# Gaia

Local control room for an Azure sandbox (cost and orphan audits, park/resume, dependency-aware delete, labs).
`START-HERE.md` explains how it runs; `docs/ROADMAP.md` what is planned. Server in `server/`, web app in `web/src`
(React 19, Vite, Tailwind 4). Run with `npm run dev`; check with `npm run typecheck` and `npm test`.

## UI work

- Before any UI or visual change, invoke the `design-workflow` skill and say which skill it routed to.
- Read `design/DESIGN.md` and anything in `design/references/` before proposing or building UI.
- At the start of each phase of UI work, state which skills you loaded and which reference files you read.
- Reuse the tokens in `web/src/styles.css` and the components in `web/src/components/ui.tsx`. Ask before adding a
  colour, a font or a new component pattern.
- Both themes matter: dark is the default, light is a toggle (`web/src/theme.ts`). Check every change in both.
- Verify every UI change in the running app (http://127.0.0.1:4870) at desktop and phone width before calling it done.
- A larger pass follows this order and stops for approval between steps: audit (list problems with short IDs, change
  nothing) -> plan (Marco picks IDs) -> build one phase per commit -> design review and accessibility check -> update
  `design/DESIGN.md` if a decision changed.
