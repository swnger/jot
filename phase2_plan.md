# Phase 2 Implementation Plan — Inline Diffs & Permanent Chat Panel

## Goal

Replace the modal-based AI panel with a permanent toggleable chat sidebar, and move proposal review into contextual inline diffs shown in the markdown preview.

This revision incorporates the findings from `phase2_plan_review.md` and updates the implementation plan to match the current codebase more closely.

---

## Current State (Phase 1)

| Component | Location | Current behavior |
|---|---|---|
| AI toggle button | `public/app.js` — `aiButton` in topbar | Opens a full-screen modal containing the AI panel |
| AI panel | `public/app.js` — `renderAiPanel()` | Modal with conversation turns, live streaming, proposal cards, and prompt form |
| Proposal review | `public/app.js` — `renderAiProposal()` | Proposal cards live inside the AI panel; accept/reject is proposal-level |
| Proposal anchor validation | `src/ai.ts` — `resolveProposalAnchor()` | Server validates proposal hunks against raw markdown |
| Comment anchor resolution | `public/app.js` — `locateAnchor()` / `collectTextNodes()` | Client resolves comment anchors against rendered preview text nodes |
| Layouts | `public/app.js` — `renderEditorLayout()`, `renderPublicLayout()`, `renderPublicEditorLayout()` | Owner/shared editor use `.workspace`; public view does not |
| Responsive breakpoint | `public/styles.css` | Narrow-screen mode already switches at `980px` |
| AI permissions | `src/server.ts` — `buildAiPermissions()` | Owners and identified shared editors can prompt/manage/live view; shared view/comment users cannot |

---

## Target State

### 1. Permanent Chat Sidebar

- The AI panel becomes a persistent sidebar shell that is always rendered in the DOM.
- On desktop:
  - owner editor and shared editor layouts mount the sidebar as a third child of `.workspace`
  - public view/comment pages mount the sidebar as a page-level overlay attached to the app shell, because that layout does not use `.workspace`
- The closed desktop state uses layout width, not transforms:
  - closed: `width: 0; overflow: hidden`
  - open: `width: 380px`
  - transition: `width 220ms ease`
- On screens `980px` and below, the sidebar becomes a right-side overlay and no longer consumes layout width.
- The sidebar contains:
  - conversation turns
  - live run / streaming state when the viewer has permission
  - prompt composer when the viewer has permission
  - no embedded proposal cards
- Shortcut: `Cmd+Shift+L` on macOS / `Ctrl+Shift+L` elsewhere.
- The shortcut must not fire while focus is inside `input`, `textarea`, or `[contenteditable]`, or while IME composition is active.

### 2. Inline Diff Architecture

- Proposals are reviewed in context inside the preview, but the mounting model is overlay-based rather than DOM-insertion-based.
- The preview gets two distinct layers:
  - `#anchorTextRoot`: rendered markdown content used for text mapping, comment anchors, and selection logic
  - `#proposalLayer`: separate overlay layer for AI proposal UI
- Proposal anchoring remains server-authoritative:
  - proposal validity is still decided by `resolveProposalAnchor()` against raw markdown
  - the server also returns per-hunk display metadata for preview rendering
  - the client only maps server-provided rendered-text offsets into DOM ranges
- The reusable part of the current comment system is `collectTextNodes()` plus offset-to-range mapping. The client does not re-run proposal matching logic against rendered HTML.

### 3. Proposal Review Semantics

- Proposal actions remain proposal-level, matching the existing API.
- A multi-hunk proposal can render as multiple preview blocks, but all blocks share the same proposal ID and act as one review unit.
- Triggering Accept / Reject / Revise from any block applies to the whole proposal.
- Open proposals show review controls where permitted.
- Stale proposals:
  - do not show Accept
  - keep Reject as the cleanup action
  - may offer Revise when the viewer can prompt
- Ambiguous or not-inline-renderable proposals show a non-accepting fallback state rather than allowing the client to guess placement.

### 4. Permissions Matrix

| Capability | Owner | Shared editor with commenter identity | Shared view/comment user |
|---|---|---|---|
| Open sidebar and read past turns | ✅ | ✅ | ✅ |
| See inline diff blocks | ✅ | ✅ | ✅ |
| See live streaming state | ✅ | ✅ | ❌ |
| Send prompts | ✅ | ✅ | ❌ |
| Reset conversation | ✅ | ✅ | ❌ |
| Accept/reject proposals | ✅ | ✅ | ❌ |
| Revise via AI prompt | ✅ | ✅ | ❌ |

