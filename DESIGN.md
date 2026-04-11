# Design System Strategy: Engineering Precision & Editorial Calm

## 1. Overview & Creative North Star: "The Digital Curator"

The objective of this design system is to pivot away from the cluttered, high-alert aesthetics typical of security software and move toward the quiet authority of a high-end engineering journal.

**The Creative North Star: "The Digital Curator."**
This system treats engineering data as a curated exhibition. We move beyond the "template" look by utilizing intentional asymmetry, expansive white space, and a rigid adherence to tonal depth rather than structural lines. The goal is to provide decision support, where the interface recedes to let engineering quality and critical insights take center stage. We achieve this through tonal layering, controlled accent use, and a stable shell that makes every report screen feel like part of one composed artifact.

This document is both:

- a visual philosophy
- a shared design contract for the product and the HTML report app

Approved design screens remain the final authority for pixel-perfect composition. This document defines the durable system beneath them rather than prescribing every screen in detail.

---

## 2. Colors & Surface Philosophy

The palette is built on a foundation of off-whites and atmospheric grays. We use color as functional metadata, not decoration.

### Color Tokens

- `surface`: `#f9f9fb`
- `surface-container-low`: `#f2f4f6`
- `surface-container`: `#ebeef2`
- `surface-container-high`: `#e4e9ee`
- `surface-container-lowest`: `#ffffff`
- `primary`: `#5f5e60`
- `primary-container`: `#e4e2e4`
- `tertiary`: `#005dbb`
- `tertiary-container`: `#5095fe`
- `secondary`: `#5f5f62`
- `error`: `#9f403d`
- `error-container`: `#fe8983`
- `on-surface`: `#2d3338`
- `on-surface-variant`: `#596065`
- `outline-variant`: `#acb3b8`

### The "No-Line" Rule

Do not use hard 1px borders as the default containment mechanism for layout sections. Prefer:

- surface changes
- white space
- tonal layering

Allowed exceptions:

- accessibility-driven ghost borders
- focus rings
- approved screen compositions that explicitly use a border or accent edge

If a border is necessary, it should be `outline-variant` at 10% to 15% opacity.

### Surface Hierarchy & Nesting

Treat the UI as stacked sheets of heavy-stock paper.

- Base layer: `surface`
- Primary layout blocks: `surface-container-low`
- Interactive cards and inset report blocks: `surface-container-lowest`
- Utility and inert elements: `surface-container-high`

Parent-child relationships should be visible through nested surface shifts before any border is introduced.

### Glass & Gradient Rule

For floating navigation, drawers, or overlays:

- use `surface-container-lowest` at low opacity
- use `backdrop-blur`
- keep the effect soft, not glossy

Glassmorphism is used selectively for floating shells, drawers, overlays, and occasional elevated highlight moments. It is not the default styling language of report content.

Signature gradient usage is reserved for high-level hero moments or premium report actions. It should be subtle and never become the background language of the whole product.

---

## 3. Typography: The Editorial Scale

We use **Inter** as the primary typeface and rely on weight, spacing, and tonal contrast rather than font changes.

### Core Type Tokens

| Token         | Size        | Weight | Letter Spacing | Use Case                                    |
| :------------ | :---------- | :----- | :------------- | :------------------------------------------ |
| `display-lg`  | `3.5rem`    | `600`  | `-0.02em`      | Hero metrics or report scores               |
| `headline-sm` | `1.5rem`    | `500`  | `-0.01em`      | Major section headers                       |
| `title-md`    | `1.125rem`  | `600`  | `0`            | Card titles and report labels               |
| `body-md`     | `0.875rem`  | `400`  | `0`            | Primary descriptions                        |
| `body-sm`     | `0.8125rem` | `400`  | `0`            | Dense data rows and compact supporting copy |
| `label-sm`    | `0.6875rem` | `700`  | `+0.05em`      | All-caps metadata and tags                  |

### Additional Repeated Roles

These roles appear often enough across report screens to deserve stable treatment:

- `section-heading`
  - `1rem`
  - regular weight
  - used for quieter section titles like `Immediate Attention Required`
- `nav-text`
  - `0.875rem`
  - tight tracking
  - used in sidebar, topbar metadata, and navigation contexts
- `meta-label`
  - equivalent to `label-sm` with stronger metadata emphasis
- `metric-value`
  - the visual family used for large numerical scores
- `metric-unit`
  - subdued companion text for values like `/100`

### Editorial Intent

- Use `on-surface` for primary headings and important findings.
- Use `on-surface-variant` for secondary explanations and metadata.
- Avoid heavy bolding for every title. Weight contrast should be used selectively.
- Approved design screens may require local overrides where a literal token application looks too heavy. In those cases, the screen-level composition wins.

---

## 4. Elevation & Depth: Tonal Layering

Traditional dark shadows are too muddy for this system. Prioritize tonal layering.

### Layering Principle

Place a `surface-container-lowest` card on top of a `surface-container-low` background to create soft lift.

### Ambient Shadow

Use when a floating effect is necessary:

`box-shadow: 0 12px 40px rgba(45, 51, 56, 0.06);`

The shadow must derive from `on-surface`, never pure black.

### Ghost Border Fallback

If a border is needed:

- use `outline-variant`
- keep opacity low
- let it suggest a boundary rather than draw one aggressively

---

## 5. Screen Shell & Layout

