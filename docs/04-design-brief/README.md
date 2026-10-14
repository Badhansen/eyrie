# 04 — Design Brief

| Field | Value |
| --- | --- |
| Product | Eyrie |
| Owner | Badhan Sen |
| Status | Documents the shipped design system (`apps/web/src/styles.css`) |
| Last updated | 2026-10-08 |
| Answers | How should Eyrie look and feel? |
| Related | [App Flow](../03-app-flow/README.md) · [PRD](../01-product-requirements/README.md) |

This brief is derived from the interface as built, so it works both as a specification for new surfaces and as a reference for what already exists. Tokens below are the real values in `apps/web/src/styles.css`.

## 1. Identity and tone

An *eyrie* is a bird of prey's nest on a crag — the vantage point you watch the whole territory from. The interface should feel like an instrument at that vantage point: precise, quiet, and dense with information that is nonetheless readable.

| Attribute | Expression |
| --- | --- |
| Precise | Small type, tight rules, exact alignment to lanes. Nothing decorative |
| Quiet | Graphite surfaces; colour reserved for meaning, never for decoration |
| Technical | Monospace for every path, route and line number |
| Alive | Motion only when the graph actually changes — it reports, it does not entertain |
| Trustworthy | If something is uncertain or broken, the UI says so (red `broken` nodes, confidence on edges) |

What it should never feel like: a marketing dashboard, a mind-mapping toy, or a generic node editor.

## 2. Colour

Dark is the default; light is a full peer via `prefers-color-scheme`. The palette has two halves — **neutral inks** that carry the chrome, and a **semantic palette** where every hue means one thing.

### Neutrals

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--color-ink-0` | `#0d1012` | `#f4f5f2` | App background / canvas |
| `--color-ink-1` | `#13171a` | `#fbfbf9` | Panels, top bar |
| `--color-ink-2` | `#191e22` | `#ffffff` | Raised surfaces, nodes |
| `--color-ink-3` | `#20262b` | `#eceeea` | Hover / inset surfaces |
| `--color-rule` | `#252b30` | `#dfe2dd` | Hairlines, dividers |
| `--color-rule-strong` | `#343b41` | `#c9cdc7` | Emphasised borders |
| `--color-text` | `#e7e9e4` | `#15191c` | Primary text (warm off-white, not pure white) |
| `--color-dim` | `#9aa3a7` | `#525b60` | Secondary text |
| `--color-faint` | `#646d72` | `#8a9296` | Tertiary / hints |

### Semantic palette — one hue, one meaning

| Token | Dark | Light | Meaning |
| --- | --- | --- | --- |
| `--color-frontend` | `#7aa7ff` | `#2f6fdf` | Frontend (also the focus-ring colour) |
| `--color-api` | `#58d68d` | `#1f9d5a` | API routes |
| `--color-service` | `#f5a25d` | `#c96a14` | Services |
| `--color-ai` | `#b79bff` | `#7a52e0` | AI components |
| `--color-data` | `#47c9d6` | `#0f8f9c` | Data stores and models |
| `--color-external` | `#e9c46a` | `#a87f0a` | External services |
| `--color-utility` | `#8b959a` | `#6a7378` | Utilities |
| `--color-broken` | `#ff6b6b` | `#d93c3c` | Broken reference (e.g. a `fetch` no route serves) |

### Change palette

| Token | Dark | Light | Meaning |
| --- | --- | --- | --- |
| `--color-new` | `#58d68d` | `#1f9d5a` | Created — green halo, `+` badge |
| `--color-modified` | `#e9c46a` | `#b78a06` | Edited — `~` badge, pulse |
| `--color-removed` | `#ff6b6b` | `#d93c3c` | Removed — `−` badge, sinks in 3D |

### Colour rules

1. **A hue is a claim.** Never use a semantic colour for a non-semantic purpose; never use grey for something that has a category.
2. Category colour binds through one variable: `.cat-*` sets `--c`, and components consume `--c`. New node types pick a category, not a colour.
3. Derive states with `color-mix(in oklab, …)` against existing tokens rather than adding hex values — as edges do (`--edge` at 22% of text in 2D, 34% in 3D; `--edge-hot` at 80% / 90%).
4. Light mode is a token override on `:root`, not a separate stylesheet. Any new colour must be defined in both schemes.
5. Never encode meaning in colour alone. Change state also carries a `+` / `~` / `−` badge; edge semantics also carry dash patterns.

## 3. Typography

| Token | Family | Use |
| --- | --- | --- |
| `--font-sans` | **Archivo Variable** (bundled) | All UI text |
| `--font-mono` | **Fragment Mono** (bundled) | Paths, routes, line numbers, code previews |

