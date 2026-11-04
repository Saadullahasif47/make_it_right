# Motion system

MakeItRight moves only to show that something changed, to help someone find their way, or to answer an action.
Everything else stays still. This page is the reference; the tokens live in `src/app/globals.css`.

## Tokens

| Token                    | Value                                                 | Used for                                           |
| ------------------------ | ----------------------------------------------------- | -------------------------------------------------- |
| `--motion-fast`          | 150 ms (the default for every `transition-*` utility) | hover, press, focus, row highlight, colour changes |
| `--motion-base`          | 200 ms                                                | toasts, the tab indicator, status changes          |
| `--motion-slow`          | 250 ms                                                | the drawer: the largest surface that moves         |
| `--ease-enter` (default) | `cubic-bezier(0.2, 0, 0, 1)`                          | entering or responding: decelerate into place      |
| `--ease-exit`            | `cubic-bezier(0.4, 0, 1, 1)`                          | leaving: accelerate away                           |

Components do not write durations or curves in their class lists. Tailwind's `--default-transition-duration` and
`--default-transition-timing-function` carry the fast duration and the entering curve; anything else names a token,
for example `duration-(--motion-base)` or `ease-(--ease-exit)`.

## What moves, and why

| Interaction                 | Motion                                                                                         | What it tells the person                  |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Link, row, field            | colour, background and border cross-fade, 150 ms                                               | this is interactive; this has focus       |
| Button (primary, secondary) | lifts 1 px with a soft shadow, arrow nudges 2 px forward, 150–200 ms; settles on press         | this can be pressed; it responded         |
| Homepage hero               | badge, headline, text, buttons and demo rise 16 px into place, staggered, 640 ms, once on load | the page has arrived                      |
| Homepage sections           | each section below the fold rises into view once when reached                                  | here is the next part of the story        |
| Tab and sidebar navigation  | the active indicator eases in (opacity and horizontal scale), 200 ms                           | where you are now                         |
| Slow navigation             | a small dot fades in on the destination after 150 ms (`useLinkStatus`)                         | your click registered; the page is coming |
| Drawer (landing, phones)    | panel slides 16 px and fades; backdrop fades; 250 ms; closes on the exit curve                 | a layer opened over the page              |
| Toast                       | enters by rising 8 px and fading in, 200 ms; leaves by fading and sinking, 150 ms              | an action finished                        |
| Submit button               | label changes at once; spinner fades in only after 150 ms; width never changes                 | your request is being handled             |
| Newest history entry        | after an action, one brand tint that settles away over 1.2 s                                   | this is what just changed                 |
| Skeleton placeholder        | static at first; dims gently only if loading passes 600 ms                                     | still loading                             |

## What never moves

- Entrances are limited to the homepage (hero on load, each section once on arrival). Signed-in pages never animate
  content in: their content is there at once. Without JavaScript or with reduced motion, nothing is ever hidden.
- No bounce, float, sheen, pulse rings, perpetual movement (other than a skeleton or spinner for a real wait), or
  page transitions.
- Hover movement is limited to buttons: a 1 px lift and a soft shadow, no scaling. Ghost buttons, links, rows and
  panels change colour only. With reduced motion, buttons do not lift.
- Static panels, such as the dashboard's number tiles, do not react to hover: reacting would suggest they can be
  clicked.
- No animated layout properties (`width`, `height`, `margin`, `top`, …). Only `opacity`, `transform`, `translate`,
  `scale` and colours change, so the browser composites them cheaply on an ordinary laptop or phone.

## Accessibility and robustness

- **Reduced motion:** `prefers-reduced-motion: reduce` makes every transition and animation effectively instant and
  stops every loop. State is never carried by motion alone: a pending button also changes its label, and a status
  region announces it.
- **Interruptible:** state changes use CSS transitions, which reverse smoothly from wherever they are. The keyframes
  are one-shot and short, apart from the skeleton and spinner, which end as soon as loading does.
- **No layout shift:** toasts float; the pending label shares a grid cell with the idle label; the navigation hint is
  always rendered and only changes opacity; the history tint cancels its own padding.

## Checked by

- `tests/e2e/motion.spec.ts`: durations stay within 250 ms; nothing transitions a layout property or `all`; under
  reduced motion everything is instant.
- `tests/unit/components/submit-button.test.tsx`: the pending state keeps both labels in place, shows the pending
  label as the button's name, and announces it.