Read-only users can see pending AI proposals in context, but they do not get prompt or proposal action controls.

---

## Implementation Steps

### Step 1 — Add a server-authoritative proposal display contract

**Files:** `src/ai.ts`

1. Keep `resolveProposalAnchor()` as the source of truth for markdown-level proposal validity.
2. Extend AI serialization so each proposal hunk includes display metadata for preview rendering, for example:
   - `display.state`: `resolved | stale | ambiguous | not-inline-renderable`
   - `display.renderedStart` / `display.renderedEnd` when safely resolvable
   - `display.reason` for stale or fallback cases
3. Recompute proposal display metadata whenever note content changes in `markNoteContentChanged()`, not only at accept time.
4. Keep ambiguity handling server-side. Do not reproduce the `resolveProposalAnchor()` scoring model in the browser.
5. If a proposal cannot be mapped safely into rendered preview text, return explicit fallback state instead of asking the client to infer placement.

### Step 2 — Split layout work by page mode

**Files:** `public/app.js`, `public/styles.css`

1. Update the plan and implementation to treat layouts separately:
   - owner editor: `.workspace` becomes editor + preview + AI sidebar
   - shared editor: same as owner editor
   - public view/comment page: sidebar mounts outside `.workspace` as an app-shell overlay
2. Convert `.workspace` from a two-column grid to a flex layout for editor-capable pages.
3. Keep public view layout structurally separate instead of pretending all three templates share the same container model.

### Step 3 — Migrate from modal AI panel to sidebar incrementally

**Files:** `public/app.js`, `public/styles.css`

1. First extract reusable turn/composer/live-run rendering helpers from `renderAiPanel()` without deleting the modal path yet.
2. Build `renderAiSidebar()` on top of those shared pieces.
3. Add dedicated sidebar containers to the relevant layouts.
4. Rename `state.aiPanelOpen` to `state.aiSidebarOpen`.
5. Switch the topbar AI button and keyboard shortcut to toggle the sidebar.
6. Desktop open/closed behavior:
   - open: sidebar width participates in layout
   - closed: width collapses to `0`
7. Mobile/narrow behavior at `980px` and below:
   - sidebar becomes a full-height right-side overlay
   - it no longer consumes workspace width
8. After the sidebar path is working, remove modal-only AI wiring and CSS.

### Step 4 — Introduce a dedicated preview text root and proposal layer

**Files:** `public/app.js`, `public/styles.css`

1. Refactor preview markup so rendered markdown lives in a dedicated text root, for example:
   ```html
   <div class="preview-canvas" id="previewCanvas">
     <div class="preview-content markdown-body" id="anchorTextRoot"></div>
     <div class="highlight-layer" id="highlightLayer"></div>
     <div class="proposal-layer" id="proposalLayer"></div>
     ...
   </div>
   ```
2. Update `setPreviewHtml()` and related preview references to target `#anchorTextRoot` instead of treating the whole preview subtree as anchorable text.
3. Scope `collectTextNodes()`, `locateAnchor()`, selection comments, and related mapping logic to the text root only.
4. Configure proposal layer interaction:
   - layer default: `pointer-events: none`
   - actionable proposal controls: `pointer-events: auto`
5. Guard preview click handling so interactions inside the proposal layer do not fall through into thread-rail or comment-selection behavior.

### Step 5 — Render proposals from server-provided display ranges

**Files:** `public/app.js`, `public/styles.css`

1. Add `renderProposalDiffs()` as a post-render pass for preview updates and AI state updates.
2. For each proposal hunk:
   - if `display.state === "resolved"`, map `renderedStart` / `renderedEnd` through `collectTextNodes()` into a DOM range
   - derive an anchor rect or block rect from that range
   - mount a proposal card in `#proposalLayer` positioned beside the target content
3. Proposal cards show:
   - proposal summary
   - shared grouping cues for multi-hunk proposals, for example `Part 1 of 3`
   - original text
   - proposed text
   - status badge
4. Fallback states:
   - `stale`: warning plus Reject, and Revise if permitted
   - `ambiguous` / `not-inline-renderable`: warning card without Accept, anchored to a safe fallback location in the preview shell
5. Multiple proposals can appear simultaneously. Overlapping cards should stack cleanly and remain distinguishable by shared accent color or ID cue.

### Step 6 — Define render lifecycle and async safety explicitly

**Files:** `public/app.js`

1. Formalize the preview render pipeline:
   1. replace preview HTML
   2. await Mermaid or other layout-affecting post-processing
   3. rebuild comment highlights / thread rail
   4. clear and rebuild proposal overlay UI
   5. restore any necessary scroll or focus state
