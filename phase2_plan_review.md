# Phase 2 Plan Review

Synthesized review of `phase2_plan.md` based on two independent passes using **Claude Opus 4.6** and **GPT-5.4**.

## Overall assessment

The product direction is good: replacing the modal AI panel with a persistent sidebar and moving proposal review into the preview is a sensible UX improvement.

That said, the current plan is **not implementation-ready yet**. The biggest risks are:

1. It overestimates how directly the existing comment anchor system can be reused for inline AI diffs.
2. It conflicts with the app's current layout and responsive structure in a few important places.
3. It leaves key proposal-review behaviors underspecified, especially for multi-hunk proposals and read-only users.

## High-severity findings

### 1. Proposal anchoring should be server-authoritative, not client-side DOM resolution

**Why this matters**

The plan currently treats proposal anchoring as if the client can reliably reuse the comment-anchor approach against rendered preview DOM (`phase2_plan.md:45`, `phase2_plan.md:115-126`, `phase2_plan.md:217-219`). That is the wrong boundary.

In the current implementation:

- proposal anchors are created and validated against **raw markdown** on the server in `src/ai.ts:377-417`
- comment anchors are located against **rendered preview text nodes** in `public/app.js:2106-2198`

Those are different coordinate spaces. Markdown syntax such as emphasis markers, links, code spans, tables, entities, and other rendering transforms can change the visible text shape, so a proposal range that is valid in markdown is not necessarily recoverable by re-running anchor matching against rendered HTML.

**Impact**

If the client tries to resolve proposal anchors itself in the preview, inline diff blocks can render in the wrong place, fail to render, or disagree with the server's stale/ambiguous judgment.

**Recommendation**

Reframe proposal anchoring as a **server-authoritative validation problem**, not a client-side anchor-resolution problem.

- Keep `resolveProposalAnchor()` on the server as the source of truth for proposal validity.
- Revalidate proposals when note content changes in `markNoteContentChanged()`.
- Have the AI state response return each proposal's **current display range in rendered-text coordinates** (or explicitly mark it as not safely inline-renderable).
- Limit the client to mapping those rendered-text offsets into DOM positions with `collectTextNodes()` / `offsetsToRange()`.

This avoids asking the client to guess from rendered HTML and keeps inline rendering aligned with accept-time proposal validation. The reusable part of the comment system is the final **text-offset-to-DOM-range mapping**, not preview-side anchor resolution itself.

### 2. The recommended DOM insertion strategy risks breaking existing anchor-based features

**Why this matters**

The plan recommends inserting real inline diff blocks into the preview flow (`phase2_plan.md:153-157`).

Today, anchor resolution is based on collecting all text nodes under `#previewContent` via `collectTextNodes()` in `public/app.js:2181-2198`. If AI diff blocks are inserted directly inside that subtree, their labels, button text, and diff contents become part of the text map used by:

- comment anchor resolution
- selection-based comment creation
- any future proposal resolution logic

**Impact**

Comment anchors and proposal anchors can drift or resolve incorrectly after inline diffs are mounted.

**Recommendation**

Adopt a structural long-term design instead of per-call exclusions:

- define a dedicated text-mapping root (for example `#anchorTextRoot`) that contains only rendered markdown content used for anchor/selection mapping
- scope `collectTextNodes()` and related offset resolution to that root only
- mount proposal diffs in a separate sibling overlay layer (for example `#proposalLayer`) that is absolutely positioned over preview content
- keep overlay pass-through by default (`pointer-events: none` on the layer) and enable interaction only on proposal action controls (`pointer-events: auto`)
- guard preview-canvas click handling so proposal-layer interactions do not trigger underlying anchor/thread click behavior

### 3. The sidebar visibility model is internally inconsistent

**Why this matters**

The target state says the sidebar has a fixed width and slides in/out with CSS (`phase2_plan.md:27-35`). Step 1 also suggests `.ai-sidebar { width: 380px; flex-shrink: 0; }` while hiding it with `transform: translateX(100%)` (`phase2_plan.md:72`, `phase2_plan.md:76-77`).