Both are bundled through `@fontsource*` packages. **No webfont may be fetched at runtime** — it would break the no-network promise.

- **Base size is 13px.** This is an instrument, not a document: the scale runs down from 13px to 11px (labels), 10px (sublabels, meta), and 9.5–8.5px (node sublabels, lane ruler, tape). 20px is used for the single largest heading.
- Archivo's variable width axis carries emphasis instead of extra weights: `.wide` = `font-stretch: 125%` for lane names and labels that need presence; `.condensed` = `87.5%` where a long identifier must fit.
- Anything that is a real identifier in the user's repo — file path, route, symbol, line — is monospace. Prose is sans. This distinction is load-bearing: it tells the user what is *their code* and what is *Eyrie's chrome*.
- `-webkit-font-smoothing: antialiased` and `text-rendering: optimizeLegibility` are on globally, because almost all type is small.

## 4. Layout

A fixed full-height shell; the canvas takes all remaining space.

```text
┌──────────────────────────────────────────────┐
│ TopBar                                       │  repo · lenses · search · filters · fit
├──────────────────────────────────────────┬───┤
│ Lane ruler                               │   │  UI │ Edge │ API │ Logic │ Data │ External
│                                          │ P │
│ Canvas (2D map or 3D city)               │ a │  pans, zooms, owns the space
│                                          │ n │
├──────────────────────────────────────────┴───┤
│ Change tape                                  │  one tick per save
└──────────────────────────────────────────────┘
```

