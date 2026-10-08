# 07 — Launch Readiness Review

| Field | Value |
| --- | --- |
| Product | Eyrie — local-first live architecture map for codebases |
| Owner / reviewer | Badhan Sen |
| Status | **Hold** — not ready for public launch; 8 actions open |
| Review date | 2026-10-08 |
| Answers | Is this safe and honest to put in front of real users? |
| Basis | A 20-point pre-launch review across policies, data and privacy, accessibility, claims and ownership, and third-party services |

> **This is a practical pre-launch review, not legal advice.** Laws vary by business, users, location, data practices and industry. Completing this review does not certify compliance; items marked *Needs specialist review* need a qualified adviser. The 20 points are review prompts, not universal legal requirements — the jurisdictions and sector rules that apply to Eyrie are themselves an open question (item 1).

## Project details

| Field | Details |
| --- | --- |
| Product | Eyrie, a developer tool run locally from the command line |
| Business or operator | **Undecided** — currently a personal open-source project with no published operator identity (action 1) |
| Planned launch date | None set |
| Business location / target users | Developers, worldwide. No jurisdiction-specific targeting |
| Intended audience and age | Professional software developers; not aimed at or appealing to children |
| Paid or regulated activity | None. No payments, no subscriptions, no regulated activity |
| Licence | GNU AGPL-3.0-only |

### What is actually being launched

This matters more than any individual item below, because it determines which items apply at all:

- **A source distribution of a locally-run tool.** The user clones the repo and runs it on their own machine against their own code.
- **No server we operate.** No accounts, no hosted instance, no database we hold, no payments.
- **No personal data collected, and no network egress at all** — verified by inspection, see item 5.

Most of these 20 points exist for a hosted commercial website. Eleven genuinely apply here; nine are not applicable today and are recorded with the reason and the trigger that would reactivate them.

---

## Policies and Customer Terms

### 1. Identify the Business and Applicable Rules

- [ ] Review completed. · **Status: Action needed**

**Finding.** No operator is identified anywhere. `README.md` describes the software but names no person or entity, gives no contact route, and the repository has no `SECURITY.md` or `CONTRIBUTING.md`. For a source-only hobby distribution this is survivable; the moment there is a landing page, a published binary, or a donation link, an unidentified operator becomes a real problem.

**Action.** Decide whether Eyrie is a personal project or a business undertaking, then publish the operator name and a working contact route in `README.md`. Revisit if a desktop build (Phase D) is ever distributed, since distributing executables changes the relationship with users.

### 2. Publish Appropriate Customer Terms

- [x] Review completed. · **Status: Not applicable today**

**Why not applicable.** No service is offered, so there is nothing to contract over. Use of the software is governed by [`../../LICENSE`](../../LICENSE) (AGPL-3.0-only), which is present in the repository and includes the warranty disclaimer and liability limitation that the GPL family carries. There is no account, no acceptance flow and no eligibility rule to state.

**Reactivates if:** a hosted demo, an account system, or any paid tier appears. At that point terms, eligibility, acceptable use and a dispute process all become necessary.

### 3. Make Pricing, Renewals and Cancellation Clear

- [x] Review completed. · **Status: Not applicable**

**Why not applicable.** Nothing is sold. There is no checkout, no trial, no recurring charge and no refund path to describe.

**Reactivates if:** any paid tier, sponsorship perk or licence sale is introduced.

### 4. Provide Support and Complaint Routes

- [ ] Review completed. · **Status: Action needed**

**Finding.** There is no published support route, issue-reporting route, or complaint route. `README.md` ends at licensing. A tool that opens a local HTTP server and reads source files needs a route for reporting problems — particularly security problems — even with no commercial relationship.

**Action.** Publish a support route (issue tracker link at minimum) and a security-reporting route in `SECURITY.md`, with the owner named. This single action also closes items 8 and 12.

---

## Data and Privacy

### 5. Map the Personal Data You Handle

- [x] Review completed. · **Status: Pass**

**Finding — verified by inspection, not assumed.** No personal data is collected and nothing leaves the machine.