In a flex layout, a transformed sidebar still reserves layout width unless it is also collapsed.

**Impact**

The editor and preview may remain shrunken even when the sidebar appears "closed".

**Recommendation**

Update the plan to define a true closed state using layout width, not transforms:

- closed: `width: 0; overflow: hidden;`
- open: `width: 380px`
- animate with `transition: width ...`

Do **not** rely on `transform: translateX(...)` for the closed desktop state, because that only moves the sidebar visually and still leaves it participating in flex layout. Also ensure closed-state borders/padding do not continue reserving space.

### 4. The plan conflicts with the current layout structure

**Why this matters**

Step 2 says all three layout templates should include the sidebar inside the workspace area (`phase2_plan.md:87`).

That is not true today:

- `renderEditorLayout()` and `renderPublicEditorLayout()` use `.workspace` in `public/app.js:801-845` and `public/app.js:889-931`
- `renderPublicLayout()` does **not** use `.workspace`; it renders only a public preview stage in `public/app.js:848-886`

**Impact**

The plan understates the amount of layout-specific work required, especially for public view-only mode.

**Recommendation**

Split the layout plan into three explicit layout sections with different sidebar integration strategies:

- **owner editor**: sidebar is a third child inside the existing `.workspace` flex container, alongside `.editor-pane` and `.preview-stage`
- **shared editor**: same `.workspace`-based integration as owner editor
- **public view/comment page**: sidebar is **not** part of `.workspace`, because that layout does not use `.workspace`; mount it as a separate overlay attached to the page shell / app root

Do not describe this as one uniform template change. The plan should also state clearly whether the public view/comment page actually exposes AI/sidebar functionality for that permission level.

### 5. Responsive behavior uses the wrong breakpoint

**Why this matters**

Step 8 defines new mobile behavior below `768px` (`phase2_plan.md:196-199`).

The current app already switches into a mobile/narrow-screen layout below `980px` in `public/styles.css:685-716`.

**Impact**

The plan leaves the 768-980px range undefined and risks overlapping two incompatible responsive models.

**Recommendation**

Use the existing `980px` breakpoint as the single responsive threshold. Above `980px`, the AI sidebar participates in layout and resizes the workspace. At `980px` and below, the sidebar switches to a full-height right-side overlay and no longer consumes layout width. No additional `768px` breakpoint should be introduced.

### 6. Step 6 targets the wrong code for AI copy changes

**Why this matters**

The plan says to update `buildSystemInstructions()` and `buildPrompt()` so the model no longer tells users to review proposals in the AI panel (`phase2_plan.md:177-179`).

But the concrete string `"Tell collaborators to review it in the AI panel."` currently lives in the proposal tool success result at `src/ai.ts:828`, not in those functions.

**Impact**

Implementing Step 6 as written would miss the actual text users see.

**Recommendation**

Update the plan to list the exact copy-change locations:

- `src/ai.ts:828` — change `Created proposal ${proposalId}. Tell collaborators to review it in the AI panel.` to mention inline diffs in the preview.
- `src/ai.ts` `buildSystemInstructions()` — update the post-proposal instruction so the model tells collaborators proposals are reviewed as inline diffs in context.
- `src/ai.ts` `buildPrompt()` — add or update collaborator-review guidance so responses refer to reviewing proposals via inline diffs in the preview, not the AI panel.

## Medium-severity findings

### 7. Proposal action semantics are underspecified for multi-hunk proposals

The plan shows inline blocks per hunk with embedded Accept / Reject / Revise buttons (`phase2_plan.md:128-149`, `phase2_plan.md:167-171`).

But the current APIs are **proposal-level**, not hunk-level:

- accept in `src/server.ts:1213-1274`
- reject in `src/server.ts:1276-1294`

One proposal can contain multiple hunks in different locations.

**Recommendation**

Keep actions proposal-level.

- One proposal remains one logical review unit, even if it renders as multiple inline diff blocks.
- Each hunk can render its own block in the preview, but all blocks for that proposal should share the same proposal ID and update together.
- Triggering Accept / Reject / Revise from any one block should apply to the whole proposal and remove or update all related blocks.
- The UI should make that proposal-wide behavior explicit with grouping cues such as a shared title, shared accent color, and labels like `Part 1 of 3` or `Accept proposal` rather than hunk-level wording.

