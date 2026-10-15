# Eyrie — product documentation

The build blocks that specify Eyrie, one folder each: the six planning documents, plus a completed launch-readiness review. Each document records its owner, status, last-updated date and open questions, and uses the same feature, lane and category names as the code, so they can be compared against each other and against the implementation.

| # | Build block | Answers | Status |
| --- | --- | --- | --- |
| 01 | [Product Requirements](01-product-requirements/README.md) | What should Eyrie do? | Phases 1–2 shipped, 3–4 partial |
| 02 | [Technical Requirements](02-technical-requirements/README.md) | How is it built and operated? | Describes the implemented system |
| 03 | [App Flow](03-app-flow/README.md) | What happens when a user takes an action? | Implemented flows |
| 04 | [Design Brief](04-design-brief/README.md) | How should it look and feel? | Derived from the shipped design system |
| 05 | [Backend Schema](05-backend-schema/README.md) | How is data stored, related and accessed? | Matches `SCHEMA_VERSION = '1'` |
| 06 | [Implementation Plan](06-implementation-plan/README.md) | What gets built first, and how is it verified? | Phases 1–2 done, 5–7 planned |
| 07 | [Launch Readiness](07-launch-readiness/README.md) | Is it safe and honest to put in front of real users? | **Hold** — 2 actions open (accessibility) |

## Reading order

Written and best read in the order above: requirements establish scope, the TRD and App Flow describe how that scope is met, the Design Brief and Backend Schema fix the two interfaces (human and data), the Implementation Plan sequences the rest, and the Launch Readiness review is the gate in front of real users.

If you are new to the project, start with the repository [`README.md`](../README.md) — it is the user-facing truth about what works today — then read 01 and 03.

These eight files are the product documentation. A feature too large for its build block gets one specification in a subfolder of the block that plans it — today, the [Architecture Knowledge Loop](06-implementation-plan/feature-knowledge/README.md) under 06. Research papers and other working material live outside this folder.

## Keeping these honest

These documents describe a product that is mid-roadmap, so they state what is shipped, what is partial and what is planned — and they carry the known limitations rather than hiding them. When scope, storage shapes or design tokens change, update the affected document in the same change. A document that quietly drifts is worse than no document.