2. Run the same pipeline after:
   - markdown preview refresh
   - AI state updates
   - proposal accept/reject responses
3. Add a render-generation token so stale async work cannot mount obsolete proposal overlays after a newer render has already completed.

### Step 7 — Wire proposal actions with proposal-level semantics

**Files:** `public/app.js`

1. Keep Accept / Reject / Revise wired to the existing proposal-level APIs.
2. Use event delegation on `#proposalLayer`.
3. When any proposal block is accepted or rejected, remove or update all blocks for that proposal together.
4. Revise behavior:
   - opens the sidebar if needed
   - seeds the prompt composer with a refresh request for the whole proposal
5. Read-only users see proposal state but no action controls.

### Step 8 — Update AI instructions and success copy

**Files:** `src/ai.ts`

1. Update the proposal tool success result at the existing concrete string location:
   - change `Created proposal ${proposalId}. Tell collaborators to review it in the AI panel.`
   - to inline-diff wording that points collaborators to the preview
2. Update `buildSystemInstructions()` so the model explains that proposals are reviewed as inline diffs in the preview.
3. Update `buildPrompt()` so assistant responses refer to inline preview review rather than the AI panel.

### Step 9 — Remove modal-only AI code after the sidebar path is stable

**Files:** `public/app.js`, `public/styles.css`

1. Remove `renderAiProposal()` from the sidebar path.
2. Remove proposal-card rendering from conversation turns.
3. Remove `renderAiPanel()` and modal-only AI event wiring.
4. Remove obsolete `.ai-panel-*` / `.ai-proposal-*` modal styles and replace them with `.ai-sidebar-*` and `.proposal-layer-*` rules.
5. Keep `modalBackdrop` only for unrelated modal flows that still need it.

### Step 10 — Run a manual validation pass before calling the refactor complete

**Files:** none; validation step

1. Verify owner editor with sidebar open and closed.
2. Verify shared editor with identity, including prompt, streaming, accept/reject, and revise.
3. Verify shared view/comment flow with read-only proposal visibility and no management controls.
4. Verify public view/comment layout, including sidebar mounting strategy and permission gating.
5. Verify open, accepted, rejected, stale, ambiguous, and not-inline-renderable proposal states.
6. Verify multi-hunk accept removes every block for the proposal.
7. Verify overlapping proposals do not break layout or comments.
8. Verify comment anchors, selection comments, and thread interactions still work alongside proposal overlays.
9. Verify narrow-screen behavior below `980px`.
10. Verify the keyboard shortcut both inside and outside editable fields.
11. Verify streaming can continue in the sidebar while proposal diffs are visible.

---

## Files Changed Summary

| File | Change |
|---|---|
| `public/app.js` | Add sidebar rendering, split preview text root from proposal overlay layer, render inline proposal overlays, update layout templates by page mode, remove modal AI path |
| `public/styles.css` | Convert workspace/editor layouts for sidebar support, add sidebar styles, add proposal overlay styles, align narrow-screen behavior with existing `980px` breakpoint |
| `src/ai.ts` | Add server-authoritative proposal display metadata, revalidate on note changes, update proposal review copy and prompt instructions |
| `src/server.ts` | No API shape change expected unless AI serialization helpers need small wiring adjustments |

---

## Risks & Open Questions

1. **Rendered-text coordinate generation on the server:** this is the main technical risk. The plan now assumes the server can derive preview-text offsets aligned with the rendered markdown output, rather than leaving that guesswork to the client.
2. **Overlay positioning around dense content:** lists, tables, callouts, and narrow screens may need proposal-card collision handling or fallback positioning rules.
3. **Preview re-render churn:** proposal overlays must survive frequent preview refreshes without flicker or stale async mounts; the generation-token requirement is meant to address this.
4. **Public-page product scope:** the plan assumes public view/comment users can open the sidebar to read prior AI output while remaining unable to prompt, manage, or view live runs. If that product choice changes, the layout and permission plan should be updated before implementation.

---

## Estimated Effort

| Workstream | Scope |
|---|---|
| Sidebar + layout migration across page modes | Medium-Large |
| Proposal overlay architecture + rendering | Large |
| Proposal action wiring + permission-aware UI | Medium |
| AI copy updates + cleanup | Small-Medium |
| Manual validation / regression pass | Medium |

**Total: ~4–6 focused sessions.**

If we want to reduce integration risk, split implementation into two PRs:

1. Sidebar migration and modal AI removal
2. Inline proposal overlays in preview