| Checked | Result |
| --- | --- |
| Outbound HTTP in any package | None. The only `node:http` use is `createServer` (inbound); `ws` is a `WebSocketServer` (inbound). The strings `axios`/`ky`/`got` in `graph/code-graph.ts` are **detection vocabulary** for parsing the user's code, not clients Eyrie uses |
| Browser network calls | Only relative first-party paths: `fetch('/api/state')` and `fetch(path)` in `state/store.ts` — same local origin |
| Webfonts | Bundled via `@fontsource*`; no CDN request |
| Analytics / telemetry / error reporting / update check | None present |
| Child-process execution | `spawn` only, to launch the user's editor on an indexed path |

**Data inventory.** One local store: `~/.eyrie/repos/<hash>/graph.db` (`EYRIE_HOME` overrides). Contents are analysis derived from the user's own repository — file paths, symbol names, graph nodes/edges and cached parse facts. It is disposable and rebuildable; see [Backend Schema](../05-backend-schema/README.md). The only field that could incidentally contain a personal identifier is `repositories.root_path`, which holds an absolute filesystem path (often containing a username) — it never leaves the user's machine and sits under their home directory with OS permissions.

**Note for Phase 5.** The moment AI arrives, "data sent to AI services" becomes a live question. The current plan is local models (Ollama) first, which keeps this item at Pass. A remote model would move it to Action needed and would require rewording the privacy claims, not just adding a toggle.

### 6. Publish an Accurate Privacy Notice

- [ ] Review completed. · **Status: Action needed (proportionate)**

**Finding.** There is no privacy notice. `README.md` has a "Privacy and security" section that accurately describes behaviour (local only, no network requests, bound to `127.0.0.1`, token required, source endpoint index-only, cache location). For a locally-run tool collecting nothing, that is close to proportionate — but it is framed as a feature list, not as a statement of what is and is not collected.

**Action.** Add a short, explicit statement — "Eyrie collects no personal data and makes no network requests; the only data stored is a local analysis cache at `~/.eyrie`, which you can delete at any time" — to `README.md`. A full notice becomes necessary only if a website or distributed binary appears.

### 7. Set Retention and Deletion Rules

- [x] Review completed. · **Status: Pass**

**Finding.** Documented and implemented. Retention is indefinite but the store is explicitly disposable; deletion is `rm -rf ~/.eyrie/repos/<hash>/` or `--reset` to ignore and rebuild. Removed files are dropped from `files` on the next scan and their nodes/edges removed by the diff. **No backups are taken, by design** — everything is derivable from the repository, which Eyrie never writes to. Fully specified in [Backend Schema §9](../05-backend-schema/README.md).

### 8. Prepare for Privacy Requests and Incidents

- [ ] Review completed. · **Status: Action needed**

**Finding.** No access/deletion request route is needed — there is no personal data held and the user already has unilateral deletion by removing a directory. But there is **no vulnerability-reporting route**, and this product has a security surface worth taking seriously: it binds a local HTTP server, serves source file contents over it, and spawns an editor process.

The existing protections are genuinely good and worth stating as the baseline an incident process would defend: random per-run token on every `/api/*` request and on the WebSocket upgrade; `127.0.0.1` bind; `Host`-header allowlist as DNS-rebinding protection; `/api/source` restricted to indexed files; `.gitignore`/`.eyrieignore` honoured so secrets are never parsed; 64 KB body cap; id pattern matching; path normalisation on static serving.

**Action.** Add `SECURITY.md` with a reporting route, an expected response time, and the named owner. Covered by action 4.

---

## Accessibility

Reference: [W3C WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/). Target set for this review: **WCAG 2.2 AA** for the web UI. The four checks below are common-issue checks, not a complete audit.

### 9. Test Keyboard Navigation and Focus

- [x] Review completed. · **Status: Pass with follow-up**