### 8. Client-side ambiguity handling is weaker than the server-side model

The plan says the client should use the same scoring as server-side proposal resolution (`phase2_plan.md:124`).

Server-side proposal resolution rejects ambiguous matches in `src/ai.ts:377-417`, including near-ties at `src/ai.ts:402-405`.

By contrast, the current preview-side `locateAnchor()` in `public/app.js:2126-2179` picks the highest-scoring match and does not apply the same ambiguity guard.

**Recommendation**

Do not re-implement proposal ambiguity handling on the client.

- Keep proposal validation and ambiguity decisions server-authoritative.
- Have the server return, for each hunk, either a resolved inline display range in rendered-text coordinates or an explicit `stale` / `ambiguous` / `not inline-renderable` state.
- Limit the client to mapping those server-provided display offsets into DOM positions with `collectTextNodes()` / `offsetsToRange()` and rendering the corresponding UI.

This keeps preview placement aligned with accept-time proposal validation and avoids asking the client to guess from rendered HTML.

### 9. Stale proposal UX conflicts with the current API

The plan says stale proposals should show a warning and "only dismiss" (`phase2_plan.md:159`).

The current model supports rejecting stale proposals, not dismissing them:

- `src/ai.ts:529-545`
- `public/app.js:1194-1233`

**Recommendation**

Keep stale proposals rejectable and remove the dismiss-only language from the plan.

- Show a clear stale warning such as "This proposal is stale — the target text has changed."
- Do not show Accept for stale proposals.
- Keep Reject as the cleanup action, matching the current API.
- If the UI also offers Revise, the plan should state that it creates a new proposal rather than reactivating the stale one.

### 10. Inline diff lifecycle during preview re-renders is not specified well enough

The plan acknowledges that diff blocks must be re-inserted after each preview render (`phase2_plan.md:218-219`), but it underestimates the difference between current comment overlays and proposed inline DOM blocks.

Preview HTML is replaced frequently by `scheduleRender()` in `public/app.js:787-797`, and `setPreviewHtml()` fully resets `#previewContent` in `public/app.js:85-89`.

**Recommendation**

Add an explicit post-render lifecycle section aligned with a separate proposal overlay layer:

1. replace preview markdown HTML
2. await Mermaid rendering and any layout-affecting post-processing
3. rebuild comment highlights / thread rail
4. clear and rebuild the proposal overlay layer from server-provided display ranges
5. restore or preserve scroll/layout stability
6. re-run the same pipeline on both preview updates and AI state updates

Also require a render-pass token or generation counter so stale async work does not mount obsolete proposal UI after a newer render has already completed. This is more robust than relying on debounce alone.

### 11. Permissions are not defined clearly enough

The plan describes the inline review experience as if the controls simply exist wherever proposals are visible (`phase2_plan.md:41-49`, `phase2_plan.md:167-171`).

Current permissions differ by viewer type in `src/server.ts:1972-1991`:

- owner: full AI permissions
- shared editor with identity: full AI permissions
- shared view/comment users: no prompt, no manage, no live view

**Recommendation**

Add a concrete permission matrix to the plan:

| Capability | Owner | Shared editor with commenter identity | Shared view/comment user |
| --- | --- | --- | --- |
| See inline diff blocks | ✅ | ✅ | ✅ |
| Accept/reject proposals | ✅ | ✅ | ❌ |
| Revise via AI prompt | ✅ | ✅ | ❌ |
| See live streaming state | ✅ | ✅ | ❌ |
| Send prompts | ✅ | ✅ | ❌ |
| Reset conversation | ✅ | ✅ | ❌ |

Also state explicitly that read-only users can see pending AI proposals in context but do not get proposal action controls.

### 12. The shortcut choice is unresolved

The plan proposes `Cmd+Shift+I` / `Ctrl+Shift+I`, then notes a Firefox conflict and suggests alternatives (`phase2_plan.md:36`, `phase2_plan.md:94`).

**Recommendation**

