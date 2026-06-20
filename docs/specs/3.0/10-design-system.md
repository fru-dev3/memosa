# 10 — Design System & Shared Components (Frontend)

The 3.0 look, as reusable React + CSS. Source of truth = the mockups in `docs/design/`.
Depends on **09** (for data-bound components). No emoji anywhere.

## Tokens (CSS variables, two themes)
- **Daylight** (default): canvas `#FAFAF7`, surface `#FFFFFF`, hairline `#EAEAE3`,
  text `#1A1A17`, muted `#6E6E66`, accent `#1F4D3A`, accent-soft `#EAF1EC`, live `#C2412B`.
- **Vault** (dark): canvas `#0C0D0F`, surface `#15171B`, hairline `#272A30`, text `#ECEDEF`,
  muted `#888F98`, accent `#4CC38A`, live `#E0654A`.
- Theme via `:root[data-theme]`; "Auto" follows system. Persist in `.memosa/config.json`.

## Typography
- Display/headings + conversation titles: **Newsreader** (serif). UI: **Inter**.
- Timestamps, durations, kickers, code/config: **JetBrains Mono**. Bundle fonts locally
  (no Google CDN in the shipped app).

## Iconography
- One monochrome line-icon set (Lucide or SF Symbols), 1.5px stroke, `currentColor`.
  Replace every existing emoji. A single `<Icon name>` component.

## Shared components
- `WindowChrome` (titlebar/traffic-lights region), `Rail` (nav + nested domain **Tree**),
  `Tree`/`TreeNode` (recursive, indented + guide lines, caret collapse), `List`/`Row`,
  `Detail` + `Tabs`, control kit: `Switch`, `Segmented`, `Select`, `Field`, `Button`,
  `Toast`, `Sheet`, `Dialog`, `CommandPalette`, `Overlay`.
- `ModeBadge` (Bunker/Cloud), `ThemeToggle`.

## Acceptance
Storybook-style page renders every component in both themes; matches the mockup screenshots
(`docs/design/*.png`) within reason. Zero emoji; all icons from the set.