**Finding.** Keyboard support is a designed-in feature, not an afterthought. Every pointer action has a key equivalent: lenses `1`/`2`/`3`, view toggle `V`, fit `F`, search `⌘K` / `/`, clear `Esc`, and 3D camera `Q`/`E`/`T`/`R`. **Graph nodes are real controls** — `tabindex="0"`, `role="button"`, and `Enter`/`Space` activation, in both the 2D canvas (`graph/canvas.ts`) and the 3D city (`graph3d/scene3d.ts`). Sequence-view messages and source links are focusable `role="button"` elements. A global `:focus-visible` rule gives a 2px ring in `--color-frontend`, measured at **8.00:1** against the canvas in dark and **4.30:1** in light — comfortably above the 3:1 needed for a focus indicator. The `/` shortcut is correctly suppressed while the user is typing in a field.

**Follow-up (not blocking).** Confirm no keyboard trap in 3D orbit mode; confirm focus order follows lane order (left to right) rather than DOM insertion order after a live update, since nodes are appended as they are created.

### 10. Check Structure and Screen-Reader Information

- [ ] Review completed. · **Status: Action needed**

**Finding.** The markup is in better shape than most graph UIs: the map SVG carries `role="application"` with a label, graph nodes have `aria-label` of `"<label>, <kind>"`, the sequence view is a `role="list"` of `listitem`s, the change tape is a labelled `footer` with `aria-live="polite"` for status, view/highlight toggles are labelled `radiogroup`s with `aria-checked`, and the details panel is labelled by its component. No meaningful image lacks a text alternative, because there are no images.

Three real gaps:

1. **It has never been run against a screen reader.** Every statement above is about markup, not observed behaviour. This is the gap that makes the item Action needed rather than Pass.
2. **`role="application"` is a deliberate but double-edged choice.** It passes keystrokes to our handlers and suppresses browse mode, so a screen-reader user navigates the graph only by tab order. That trade should be a recorded decision, not an accident.
3. **Relationships are conveyed visually only.** A node's accessible name gives label and kind, not what it calls or what uses it. The details panel is the only non-visual route to the graph's actual content — which is the product's whole value.

**Action.** Run the primary journeys with VoiceOver and NVDA; record findings; decide explicitly on `role="application"`; consider adding call/used-by counts to node accessible names.

### 11. Check Readability, Contrast and Resizing

- [ ] Review completed. · **Status: Action needed**

**Finding — measured, not estimated.** Contrast ratios computed from the actual token values in `apps/web/src/styles.css`, with `color-mix(in oklab, …)` resolved properly for mixed values.

**Text colours** (need 4.5:1 — all UI text is below the 18.66px-bold / 24px large-text threshold):

| Token | On dark surfaces | On light surfaces | Result |
| --- | --- | --- | --- |
| `--color-text` | 13.74 – 15.61:1 | 16.16 – 17.68:1 | pass |
| `--color-dim` | 6.54 – 7.43:1 | 6.35 – 6.94:1 | pass |
| `--color-faint` | **3.18 – 3.61:1** | **2.89 – 3.17:1** | **fail** |

**Node kind labels** (8.5px, `color-mix(in oklab, var(--c) 80%, var(--color-text))` over the node body fill):

| Category | Dark | Light |
| --- | --- | --- |
| frontend | 7.11:1 | 5.62:1 |
| api | 8.50:1 | **4.46:1** (marginal fail) |
| service | 7.90:1 | 4.77:1 |
| ai | 7.31:1 | 5.95:1 |
| data | 8.12:1 | 4.85:1 |
| external | 9.14:1 | 4.64:1 |
| utility | 6.02:1 | 5.79:1 |
| broken | 6.40:1 | 5.43:1 |

**Non-text contrast** (need 3:1): every category colour used as a border or graphic clears it in both schemes (dark 6.24–11.43:1; light 3.18–4.67:1). Hairline rules (`--color-rule` at 1.19–1.33:1, `--color-rule-strong` at 1.55–1.59:1) sit far below 3:1, but they are decorative dividers rather than UI-component boundaries or state indicators, so 1.4.11 does not bite — worth a deliberate note rather than a fix, since panels do lean on them to read as separate surfaces.