Pick `Cmd+Shift+L` / `Ctrl+Shift+L` as the sidebar toggle shortcut.

In a quick browser shortcut audit, it appears to avoid the major browser-reserved conflicts that affect the current `Mod+Shift+I` proposal while staying in the same shortcut family. The plan should also define guard clauses so it does not fire while focus is inside `input`, `textarea`, or `[contenteditable]`, or while IME composition is active.

## Low-severity findings

### 13. Step sequencing can be clearer

Step 2 says to remove `renderAiPanel()`, while Step 3 says to extract from it (`phase2_plan.md:85-107`).

**Recommendation**

Reword this as:

1. extract shared AI rendering/helpers from `renderAiPanel()` with no deletions yet
2. build `renderAiSidebar()` on top of those shared pieces
3. wire the sidebar into layouts alongside the old modal path
4. switch the toggle button to control the sidebar
5. remove obsolete modal-only AI code once the sidebar path is working

### 14. Effort sizing is too optimistic

The plan estimates `~2-3 focused sessions` and marks several steps as `Small` or `Trivial` (`phase2_plan.md:227-240`).

That likely understates the work. This is not just a sidebar swap; it is a multi-mode UI refactor with new rendering behavior, responsive changes, proposal-review changes, and no automated test coverage.

In particular:

- Step 1, Step 2, Step 3, and Step 8 are not really independent small tasks. They form one coupled UI migration across multiple layouts and breakpoints.
- Step 4 is correctly marked large, but its integration cost spills into Step 5 and Step 7 because review actions and cleanup depend on the new rendering model working reliably.
- The estimate does not appear to include manual validation and bug-fixing across owner/editor, shared edit, and public/comment flows.

**Recommendation**

Revise the sizing to reflect integration and QA risk. For example:

- Sidebar/layout migration (current Steps 1, 2, 3, 8): `Medium-Large`
- Inline diff rendering + review wiring (current Steps 4, 5): `Large`
- Prompt/update + cleanup (current Steps 6, 7): `Small-Medium`
- Manual validation / regression pass: explicit final step

Then update the total estimate to something closer to `4-6 focused sessions`, or explicitly split implementation into two phases / PRs:

1. sidebar migration
2. inline diff review in preview

### 15. The file summary omits validation work

The file summary in `phase2_plan.md:203-211` is fine as a code summary, but it does not mention QA despite this being a UI-heavy refactor with multiple page modes and permission states.

**Recommendation**

Add a QA section covering at least:

- owner editor with sidebar open/closed
- shared editor with identity and sidebar behavior
- shared view/comment flow per final permissions matrix
- public view/comment flow per final permissions matrix
- open / accepted / rejected / stale proposals
- accept a multi-hunk proposal and confirm all blocks disappear
- overlapping proposals visible together without breaking layout
- comment threads and selection comments coexisting with proposal diffs
- narrow screen (`<980px`) sidebar overlay behavior
- keyboard shortcut inside and outside text inputs
- live streaming in the sidebar while diffs are visible
- accepting/rejecting one proposal while another run is streaming

## Recommended plan revisions before implementation

1. **Rewrite the anchoring section** to distinguish markdown-based proposal anchors from rendered-preview comment anchors.
2. **Adopt a structural diff mounting architecture**: dedicated text-mapping root + separate proposal overlay layer, with explicit pointer-event and click-propagation guards.
3. **Split layout work by page mode** instead of treating all templates the same.
4. **Align responsive rules with the existing 980px breakpoint** or explicitly redefine the full breakpoint strategy.
5. **Clarify proposal-level vs hunk-level review semantics**.
6. **Define the permissions matrix** for viewing and acting on proposals.
7. **Fix Step 6** so it updates the actual AI-panel review copy in `src/ai.ts:828`.
8. **Add a QA checklist** before implementation begins.

## Bottom line

The plan is directionally strong, but it currently mixes:

- a sound UX goal,
- an incomplete anchoring model,
- a few incorrect implementation assumptions,
- and several important open behaviors.

If those issues are corrected first, the implementation will be much less likely to stall or require rework midway through the refactor.