The report must feel like one publication, not a set of unrelated dashboards.

### Page Container

- max content width: `7xl`
- default page padding should be generous and consistent across screens
- major sections should breathe, using white space before borders

### Page Intro Pattern

Every major screen should begin with the same shell-level intro pattern:

- eyebrow label
- page title
- one supporting description block
- optional aside block for a status pill or hero metric

Default intro behavior:

- one stable title scale across primary screens
- description uses the primary body style
- intro-to-first-content spacing should be governed by shared layout, not per-screen ad hoc margins

### Sidebar / Rail / Drawer

- desktop uses a full sidebar
- tablet may collapse to a rail
- mobile uses a drawer

The brand mark should remain a stable home affordance across these states.

### Top Bar

- desktop and tablet prioritize title, metadata, utility actions, and download
- mobile should keep controls square, balanced, and icon-first
- responsive changes should preserve the same product identity rather than invent a second header system

---

## 6. Spacing Rules

Spacing should be generous and consistent.

### Major Module Spacing

- use generous spacing between major modules
- do not compensate for weak layout separation by adding borders

### Card Padding

- standard cards should feel generous
- inset or utility blocks may compress, but should still breathe

### Table and Dense Data Spacing

- prefer vertical white space and row hover states over row dividers
- if responsive compression makes a table unreadable, prefer:
  - horizontal scroll
  - or a deliberate layout change at a known breakpoint
- do not let content collapse into unreadable squeezed columns
- for tables whose first column identifies the entity, keep that context visible during horizontal scroll while preventing long paths or ids from dominating the viewport

---

## 7. Components: Engineering-First Design

### Buttons

- Primary:
  - `primary` background
  - `on-primary` text
  - quiet radius
  - restrained hover treatment
- Tertiary:
  - no fill
  - use `primary` or `tertiary` text
  - should not compete visually with report content

### Status Chips

Accent colors must remain sparse.

- Health:
  - default family is `tertiary`
  - use subtle tonal variation by health tier
  - weak states may shift toward neutral or muted warning, not a loud traffic-light system
- Risk:
  - uses restrained error-family treatment
  - low risk should not read as red
  - moderate risk should remain quiet
  - elevated and above may use the error family

### Score Cards

Use large numerical values with quiet unit text and a restrained semantic accent.

- Risk score and health posture are separate semantic families
- avoid rainbow severity ramps
- use subtle tone changes, not saturated alert colors

### Issue Cards

- use quiet left-edge emphasis where approved by the screen composition
- tag text should remain compact and editorial
- internal rule ids or raw data keys should never leak into visible UI copy

### Inputs

- default background: `surface-container-low`
- no hard border by default
- on focus: surface lift plus ghost border

### Engineering Reports and Tables

- no internal row dividers by default
- use `body-sm` for dense data
- headers should use `label-sm` or `meta-label`
- preserve alignment across long path values and variable content
- use constrained wrapping for long path and id values so dense tables remain readable across viewport sizes

### Comparison Panels

- comparison UIs should remain visually clear and compact across breakpoints
- alignment matters more than decorative treatment

---

## 8. Data Visualization Rules

Charts and visual encodings must map to real values.

### General Rule

Never mix one metric in the label with a different metric in the bar or chart shape.

### Preferred Visual Language

- use `tertiary` and `secondary` families for neutral analytic display
- use muted error emphasis only where actual risk concentration is the point
- avoid rainbow palettes

### Chart Scaffolds

When a visualization has a neutral scaffold plus a highlighted region:

- the scaffold should be visually stable
- the colored segment should be the variable part

This is the preferred treatment for simplified distribution or concentration views.

---

## 9. Responsive Behavior

Responsive adaptation must preserve the same composed system, not create a separate mini design language.

### Mobile

- square icon buttons
- drawer navigation instead of persistent sidebar
- icon-first controls
- tables may collapse into cards only when readability truly requires it

### Tablet

- retain tabular layouts longer than mobile when content is still readable
- where long paths exist, prefer minimum width plus horizontal scroll over unreadable compression

### Desktop

- preserve asymmetry
- support wider editorial compositions
- allow side-by-side comparison modules and bento-like analysis groupings

---

## 10. Approved Screen Overrides

This document defines the base system. Approved design screens define the final composition.

If an approved screen differs from the base tokens in a way that improves pixel-perfect accuracy:

- preserve the screen-level appearance
- document the reason in code if the override is not obvious
- do not mutate the shared design primitives unless the pattern is truly reusable

Examples:

- quieter section-heading weights than literal `headline-sm`
- tighter mobile topbar balance
- screen-specific CTA proportions

---

## 11. Do's and Don'ts

### Do

- Use asymmetry.
- Embrace negative space.
- Use nested surfaces to express parent-child engineering relationships.
- Keep semantic accent usage sparse.
- Normalize shared shell patterns before making screen-local exceptions.

### Don't

- Don't use pure black.
- Don't use cyber, neon, or terminal tropes.
- Don't use hard dividers as the default layout tool.
- Don't introduce multicolor severity palettes unless the product semantics truly require them.

---

## 12. Evolution Rule

The design system should evolve when:

- a repeated screen pattern clearly emerges
- a report contract gap forces UI guesswork
- an approved design screen exposes a better stable pattern

It should not grow by documenting every local exception or current implementation detail.
