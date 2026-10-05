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

## Navigation (decided 2026-10-05)

Five sections in the nav: **Overview, Labs, Students, Resources, Settings**. A section with several pages shows them as tabs under
its title, in the same pill style as the launch dialog's presets (`rounded-full`, signal border when open):
Labs = Running · Catalog; Resources = Inventory · Orphan hunt · Log. Every page keeps its own hash (`#catalog`, `#hunt`, `#log`...),
so links and `go()` calls did not change, and clicking a section returns to the page last open in it. The orphan-finding count shows on
the Resources nav item and on the Orphan hunt tab. Reason: eight entries overflowed the phone-width nav. On a phone only the open
section shows its name; the others are icons with accessible labels. New sections should join an existing one before they get an entry.

## Lists (decided 2026-10-05, from the Students screen)

A roster is a divided list, not cards: a header row of mono labels from `sm` up, five columns, and on a phone two lines (name and
status, then the secondary facts). Status is a `Chip` with text (calm = healthy, plain = finished, signal = failed); an overdue date is
mono in signal. Names and emails truncate rather than wrap. Cards stay for a few long-lived things with their own actions (Labs).

Row actions sit in the last column (a line of their own on a phone) and show one action per state: a quiet **Delete** on a live
row, a `calm` **Create again** on an ended or failed one, nothing while a job runs (the status chip reads "Deleting"). Their
accessible names include the person's name, because the visible text repeats on every row. Destructive confirmations use the
`danger` modal with a plain Cancel and Delete; the typed-name confirmation stays for things that cannot be recreated (Inventory).

Dialogs that start with a form focus their first field once open: the modal takes focus on open, which overrides `autoFocus`, so the
form focuses the field itself. A result the admin must pass on (the student's message) gets its own view with a Copy button, and
says so when the clipboard is blocked instead of failing silently.

Known gap, from the Students pass and not new: buttons are about 28px tall (`Btn` is `py-1.5 text-xs`), under the usual 44px touch
target. It affects the whole app, so it is a decision for a later pass rather than for one screen.

## Not decided yet (fill in during the first UI pass)

- A type scale and spacing scale (sizes are set per component today).
- Rules for tables: density, numeric alignment, row actions.
- How destructive actions look and confirm, across every screen.
- What we do not want the app to look like.

## References

Put screenshots of interfaces you like in `design/references/` and add one line here saying what to take from each.