**Not conveyed by colour alone** — satisfied: change state carries `+` / `~` / `−` badges as well as colour, edge kind carries dash pattern as well as colour, and a broken node is labelled "Missing route" in text.

**Resizing.** Type is sized in `px` throughout (57 `px` values to 10 `rem` in `styles.css`) and `body` is a fixed `13px`, so a user's browser font-size preference does not scale the UI. Browser zoom works. Reflow at 320px width is untested and out of scope — this is a desktop tool with no mobile claim (see [Design Brief §8](../04-design-brief/README.md)).

**Actions.** (a) Fix `--color-faint`: lighten it in dark mode and darken it in light mode until it clears 4.5:1, or stop using it for text. It is currently used at 9.5–10px for `.seq-order`, `.seq-verb`, `.seq-note`, `.seq-site.muted` and lane-ruler meta — the smallest text in the product. (b) Nudge light-mode `--color-api` to clear 4.5:1 in the kind label. (c) Decide whether to move the type scale to `rem`.

### 12. Make Forms and Media Usable

- [x] Review completed. · **Status: Pass, with one action carried from item 4**

**Finding.** There is almost no form surface: one search input, which is labelled, opens on `⌘K` / `/`, takes `Enter` for the first result and `Esc` to close, and has an empty state. There is no sign-in, no checkout, no validation to recover from, no CAPTCHA, no time limit, and no audio or video needing captions.

**Motion is properly controlled** — the one accessibility-relevant media concern here. `@media (prefers-reduced-motion: reduce)` disables transitions in CSS, *and* the JS checks `matchMedia('(prefers-reduced-motion: reduce)')` in `graph/effects.ts` and `graph/canvas.ts` so programmatic animation is skipped too. Nothing loops or autoplays.

**Action.** Publish an accessibility-problem reporting route — the same contact added for item 4. An accessibility statement becomes appropriate if a public website appears.

---

## Claims, Trust and Ownership

### 13. Verify Marketing Claims

- [x] Review completed. · **Status: Pass with one action**

**Claims register** — every material claim in `README.md`, checked:

| Claim | Verified? |
| --- | --- |
| "Everything runs locally. Eyrie makes no network requests; fonts are bundled." | **Yes** — by inspection, see item 5. The strongest claim in the README and it holds literally |
| "The server binds to `127.0.0.1`, requires a random per-run access token, and rejects requests whose `Host` header is not local" | **Yes** — all three implemented in `packages/server/src/server.ts` |
| "The source endpoint only serves files that are in the index. `.env` files, keys and anything ignored by git are never readable through it." | **Yes** — `/api/source` resolves against the index; scanning honours `.gitignore`/`.eyrieignore` |
| "50+ SDKs (OpenAI, Anthropic, …)" | **Yes** — 73 provider keys in `packages/graph/src/externals.ts` |
| "There is no AI in the pipeline today" | **Yes** — no model call anywhere |
| "A typical app reduces to 20–50 components" | **Estimate, unevidenced.** Plausible and matches the fixture and smoke repo, but no measurement is recorded |
| Known limitations section | **Accurate and unusually candid** — syntactic resolution, heuristic classification, sequence order ≠ runtime order, unjoined Express router prefixes, single-threaded parsing, TS/JS only |

No invented numbers, no unsupported guarantees, no certification claims, no comparative claims against the named related projects (they are listed neutrally).

**Action.** Either measure component counts across a handful of real repos and cite the range, or soften "a typical app" to "the repositories tested so far". This is the only claim in the README not backed by something checkable.

### 14. Check Reviews, Testimonials and Disclosures

- [x] Review completed. · **Status: Not applicable**

**Why not applicable.** No reviews, testimonials, ratings, endorsements, affiliate links or sponsored content exist anywhere in the project. The "Related projects" section names four comparable tools descriptively, claims no endorsement from them, and discloses no material relationship because none exists.

**Reactivates if:** a landing page with user quotes, a Product Hunt launch, or any affiliate or sponsorship arrangement appears.

