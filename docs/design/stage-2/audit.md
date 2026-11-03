# Stage 2 gate: landing and authentication

Recorded 2026-11-04 against live deployments, after PR #10 merged (`126cb9a`).

- **Before:** Stage 1 preview, https://makeitright-git-design-stage-1-foundation-takeasy1.vercel.app (`f0802d2`)
- **After:** production, https://makeitright-takeasy1.vercel.app (`126cb9a`)

## Screens, axe and overflow

`pnpm design:audit` (`scripts/design-audit.mts`) captured `/`, `/login`, `/signup` and `/forgot-password` at 390, 768,
1366 and 1440 px in light mode, and at 390 and 1440 px in dark mode, with reduced motion. On each screen it ran axe
(WCAG 2.0, 2.1 and 2.2 A and AA) and checked for horizontal overflow.

| Deployment | Screens | axe violations | Horizontal overflow |
| ---------- | ------- | -------------- | ------------------- |
| Before     | 24      | 0              | none                |
| After      | 24      | 0              | none                |

To show these zeros are real, the same axe setup was run against a page with known faults. It reported
`image-alt`, `color-contrast` and `document-title`, plus the overflow.

## Lighthouse accessibility (after)

Lighthouse 12.8.2, accessibility category only, headless Chromium 1248.

| Page               | Mobile | Desktop |
| ------------------ | ------ | ------- |
| `/`                | 100    | 100     |
| `/login`           | 100    | 100     |
| `/signup`          | 100    | 100     |
| `/forgot-password` | 100    | 100     |

## Screenshots kept here

Landing and sign-in at 390 and 1440 px, plus the landing page in dark mode at 390 px, before and after. The full set of
48 screenshots is regenerated with:

```sh
pnpm design:audit --label after
pnpm design:audit --label before --base-url https://makeitright-git-design-stage-1-foundation-takeasy1.vercel.app
```

The gate's remaining check, CI green, passed on PR #10 before it merged.
