# HTML Report App Guidelines

These rules extend the repo-root `AGENTS.md` for `packages/html-report-app`.

## Purpose

Keep the HTML report app visually aligned with `DESIGN.md` and approved design screens while preserving truthful data presentation.

## Design Source Of Truth

- `DESIGN.md` defines the shared visual system.
- Approved design screens define final screen composition and pixel-level overrides.
- If an approved screen and a base design token conflict visually, prefer the approved screen for that screen only.

## Data Presentation

- Prefer direct report fields whenever the data exists in the report contract.
- Do not invent backend facts for UI convenience.
- If the UI needs data that already exists upstream, prefer enriching the report contract over guessing in the screen layer.
- Derived copy is allowed only when it stays semantically faithful to the underlying data.
- Never leak raw machine-oriented ids, rule names, or metric keys into visible UI if they can be humanized safely.

## Charts And Metrics

- A label, bar, chip, or score treatment must represent the same metric.
- Do not mix one metric in the text with another in the visual encoding.
- If a chart concept cannot be backed truthfully by the available data, hide it or simplify it rather than faking it.
- Heuristic summaries are allowed, but they should be clearly presentation-layer interpretation, not implied analysis outputs.

## Responsive Behavior

- Prefer keeping tables readable through minimum widths and horizontal scroll before collapsing them.
- Collapse tabular structures only when readability genuinely requires it.
- Preserve alignment and hierarchy first; decorative fidelity comes second on smaller breakpoints.

## Shared UI Patterns

- Repeated layout or typography patterns should be extracted into shared components when they are stable across screens.
- Do not force every screen element into shared primitives if that harms pixel fidelity with an approved screen.
- Screen-specific overrides are acceptable when they are deliberate and local.

## Verification

- For visual changes, build the app and compare against the relevant approved screen export or screenshot when available.
- Prefer the targeted app build for HTML report UI-only changes: `pnpm --filter @codesentinel/html-report-app build`.
- After a successful targeted app build, refresh the CLI's copied report assets with `pnpm --filter ./packages/cli exec node ./scripts/copy-html-report-app.mjs` so `pnpm start -- report . --format html --open` uses the updated bundle without a full workspace build.
- If a change touches shared report data or types, verify the producing package as well, not only the app.