### 15. Confirm Rights to Content, Code and Branding

- [ ] Review completed. · **Status: Action needed · one point Needs specialist review**

**Dependency licence inventory** (runtime and build, from the installed tree):

| Licence | Packages |
| --- | --- |
| MIT | `animejs`, `chokidar`, `ignore`, `json5`, `graphology`, `graphology-types`, `web-tree-sitter`, `tree-sitter-typescript`, `tree-sitter-javascript`, `ws`, `react`, `react-dom`, `tailwindcss`, `vite` |
| ISC | `lucide-react`, `d3-zoom`, `d3-selection`, `d3-transition`, `d3-interpolate` |
| BSD-3-Clause | `d3-ease` |
| **EPL-2.0 OR GPL-3.0-or-later** | `elkjs` |
| **OFL-1.1** | `@fontsource-variable/archivo`, `@fontsource/fragment-mono` |

Three findings:

1. **`elkjs` is dual-licensed EPL-2.0 or GPL-3.0-or-later.** Eyrie is AGPL-3.0-only. The combination relies on taking the **GPL-3.0-or-later option**, not the EPL one, since EPL-2.0 and the GPL family are generally treated as incompatible. The GPL option is almost certainly the right path and the licences are designed to interoperate — but the project should state which option it relies on rather than leaving it implicit. **Needs specialist review** before any distribution of a combined binary (Phase D).
2. **The two fonts are OFL-1.1 and are bundled into the built UI.** OFL requires the copyright notice and licence text to travel with the font files when redistributed. Today the repository has only `LICENSE` (AGPL) and **no `NOTICE` or `THIRD-PARTY-NOTICES` file**, so a built bundle ships the fonts without their licence. The ISC, BSD-3-Clause and MIT dependencies likewise require notice retention in distributions.
3. **No trademark clearance on the name "Eyrie."** It is a common English word, which cuts both ways: harder for others to claim exclusively, and weaker to protect.

**Clean, deliberately.** `fixtures/bookstore-app` is hand-written for this project, so no third-party code is vendored. The smoke-test target (`accretence/next-prisma-tailwind-ecommerce`, MIT) is cloned at developer request into the git-ignored `.smoke/` and never committed — `scripts/fetch-smoke-repo.sh` documents that this is specifically to avoid carrying third-party code and licence obligations. That is the right call and should not be undone.

**Actions.** Add `THIRD-PARTY-NOTICES.md` covering all of the above, with the full OFL-1.1 text and font copyright lines, and ensure it ships with any built artefact. State the `elkjs` GPL election in it. Consider trademark clearance only if the name becomes commercially important.

### 16. Explain Product Limits and AI Involvement

- [x] Review completed. · **Status: Pass**

**Finding.** This is the project's strongest area. `README.md` carries an explicit "Known limitations" section covering every material limit: syntactic resolution (missed calls through DI and dynamic dispatch), heuristic classification tuned for Next.js/Node.js, the sequence view's ordering being source-line order rather than runtime order, unjoined Express router prefixes, single-threaded parsing, and TS/JS only. The "Code graph first, visualization second, AI third" principle is stated up front, along with the commitment that AI will annotate the graph and "never invent dependencies".

No professional expertise or human review is implied. There is no user-generated content, no uploads, no publishing surface, so no moderation or content-rights rules are needed. Nothing in the product is aimed at children or at sensitive or regulated use.

**Carry forward.** When Phase 5 lands, AI involvement must be disclosed at the point of use, and the "no AI in the pipeline today" line must change in the same commit.

---

## Tracking and Third-Party Services

### 17. Inventory Tracking and Embedded Services

- [x] Review completed. · **Status: Pass**

**Tracking inventory — complete:**