- **The lane grid is the layout.** Components are ordered left to right in the order a request travels: UI → Edge → API → Logic → Data → External. The ruler names the lanes and points to lanes that are off-screen. Lane order is product vocabulary and must not be re-ordered for visual balance.
- **Node width is one number, 184px**, declared twice on purpose: `NODE_W` in `graph/layout.ts` for the ELK layout, and `--w` on `.block3d` for the city view (alongside `--d: 52px`, the block's floor depth). Uniform width is what makes lanes read as columns — change it in both places or not at all.
- **Radii are small and purposeful:** 2px for badges/ticks, 7px for nodes, 12–14px for panels and overlays, 50% for dots. Nothing is pill-shaped.
- **Chrome is thin.** Panels and bars are separated by 1px `--color-rule` hairlines, not shadows. `--shadow` exists but is used sparingly (and is lighter in light mode).
- The panel overlays the canvas rather than resizing it, so the map does not reflow when a component is selected.

## 5. Components

| Component | Rules |
| --- | --- |
| **Node (2D)** | Fixed width `--w`, 7px radius, `--color-ink-2` surface, 1px border in the category colour. Label (sans, may be `.condensed`) over sublabel (mono, 8.5–10px) carrying route or path |
| **Block (3D)** | Same identity as its 2D node; **height encodes lines of code** and is never used for anything else. Lives in its lane's district on the perspective floor |
| **Edge** | Solid = call; dashed = HTTP (crosses a network boundary); cyan = data read/write. Base `--edge`, highlighted `--edge-hot`. Data-flow reads point *out of the store*, so arrows follow the data rather than the dependency |
| **Lane ruler** | Lane names in `.wide` small caps-ish type; a coloured dot marks an off-screen change and is clickable |
| **Top bar** | Repo identity, four lens buttons (titled with their shortcut, e.g. `Architecture (1)`), search entry, category filters, fit. Every control states its shortcut in its `title` |
| **Search** | Opens on `⌘K` or `/`; `Enter` takes the first result; `Esc` closes. `/` must be ignored while the user is typing in a field |
| **Details panel** | Fixed sections in a fixed order: purpose → source (with preview and *Open in editor*) → calls → used by → symbols → trace/impact. Order is stable so the eye learns it |
| **Change tape** | One tick per save: height = change magnitude, colour = change type. Hover highlights what it touched; click jumps there. Ticks animate in with `tick-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1)` |
| **Badges** | `+` new, `~` edited, `−` removed, in the change palette, 2px radius |

## 6. Motion

Motion in Eyrie is **reporting**, not decoration: it exists so a change that happened off-screen or in one frame is still perceivable.

| Event | Motion |
| --- | --- |
| New component | Green halo + `+`; in 3D the block drops in and bounces off the floor |
| Edited component | Yellow `~` + pulse; in 3D the block's height bounces |
| Removed component | Red `−`; in 3D the block sinks into the ground |
| Entering 3D | The flat map tilts into perspective, blocks rise lane by lane, tracks draw in |
| Trace | Flow animates along the downstream path |
| New tick | `tick-in`, 420ms, `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| State changes | 160–200ms `ease` on stroke, fill and opacity |

Rules: nothing loops; nothing animates on first paint except the deliberate 3D entrance; **layout never animates for unchanged components** — stable position is the point.

**Reduced motion is honoured in both layers.** `@media (prefers-reduced-motion: reduce)` disables transitions in CSS, and the JS checks `matchMedia('(prefers-reduced-motion: reduce)')` (`graph/effects.ts`, `graph/canvas.ts`) so programmatic animation is skipped too. Any new animation must check the same flag — the end state must be reached either way.

## 7. Imagery and icons

- No photography, no illustration, no stock imagery. The graph is the image.
- Icons: `lucide-react` only, at the small end of the scale, always beside a label or carrying a `title`. Never an icon-only control without an accessible name.
- No logos of detected third-party providers; an external service is named in text and coloured `--color-external`.

## 8. Responsive behaviour

Eyrie targets a developer at a desktop or laptop; there is no mobile layout and no phone support claim.

- The canvas absorbs all available space; the shell is `height: 100%` with no page scroll.
- Narrower viewport ⇒ fewer lanes visible, not smaller nodes. The lane ruler's off-screen indicators are the responsive mechanism.
- `F` (fit) is the universal escape hatch at any size.
- Pointer input is unified: `touch-action: none` on the canvas, so trackpad and touch pan/zoom behave identically.

## 9. Accessibility

| Requirement | Implementation |
| --- | --- |
| Visible focus | Global `:focus-visible` → 2px solid `--color-frontend`, 2px offset. Never remove it |
| Keyboard parity | Every pointer action has a key: lenses `1`–`4`, view `V`, fit `F`, search `⌘K` / `/`, clear `Esc`, 3D camera `Q`/`E`/`T`/`R` |
| Reduced motion | Honoured in CSS and JS, as above |
| Contrast | Measured, not assumed — see the table in [07 §11](../07-launch-readiness/README.md#11-check-readability-contrast-and-resizing). `--color-text` ≥ 13.7:1 and `--color-dim` ≥ 6.3:1 in both schemes; every category colour clears 3:1 as a border/graphic. **`--color-faint` does not reach 4.5:1 in either scheme (3.18–3.61 dark, 2.89–3.17 light) and is used as 9.5–10px text** — open fix. Any new token must be measured in **both** schemes |
| Not colour alone | Change state carries badges; edge kind carries dash pattern as well as colour |
| Selection visibility | `::selection` uses `color-mix(in oklab, var(--color-frontend) 35%, transparent)` so selected text stays readable |
| Named controls | Controls carry `title` text including their shortcut, or an `aria-label` |
| Focusable graph nodes | Nodes are real controls, not decoration: `tabindex="0"`, `role="button"`, `aria-label` of `"<label>, <kind>"`, and `Enter`/`Space` to select — in **both** the 2D canvas (`graph/canvas.ts`) and the 3D city (`graph3d/scene3d.ts`) |
| Landmarks and live regions | Map SVG is `role="application"` with a label; the sequence view is a `role="list"` of `listitem`s; the change tape is a labelled `footer` with `aria-live="polite"`; view and highlight toggles are labelled `radiogroup`s; the details panel is labelled by its component |

**Known gaps to close**, in priority order:

1. **`--color-faint` as text fails AA** at the sizes it is used (9.5–10px: `.seq-order`, `.seq-verb`, `.seq-note`, `.seq-site.muted`, lane-ruler meta). Either darken/lighten the token or stop using it for text.
2. **Never actually tested with a screen reader.** The names and roles above are correct in markup but unverified with VoiceOver or NVDA.
3. **`role="application"` on the map is a deliberate trade** — it hands keystrokes to our handlers and suppresses browse mode. Confirm it is the right call, since it means a screen-reader user navigates the graph only by tab order.
4. **Relationships are visual only.** A node's accessible name carries label and kind, not what it calls or what uses it; the details panel is the only non-visual route to that.
5. **Type is sized in `px`, not `rem`** (57 `px` values to 10 `rem` in `styles.css`), so a user's browser font-size preference does not scale the UI. Browser zoom does work.

## 10. Extending the system

Before adding anything visual, in order:

1. Can an existing token express it? Use it.
2. Does it need a new *meaning*? Add a category, then a token in **both** schemes — never a one-off hex.
3. Does it need motion? Only if it reports a real change, and only with the reduced-motion check.
4. Does it introduce a font, image or asset from the network? Then it is not acceptable — bundle it or drop it.

## Completion checklist

- [x] Visual direction and tone are stated.
- [x] Colour, typography, spacing and component rules are defined, with real token values.
- [x] Layout reference exists for the single screen.
- [x] Responsive scope is explicit (desktop-first, no mobile claim).
- [x] Accessible behaviour is specified, including reduced motion and focus.
- [ ] Open: keyboard/screen-reader traversal of graph nodes themselves.
