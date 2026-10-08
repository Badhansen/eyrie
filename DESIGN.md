---
name: Eyrie
description: A precise, live architecture atlas for understanding how code moves through a repository.
colors:
  ink-0: "#0d1012"
  ink-1: "#13171a"
  ink-2: "#191e22"
  ink-3: "#20262b"
  rule: "#252b30"
  rule-strong: "#343b41"
  text: "#e7e9e4"
  dim: "#9aa3a7"
  faint: "#899398"
  frontend: "#7aa7ff"
  api: "#58d68d"
  service: "#f5a25d"
  ai: "#b79bff"
  data: "#47c9d6"
  external: "#e9c46a"
  utility: "#8b959a"
  broken: "#ff6b6b"
  new: "#58d68d"
  modified: "#e9c46a"
  removed: "#ff6b6b"
typography:
  display:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 750
    lineHeight: 1.2
  headline:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 750
    lineHeight: 1.3
  title:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 620
    lineHeight: 1.35
  body:
    fontFamily: "Archivo Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  label:
    fontFamily: "Fragment Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "10px"
    lineHeight: 1.4
rounded:
  badge: "2px"
  node: "7px"
  panel: "12px"
  overlay: "14px"
components:
  lens-option:
    backgroundColor: "{colors.ink-3}"
    textColor: "{colors.text}"
    rounded: "4px"
    padding: "4px 10px"
    height: "32px"
  category-filter:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.text}"
    rounded: "9999px"
    padding: "0 10px"
    height: "32px"
  search-field:
    backgroundColor: "{colors.ink-0}"
    textColor: "{colors.text}"
    rounded: "6px"
    padding: "0 32px 0 32px"
    height: "32px"
  graph-node:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.node}"
    padding: "8px 10px"
    width: "184px"
  details-panel:
    backgroundColor: "{colors.ink-1}"
    textColor: "{colors.text}"
    rounded: "0px"
    padding: "20px"
---

# Design System: Eyrie

## Overview

**Creative North Star: "The Live Architecture Atlas"**

Eyrie is a precise instrument for seeing a codebase from above. Its interface is quiet and information-dense: graphite surfaces recede, thin rules organize the frame, and semantic colour marks the structure that matters. The graph itself is the image; controls and chrome stay legible without competing with it.

The map remains alive as source code changes. Motion reports those changes and helps preserve orientation; it is never ambient decoration. The visual language should feel precise, quiet, technical, alive, and trustworthy. It should not resemble a marketing dashboard, a mind-mapping toy, or a generic node editor.

**Key Characteristics:**
- A fixed, full-height instrument shell around a pannable architecture map.
- Category colours are semantic claims; each hue keeps one meaning.
- Real repository identifiers use monospace; Eyrie's prose uses Archivo.
- State changes remain legible without colour alone.

## Colors

The palette pairs graphite or cool-paper neutrals with a distinct semantic colour for each architecture category and change state. Dark is the default; light mode is a complete token override driven by `prefers-color-scheme`.

### Primary
- **Vantage Blue** (`#7aa7ff` dark, `#2f6fdf` light): Frontend category identity and the global visible focus indicator.

### Secondary
- **Signal Green** (`#58d68d` dark, `#1f9d5a` light): API category and newly added graph components.
- **Service Amber** (`#f5a25d` dark, `#c96a14` light): Service category and write-oriented data-flow edges.
- **Intelligence Lilac** (`#b79bff` dark, `#7a52e0` light): AI category.
- **Data Cyan** (`#47c9d6` dark, `#0f8f9c` light): Data category and data-flow reads.
- **External Gold** (`#e9c46a` dark, `#a87f0a` light): External category and modified state.
- **Utility Grey** (`#8b959a` dark, `#6a7378` light): Utility category.
- **Fault Red** (`#ff6b6b` dark, `#d93c3c` light): Broken references and removed state.