| Technology | Present? | Detail |
| --- | --- | --- |
| Cookies | No | None set |
| `localStorage` | **Yes — two keys** | `eyrie-lens` (last lens) and `eyrie-view` (2D or 3D). First-party, functional UI preference, no identifier, no profiling |
| `sessionStorage` / IndexedDB | No | — |
| Analytics / pixels / ad tags | No | None |
| Chat widgets, video embeds, iframes | No | None |
| Third-party fonts, scripts, stylesheets | No | Fonts bundled; nothing loaded cross-origin |
| Indirectly installed tags | No | No tag manager, no SDK that could inject one |

Observed network behaviour is first-party only: `/api/*` over HTTP and one WebSocket, both to the local engine. No request to any external host at any point in the product's life.

### 18. Implement Applicable Consent and Opt-Out Controls

- [x] Review completed. · **Status: Not applicable**

**Why not applicable.** There is nothing in the inventory that triggers consent or opt-out duties. The two `localStorage` keys are first-party functional storage holding a UI preference the user set themselves, in a tool they run locally; there is no third party, no identifier, no tracking and no cross-site anything. No analytics exists to classify, and there is no public site on which a banner would appear.

**Reactivates if:** any analytics, crash reporting, update check or marketing site is added — at which point the classification must be done properly per jurisdiction rather than assumed, and prior consent blocking implemented where required.

### 19. Review Providers, Contracts and Transfers

- [x] Review completed. · **Status: Pass**

**Finding.** **No runtime providers at all.** There is no hosting provider, database provider, email provider, payment provider, analytics provider or AI provider, because there is no server and no network egress. Consequently there are no processing agreements to put in place, no subprocessors to assess, no cross-border transfer assessment to make, and no administrative accounts holding user data.

Developer-time dependencies only, touching no user data: the npm registry (install), GitHub (source hosting and the smoke-repo clone). Both are developer infrastructure, not product data paths.

**Carry forward.** Phase 5 (local models via Ollama) keeps this at Pass, since Ollama runs on the user's machine. Any remote model provider would make this item live and would require a vendor register, a processing agreement and a transfer assessment.

### 20. Check Marketing Messages and Preference Handling

- [x] Review completed. · **Status: Not applicable**

**Why not applicable.** There is no mailing list, no signup form, no newsletter, no in-product messaging and no promotional communication of any kind. No contact details are collected, so there is nothing to suppress or unsubscribe from and no preference state to honour.

**Reactivates if:** a waitlist, newsletter, release-announcement list or in-product notification is added.

---

## Review Log

| Item | Status | Finding or evidence | Required action | Owner | Due |
| --- | --- | --- | --- | --- | --- |
| 1 | Action needed | No operator identity or contact published | Publish operator + contact in `README.md` | Badhan Sen | Before public launch |
| 2 | Not applicable | No service offered; AGPL `LICENSE` governs use | None — revisit if hosted or paid | Badhan Sen | On scope change |
| 3 | Not applicable | Nothing is sold | None | Badhan Sen | On scope change |
| 4 | Action needed | No support or security-reporting route | Add issue route + `SECURITY.md` | Badhan Sen | Before public launch |
| 5 | **Pass** | No personal data; zero network egress verified by inspection | Re-verify at Phase 5 | Badhan Sen | At Phase 5 |
| 6 | Action needed | Behaviour described, but no explicit "we collect nothing" statement | Add one paragraph to `README.md` | Badhan Sen | Before public launch |
| 7 | **Pass** | Retention/deletion specified in Backend Schema §9; cache disposable | None | Badhan Sen | — |
| 8 | Action needed | No vulnerability-reporting route for a product that serves source locally | `SECURITY.md` (same as action 4) | Badhan Sen | Before public launch |
| 9 | Pass w/ follow-up | Full keyboard parity; nodes focusable with Enter/Space; focus ring 8.00:1 / 4.30:1 | Check 3D keyboard trap and focus order after live update | Badhan Sen | Next UI change |
| 10 | Action needed | Good roles and names, but never tested with a screen reader; relationships visual only | Run VoiceOver + NVDA; decide on `role="application"` | Badhan Sen | Before public launch |
| 11 | Action needed | `--color-faint` 2.89–3.61:1 as 9.5–10px text; light `api` kind 4.46:1 | Fix both tokens; decide on `px` → `rem` | Badhan Sen | Before public launch |
| 12 | Pass | Minimal form surface, labelled; reduced motion honoured in CSS **and** JS | Publish a11y-problem route (action 4) | Badhan Sen | Before public launch |
| 13 | Pass w/ action | Every security and privacy claim verified; "20–50 components" unevidenced | Measure or soften that one claim | Badhan Sen | Before public launch |
| 14 | Not applicable | No reviews, testimonials or endorsements | None | Badhan Sen | On scope change |
| 15 | **Action needed** + specialist | `elkjs` EPL-2.0/GPL-3.0 dual licence vs AGPL; OFL fonts bundled with no notice file | Add `THIRD-PARTY-NOTICES.md`; state GPL election; adviser to confirm before binary distribution | Badhan Sen | Before any distribution |
| 16 | **Pass** | Known limitations explicit and candid; no AI today; no UGC | Update disclosures at Phase 5 | Badhan Sen | At Phase 5 |
| 17 | **Pass** | Two first-party functional `localStorage` keys; nothing else | None | Badhan Sen | On any new dependency |
| 18 | Not applicable | Nothing present that requires consent or opt-out | None | Badhan Sen | On scope change |
| 19 | **Pass** | No runtime providers; no transfers; no processing agreements needed | Revisit at Phase 5 | Badhan Sen | At Phase 5 |
| 20 | Not applicable | No marketing messages or contact collection | None | Badhan Sen | On scope change |

