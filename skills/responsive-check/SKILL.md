---
name: responsive-check
description: Verify a page or component is mobile-first and responsive at phone, tablet and desktop widths — no horizontal scroll, 44px touch targets, no hover-only actions, light/dark themes. Use before declaring any UI change done, or when the user reports layout problems on a device.
---

# Responsive check

Run this on every page you created or changed. Report findings per width; fix before finishing.

## Widths

| Name | Width | Represents |
| --- | --- | --- |
| Phone | 360 px | Small Android — the baseline the base styles target |
| Tablet | 768 px | `md:` breakpoint |
| Desktop | 1280 px | `lg:`/`xl:` |

How to view them: browser devtools device toolbar, or a browser-automation tool if the agent has one. For a real phone on the LAN, set `BETTER_AUTH_TRUSTED_ORIGINS` (see env.example) and open `http://<LAN-IP>:3000`.

## Checklist (each width)

- [ ] **No horizontal page scroll.** Quick test in the console: `document.documentElement.scrollWidth > innerWidth` must be `false`.
- [ ] Wide tables scroll inside their own container or switch to cards.
- [ ] Touch targets ≥ 44×44 px (buttons, icon buttons, links in lists, checkbox hit areas).
- [ ] No action reachable only by hover (tooltips are fine as extras, menus need a tap target).
- [ ] Text doesn't overflow or truncate important data; long Spanish labels wrap.
- [ ] Forms: one column on phone, inputs full width, correct `type`/`inputMode` (email, tel, numeric) so the right keyboard opens.
- [ ] Dialogs/sheets fit the viewport and scroll internally.
- [ ] Both light and dark theme readable (`d` toggles theme).

## Code smells to look for

- Desktop-first classes overridden downward (`grid-cols-3 sm:grid-cols-1`) → invert to `grid-cols-1 md:grid-cols-3`.
- Fixed widths (`w-[600px]`, `min-w-*` on page-level containers).
- `hover:` as the only way to reveal controls.
- `h-8`/`size-8` icon buttons without padding to reach 44px.