### Neutral
- **Graphite Zero** (`#0d1012` dark, `#f4f5f2` light): Main canvas and application background.
- **Graphite One** (`#13171a` dark, `#fbfbf9` light): Top bar and details-panel surface.
- **Graphite Two** (`#191e22` dark, `#ffffff` light): Node and raised-control surfaces.
- **Graphite Three** (`#20262b` dark, `#eceeea` light): Hover and selected-control surface.
- **Rule** (`#252b30` dark, `#dfe2dd` light): Hairline dividers and quiet borders.
- **Strong Rule** (`#343b41` dark, `#c9cdc7` light): Emphasized borders and lane structure.
- **Warm Chalk** (`#e7e9e4` dark, `#15191c` light): Main text and high-contrast graph marks.
- **Muted Alloy** (`#9aa3a7` dark, `#525b60` light): Supporting text and identifiers.
- **Faint Alloy** (`#899398` dark, `#626b70` light): Tertiary labels and hints, with sufficient contrast on the ordinary neutral surfaces in both schemes.

### Named Rules
**The One Hue, One Meaning Rule.** A category colour is never decorative or reassigned to another category. Define every new colour in both schemes and derive state tints with `color-mix(in oklab, ...)` where possible.

**The Meaning Has Two Channels Rule.** Never communicate a change or edge type with colour alone. Change state also has a `+`, `~`, or `−` badge; edge kinds use line patterns as well as colour.

## Typography

**Display Font:** Archivo Variable (with `ui-sans-serif`, `system-ui`, sans-serif fallbacks)

**Body Font:** Archivo Variable (with `ui-sans-serif`, `system-ui`, sans-serif fallbacks)

**Label/Mono Font:** Fragment Mono (with `ui-monospace`, `SF Mono`, Menlo, monospace fallbacks)

Both families are bundled locally through `@fontsource*`; the interface does not fetch fonts at runtime. Archivo carries UI prose and labels. Fragment Mono marks file paths, routes, line numbers, symbols, and other literal repository identifiers.

### Hierarchy
- **Display** (750, 20px, 1.2): The largest, rare heading in a centered connection or access state.
- **Headline** (750, 15px, about 1.3): Repository identity and compact view headings.
- **Title** (620, 13px, about 1.35): Graph-node labels and compact section content.
- **Body** (400, 13px, 1.5): Explanatory copy and normal interface text.
- **Label** (400, 10px, 1.4, uppercase where semantic): Lane names, metadata, and section labels; monospace is reserved for technical identifiers and compact metadata.

Archivo's width axis provides emphasis and fit: `.wide` uses 125% stretch for selected labels, while `.condensed` uses 87.5% for identifiers that need to fit. Keep the hierarchy compact; the graph is the primary reading surface.

### Named Rules
**The Identifier Rule.** Use monospace for literal repository data and sans serif for Eyrie's interface language. Do not blur the distinction.

## Layout

The application fills the viewport height with a compact top bar, a central canvas, an optional details panel, and a change tape. The canvas absorbs available space. Opening details overlays or occupies a fixed side panel without causing the map to reflow. On narrow screens the details panel moves to the bottom; fewer lanes fit in view rather than shrinking graph nodes.

The lane order is fixed product vocabulary: UI → Edge → API → Logic → Data → External. A lane ruler identifies off-screen lanes and changed components. The 2D node width is 184px; the 3D block uses the same width and a 52px floor depth. Fitting the 2D map never reduces scale below 0.85, preserving node-label readability while allowing the user to pan across wide maps. The 3D scene uses a 2300px perspective with its origin at 50% 32%.

Controls and dividers use compact, measured spacing: the top bar has 16px horizontal padding, the details panel uses 20px internal padding, and graph nodes use 6–13px internal offsets. The canvas owns pan and zoom; it has no page-level scroll. `F` fits the graph at any viewport size.

## Elevation & Depth

