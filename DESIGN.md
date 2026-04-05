# Design System Strategy: Engineering Precision & Editorial Calm

## 1. Overview & Creative North Star: "The Digital Curator"

The objective of this design system is to pivot away from the cluttered, high-alert aesthetics typical of security software and move toward the quiet authority of a high-end engineering journal.

**The Creative North Star: "The Digital Curator."**
This system treats engineering data as a curated exhibition. We move beyond the "template" look by utilizing intentional asymmetry, expansive white space, and a rigid adherence to tonal depth rather than structural lines. The goal is to provide "Decision Support"—where the interface recedes to let the engineering quality and critical insights take center stage. We achieve this through "The No-Line Rule" and a sophisticated "Stacking" philosophy.

---

### 2. Colors & Surface Philosophy

The palette is built on a foundation of "Off-Whites" and "Atmospheric Grays." We use color not as decoration, but as functional metadata.

#### The "No-Line" Rule

Explicitly prohibit 1px solid borders for sectioning or layout containment. Boundaries must be defined solely through background color shifts or subtle tonal transitions. For example, a `surface-container-low` section sitting on a `surface` background provides enough contrast to indicate a boundary without the visual "noise" of a line.

#### Surface Hierarchy & Nesting

Treat the UI as a series of physical layers—like stacked sheets of fine, heavy-stock paper.

- **Base Layer:** `surface` (#f9f9fb)
- **Primary Layout Blocks:** `surface-container-low` (#f2f4f6)
- **Interactive Elements/Cards:** `surface-container-lowest` (#ffffff)
- **Utility/Inert Elements:** `surface-container-high` (#e4e9ee)

#### The "Glass & Gradient" Rule

To elevate the experience above a standard SaaS dashboard, use Glassmorphism for floating navigation or modal overlays. Use a 15% opacity on `surface_container_lowest` with a `backdrop-blur` of 20px.
_Signature Texture:_ For high-level status or hero CTAs, apply a subtle linear gradient from `primary` (#5f5e60) to `primary_container` (#e4e2e4) at a 45-degree angle to create "soft-touch" depth.

---

### 3. Typography: The Editorial Scale

We use **Inter** as our primary typeface, leaning heavily on weight variance and letter-spacing to create a "San Francisco" style hierarchy.

| Token           | Size      | Weight          | Letter Spacing | Use Case                       |
| :-------------- | :-------- | :-------------- | :------------- | :----------------------------- |
| **display-lg**  | 3.5rem    | 600 (Semi-Bold) | -0.02em        | Hero metrics or report scores. |
| **headline-sm** | 1.5rem    | 500 (Medium)    | -0.01em        | Major section headers.         |
| **title-md**    | 1.125rem  | 600 (Semi-Bold) | 0              | Card titles and report labels. |
| **body-md**     | 0.875rem  | 400 (Regular)   | 0              | Primary data descriptions.     |
| **label-sm**    | 0.6875rem | 700 (Bold)      | +0.05em        | All-caps metadata/tags.        |

**Editorial Intent:** Use `on_surface_variant` (#596065) for secondary body text to reduce visual weight, reserving the deep `on_surface` (#2d3338) for primary headlines and critical findings.

---

### 4. Elevation & Depth: Tonal Layering

Traditional shadows are often too "muddy." We prioritize **Tonal Layering** to create hierarchy.

- **The Layering Principle:** Place a `surface-container-lowest` (#ffffff) card on top of a `surface-container-low` (#f2f4f6) background. The change in brightness creates a "Soft Lift" that feels high-end and clean.
- **Ambient Shadows:** When a "floating" effect is necessary (e.g., a critical alert or dropdown), use an extra-diffused shadow: `box-shadow: 0 12px 40px rgba(45, 51, 56, 0.06);`. The shadow color must be a derivative of the `on-surface` color, not pure black.
- **The "Ghost Border" Fallback:** If accessibility requirements demand a border, use the `outline_variant` token at **15% opacity**. This creates a "suggestion" of a boundary rather than a hard wall.

---

### 5. Components: Engineering-First Design

#### Buttons

- **Primary:** `primary` (#5f5e60) background with `on_primary` (#faf7f9) text. 4px (`md`) corner radius. Use a subtle inner-glow on hover.
- **Tertiary:** No background. Use `primary` text with a `label-md` weight. This keeps the focus on the report content.

#### Engineering Reports (Tables)

- **No Internal Dividers:** Use vertical white space (`spacing-lg`) and subtle row highlights on hover using `surface_container_low`.
- **Data Density:** Use `body-sm` for table data to allow for high information density without clutter.

#### Status Chips (The Restricted Palette)

- **Health:** `tertiary_container` (#5095fe) text on a `surface` background. No bold backgrounds.
- **Risk:** `on_error_container` (#752121) text on a `error_container` (#fe8983) background at 20% opacity.
- _Rule:_ Accent colors should never occupy more than 5% of the total screen real estate.

#### Input Fields

- **Design:** Use `surface_container_low` as the background with no border. Upon focus, shift to `surface_container_lowest` and apply the "Ghost Border" of `outline_variant`.

#### Data Visualizations

- Use the `tertiary` (#005dbb) and `secondary` (#5f5f62) tokens. Avoid the "rainbow" chart effect. Use varying shades of one color to show intensity, rather than multiple hues.

---

### 6. Do's and Don'ts

#### Do

- **Use Asymmetry:** Balance a large metric on the left with deep, multi-paragraph analysis on the right.
- **Embrace the "Negative Space":** Allow at least 48px of padding between major report modules.
- **Stacking:** Use nested containers (High on Low) to show parent-child relationships in engineering data.

#### Don't

- **Don't use 100% Black:** It is too harsh. Always use `on_surface` (#2d3338).
- **Don't use "Cyber" Tropes:** No neon greens, no glowing scan lines, no tech-polygons. We are building a tool for senior engineers, not a Hollywood hacker terminal.
- **Don't use Hard Dividers:** If you feel the need to add a line, try adding 16px of extra whitespace instead.
- **Don't use Playful Icons:** Icons must be thin-stroke (1px or 1.5px), geometric, and functional. Avoid rounded, bubbly, or "friendly" illustrations.