**Totals:** 8 Pass (incl. 2 with follow-up actions) · 7 Action needed (1 also Needs specialist review) · 6 Not applicable, each with a stated reason and reactivation trigger.

## Launch Decision Record

**Decision: Hold.**

Not because anything here is dangerous — the privacy and security posture is genuinely strong, and better than most tools of this kind — but because a public launch would currently ship an unidentified operator, no way to report a security problem, text that fails AA contrast at the smallest sizes, and a bundle containing OFL-licensed fonts without their licence notice. All four are small, concrete fixes.

**Unresolved issues and their effect on launch**

| Blocks a public launch | Blocks distributing a binary | Does not block |
| --- | --- | --- |
| 1 — operator identity and contact | 15 — `THIRD-PARTY-NOTICES.md` and the `elkjs` licence election | 9 follow-ups — 3D keyboard trap, focus order |
| 4 / 8 — support and `SECURITY.md` | | 11c — `px` → `rem` decision |
| 6 — explicit no-collection statement | | 13 — softening the "20–50 components" estimate |
| 10 — one screen-reader pass | | |
| 11a / 11b — `--color-faint` and light `--color-api` | | |

**Specialist advice obtained:** none.
**Specialist advice still required:** item 15 — whether AGPL-3.0-only + `elkjs` under its GPL-3.0-or-later option is sound for a distributed combined artefact. Worth asking once, before Phase D, not now.

**Shortest path off Hold.** Five commits: `SECURITY.md` + contact and operator in `README.md` (closes 1, 4, 8, 12) · one paragraph on data collection (closes 6) · two token fixes (closes 11a, 11b) · `THIRD-PARTY-NOTICES.md` (closes 15's action half) · one VoiceOver pass with findings recorded (closes 10). Nothing here requires a lawyer or a redesign.

**Responsible decision-maker and date:** Badhan Sen, 2026-10-08.
**Next review date:** before any public launch, and again at Phase 5 (AI) and Phase D (desktop distribution) — the two phases that change the answers to items 5, 6, 16 and 19.

---

## Completion checklist

- [x] All 20 items reviewed with a status recorded.
- [x] Every *Not applicable* decision is explained, with the trigger that would reactivate it.
- [x] Claims are checked against the implementation rather than assumed.
- [x] Contrast is measured, with the real token values and the resolved `color-mix` results.
- [x] Dependency licences inventoried; conflicts identified.
- [x] Review log and launch decision recorded, with actions assigned and sequenced.
- [ ] Actions 1, 4, 6, 8, 10, 11, 13, 15 outstanding.