Depth is conveyed first by tonal surface shifts and thin borders, not broad drop shadows. The 2D map stays visually flat; selection adds a category-coloured outline and restrained glow. Shadows have a structural role in the 3D city, where blocks sit on a perspective floor. In light mode the city shadow is softened. Avoid adding ambient shadows to ordinary chrome.

**The Tonal-First Rule.** Use surface tone and a one-pixel rule to separate ordinary layers. Reserve shadows and glow for the 3D model or a selected graph element.

## Shapes

The form language is compact and technical. Badges and ticks use 2px corners; graph nodes and 3D block tops use 7px; panel and overlay silhouettes use 12–14px; dots are circular. Controls may use 4–6px corners, while category filters and connection-status indicators are intentionally pill-shaped. Hairline borders carry most container definition. The 3D block's 3px category accent is an intentional semantic marker shared with the 2D node identity. Do not round every surface to the same radius.

## Components

### Buttons and Segmented Controls

Controls are precise and restrained; the category colour carries graph state. Lens and trace controls form compact segmented groups with a thin rule, a subtle inset surface, and a filled selected option. Keep visible text labels on primary navigation controls where space allows. Use a visible focus ring: 2px solid Vantage Blue with 2px offset.

### Chips

Category filters are compact outlined pills with a semantic swatch, a short label, and a monospace count. Enabled filters use a quiet ink surface; disabled filters use a dashed border and an outlined swatch. Keep category names paired with colour.

### Cards / Containers

The details panel is an unshadowed `ink-1` surface with a one-pixel rule at its edge. On desktop it is 384px wide; on narrow viewports it sits at the bottom with a 68vh maximum height and a 12px top radius. Sections remain in stable order so the user can scan purpose, source, calls, dependents, and symbols.

### Inputs / Fields

Search is a 32px-high `ink-0` field with a quiet rule, a left-aligned search icon, and a trailing shortcut or result count. Focus changes the border to the stronger rule while retaining the global focus-visible outline. Keep the input label accessible even when the placeholder is visible.

### Navigation

The top bar holds repository identity, the three lens options, search, category filters, and live status. It uses a one-pixel bottom rule and `ink-1` background. On narrow screens, controls wrap beneath repository identity and category filters can scroll horizontally.

### Architecture Nodes

Nodes are the signature component and the main visual content. Each is 184px wide with a 7px radius, an `ink-2` body, a restrained category-tinted fill and border, a sans-serif component label, and a monospace path or route. Selection strengthens the category border and surface tint; broken references use a red dashed border. In the 3D city, block height encodes lines of code and has no second meaning.

### Edges and Change Tape

Edges use quiet neutral strokes by default and brighten on focus. Selecting a node in the Neighbors mode sends a single bounded sweep along its connected edges in both 2D and 3D; changing selection cancels the previous sweep. HTTP and transfer edges are dashed; data-flow reads and writes use their established semantic hues. The change tape records one tick per save; height represents change magnitude and colour represents change type. New, modified, and removed states use both colour and glyph. Motion is brief and respects reduced motion.

## Do's and Don'ts

### Do:
- **Do** preserve the UI → Edge → API → Logic → Data → External lane order.
- **Do** define colour tokens for both dark and light schemes.
- **Do** use monospace for source paths, routes, line numbers, and symbols.
- **Do** keep visible keyboard focus and honour reduced motion in CSS and JavaScript.
- **Do** use colour together with a badge, dash pattern, label, or other non-colour signal.
- **Do** preserve stable node identity and position when code outside the changed region is unchanged.

### Don't:
- **Don't** use category hues as decoration or swap their meanings.
- **Don't** add ambient movement or animate unchanged graph layout.
- **Don't** use shadows as the default separator for panels and controls.
- **Don't** shrink graph nodes to fit a narrow viewport; let the lane ruler indicate off-screen content.
- **Don't** lower tertiary text contrast below 4.5:1 on its neutral surface in either colour scheme.
