# AdJury — Design System

> **Status:** Draft v1 · **Last updated:** 2026-08-29
> The look and feel must read **professional / enterprise-credible** — a tool a marketing director trusts. **Not** a "cutesy AI startup." Restrained, confident, high-contrast.

---

## 1. Design Principles

1. **Trust over flash.** Clean layouts, generous whitespace, no gimmicks or emoji-heavy UI.
2. **Legible verdicts.** Scores and flags must be instantly readable — color-coded but never color-*only* (pair with labels/icons for accessibility).
3. **Calm surface, decisive accents.** Navy/white dominate; Royal Blue and Burgundy are used sparingly for emphasis and risk.
4. **Consistency is credibility.** One type scale, one spacing scale, one component library.

---

## 2. Color Palette

Brand palette from the README: **Navy Blue, Royal Blue, Black, White, Burgundy.** Assigned specific roles and hex values below.

| Token | Hex | Role |
|---|---|---|
| **Navy** | `#0A1F44` | Primary brand color — headers, nav, primary surfaces on dark |
| **Royal Blue** | `#1E40AF` | Primary action / links / active states |
| **Royal Blue (bright)** | `#2563EB` | Hover / focus accent |
| **Burgundy** | `#6B1F2A` | Risk, compliance flags, destructive actions |
| **Burgundy (bright)** | `#8B2635` | Burgundy hover / emphasis |
| **Black** | `#0B0B0F` | Primary text on light, deepest surface |
| **White** | `#FFFFFF` | Base background, text on dark |

### Supporting neutrals & semantics
| Token | Hex | Role |
|---|---|---|
| Slate 50 | `#F7F8FA` | App background (off-white, less harsh than pure white) |
| Slate 200 | `#E4E7EC` | Borders, dividers |
| Slate 500 | `#667085` | Secondary text, captions |
| Slate 700 | `#344054` | Body text on light |
| Success | `#15803D` | `pass` verdict / high scores (9–10) |
| Warning | `#B45309` | `revise` verdict / mixed scores (5–6) |
| Danger | `#B91C1C` | `fail` verdict / failing scores (0–2) — align with Burgundy family |

> **Score → color mapping** (pair with the numeric score and a label; never color alone):
> 9–10 Success · 7–8 Royal Blue · 5–6 Warning · 3–4 Warning-deep · 0–2 Danger.
> **Compliance flags** always use the Burgundy/Danger family regardless of score.

### CSS custom properties (starter)
```css
:root {
  --navy: #0A1F44;
  --royal: #1E40AF;
  --royal-bright: #2563EB;
  --burgundy: #6B1F2A;
  --burgundy-bright: #8B2635;
  --black: #0B0B0F;
  --white: #FFFFFF;

  --bg: #F7F8FA;
  --surface: #FFFFFF;
  --border: #E4E7EC;
  --text: #344054;
  --text-strong: #0B0B0F;
  --text-muted: #667085;

  --success: #15803D;
  --warning: #B45309;
  --danger: #B91C1C;
}
```

---

## 3. Typography

Enterprise-neutral, highly legible. Ship with system-safe fallbacks; optionally load one geometric sans for headings.

| Use | Family | Notes |
|---|---|---|
| **Headings** | `Inter`, then `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` | Tight tracking, weight 600–700 |
| **Body** | `Inter` / system sans | Weight 400–500, 1.5–1.6 line-height |
| **Numeric / scores** | `Inter` with tabular figures (`font-variant-numeric: tabular-nums`) | Keeps scorecards aligned |
| **Mono (code, JSON)** | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | For the developer-facing JSON output |

### Type scale (rem, 16px base)
| Token | Size | Weight | Use |
|---|---|---|---|
| Display | 2.5 (40px) | 700 | Landing hero |
| H1 | 2.0 (32px) | 700 | Page titles |
| H2 | 1.5 (24px) | 600 | Section headers |
| H3 | 1.25 (20px) | 600 | Card titles / juror names |
| Body | 1.0 (16px) | 400 | Default text |
| Small | 0.875 (14px) | 400 | Captions, metadata |
| Score | 2.0 (32px) | 700 | Aggregate score display |

---

## 4. Spacing, Radius, Elevation

- **Spacing scale (px):** 4, 8, 12, 16, 24, 32, 48, 64. Use multiples of 4.
- **Radius:** `sm` 6px (inputs), `md` 10px (cards), `lg` 16px (modals). Nothing bubbly/rounded-full except avatars and pills.
- **Elevation:** subtle only — `0 1px 2px rgba(11,11,15,.06)` for cards; deeper shadow reserved for modals/menus. Avoid heavy drop shadows.
- **Borders over shadows** for structure on the light UI — 1px `--border`.

---

## 5. Components (visual direction)

- **Scorecard** — white surface, Navy header bar, aggregate score large and left-aligned, verdict pill (Success/Warning/Danger) top-right.
- **JurorCard** — juror name (H3), score chip (color-mapped), one-line summary, expandable issues list, suggested-rewrite block in a lightly tinted panel.
- **Verdict pill** — filled, high-contrast: `pass` = Success, `revise` = Warning, `fail` = Danger/Burgundy. Always includes the word, not just color.
- **Buttons** — primary = Royal Blue solid; secondary = Navy outline; destructive = Burgundy. Clear focus ring (`--royal-bright`, 2px).
- **Forms** — labeled inputs, `sm` radius, visible focus, inline validation messages in Danger.
- **Tables/history** — quiet zebra or bordered rows, tabular numerals, sortable headers.

---

## 6. Accessibility

- Target **WCAG 2.1 AA** for core flows.
- **Never encode meaning in color alone** — verdicts and score tiers always carry a text label and/or icon.
- Body text contrast ≥ 4.5:1; large text ≥ 3:1. Verify Royal Blue / Burgundy on white and on Navy.
- Visible keyboard focus on every interactive element; logical tab order.
- Respect `prefers-reduced-motion`; keep animation minimal and functional.

---

## 7. Voice & Tone (UI copy)

- Confident, concise, professional. No hype, no emoji in product chrome.
- Feedback framing is **constructive**: name the issue, then the fix. Mirrors the product promise (suggested rewrites, not just criticism).
- Error messages are plain-language and actionable.

---

_Related: [PRD.md](PRD.md) · [Architecture.md](Architecture.md) · [Rules.md](Rules.md)_
