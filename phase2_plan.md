# Phase 2 Implementation Plan — Inline Diffs & Permanent Chat Panel

## Goal

Replace the modal-based AI panel with a permanent toggleable chat sidebar, and move proposal review from the AI panel into embedded inline diffs rendered directly in the markdown preview.

---

## Current State (Phase 1)

| Component | Location | Current behavior |
|---|---|---|
| AI toggle button | `public/app.js` — `aiButton` in topbar | Opens a full-screen modal (`modalBackdrop`) containing the AI panel |
| AI panel | `public/app.js` — `renderAiPanel()` | Modal with conversation turns, live streaming, proposal cards (diff tables), and prompt form |
| Proposal review | `public/app.js` — `renderAiProposal()` | Side-by-side old/new pre blocks inside the modal. Accept/reject buttons are modal-only |
| AI state | `src/ai.ts` — `AiRuntimeManager` | Server-side: turns, proposals (hunks with anchors), active run, queued prompts |
| AI API | `src/server.ts` — `/api/…/ai/*` routes | REST endpoints for prompt, cancel, reset, proposal accept/reject |
| AI WebSocket | `src/server.ts` — broadcast functions | `ai-state-updated`, `ai-message-delta`, `ai-tool-activity` messages |
| CSS | `public/styles.css` — `.ai-panel-*`, `.ai-proposal-*` | Modal-based layout, ~180 lines of AI-specific CSS |

---

## Target State

### 1. Permanent Chat Sidebar

- The chat panel is a **sidebar** (`<aside class="ai-sidebar">`) pinned to the right edge of the viewport, always rendered in the DOM.
- A toggle button in the topbar controls visibility via a CSS class (`ai-sidebar-open`) on the app root.
- The sidebar contains:
  - Conversation turns (scrollable)
  - Active run with streaming content and tool activity
  - Prompt input at the bottom
  - **No proposal cards** — proposals are shown inline in the preview
- The sidebar has a fixed width (e.g. 380px) and slides in/out with a CSS transition.
- The editor/preview area shrinks to accommodate the open sidebar (flex or grid adjustment).
- Keyboard shortcut: `Cmd+Shift+I` (Mac) / `Ctrl+Shift+I` (others) toggles the sidebar. This mirrors VS Code's Copilot Chat toggle, making it familiar for users. The shortcut is registered as a `keydown` listener on `document` and calls the same toggle logic as the topbar button.

### 2. Embedded Inline Diffs in Preview

- When the AI creates a proposal, its hunks are rendered as **inline diff blocks** in the markdown preview pane, overlaid at the correct position.
- Each diff block shows:
  - Struck-through original text (red/deletion styling)
  - Proposed replacement text below (green/addition styling)
  - A summary label and action buttons (Accept / Reject / Revise) embedded in the block
- Diff blocks are positioned by matching the `anchor` data (quote, prefix, suffix, start, end) to DOM text nodes in the rendered preview — similar to how comment highlights are positioned today.
- Multiple open proposals can be visible simultaneously, each with a distinct visual treatment (e.g. numbered or color-coded).
- When a proposal is accepted or rejected, the diff block is removed and the preview re-renders.
- Stale proposals show a warning indicator instead of the diff.

---

## Implementation Steps

### Step 1 — Restructure layout to support sidebar

**Files:** `public/styles.css`, `public/app.js` (layout templates)

1. Change `.workspace` from `grid-template-columns: 1fr 1fr` to a flex layout (or add a third column) that can accommodate the sidebar:
   ```
   .app-root {
     display: flex;
     flex-direction: column;
     height: 100vh;
   }
   .workspace {
     display: flex;
     flex: 1;
     overflow: hidden;
   }
   .editor-pane { flex: 1; min-width: 0; }
   .preview-stage { flex: 1; min-width: 0; }
   .ai-sidebar { width: 380px; flex-shrink: 0; ... }
   ```
2. Add `.ai-sidebar` styles:
   - Fixed width, full height below topbar, border-left, flex column layout
   - Hidden by default (`transform: translateX(100%)` or `display: none`)
   - `.ai-sidebar-open .ai-sidebar` reveals it
3. Add a smooth CSS transition for the sidebar toggle.
4. Adjust mobile responsive rules: on narrow screens, sidebar overlays instead of pushing content.

### Step 2 — Move AI panel from modal to sidebar

**Files:** `public/app.js`, `public/styles.css`

1. Remove the `renderAiPanel()` function that populates `modalBackdrop`.
2. Add a new `renderAiSidebar()` function that renders into a dedicated `#aiSidebar` element that is part of the layout HTML (not the modal).
3. Update all three layout templates (`renderEditorLayout`, `renderPublicLayout`, `renderPublicEditorLayout`) to include `<aside class="ai-sidebar" id="aiSidebar">` inside the workspace area.
4. Change `openAiPanel()` to toggle the sidebar:
   - Add/remove `.ai-sidebar-open` on the app root
   - Call `renderAiSidebar()` to populate content
5. Remove the modal-based AI rendering from `closeModal()` — the AI sidebar has its own close button.
6. Remove all `.ai-panel-modal` CSS rules. Add `.ai-sidebar` rules.
7. Keep `state.aiPanelOpen` (rename to `state.aiSidebarOpen`) for tracking toggle state.
8. Register a global `keydown` listener for `Cmd+Shift+I` / `Ctrl+Shift+I` that toggles `state.aiSidebarOpen` and calls the same toggle logic as the topbar button. Prevent default to avoid opening browser DevTools in some browsers (note: Chrome uses `Cmd+Option+I` for DevTools, so `Cmd+Shift+I` is safe; Firefox uses `Cmd+Shift+I` for DevTools — consider `Cmd+Shift+J` as an alternative, or accept the minor Firefox conflict and document it).

### Step 3 — Add sidebar content rendering

**Files:** `public/app.js`, `public/styles.css`

1. Extract conversation rendering from the old `renderAiPanel()` into `renderAiSidebar()`:
   - Header: "Jot AI" title, close button, refresh, reset
   - Scrollable conversation area with `renderAiTurn()` (reuse existing, stripped of proposal cards)
   - Active run / streaming section
   - Footer: prompt textarea + send/cancel buttons
2. Each turn shows author, timestamp, content. Assistant turns show tool activity.
3. **Remove proposal rendering from turns** — turns no longer embed proposal diffs. Instead, show a brief note like _" Proposed 2 changes — see inline diff in preview"_.
4. Add CSS for the sidebar layout (flex column, conversation scrolling, sticky footer).

### Step 4 — Render inline diff blocks in preview

**Files:** `public/app.js`, `public/styles.css`

This is the core new feature.

1. **Data model in frontend state:**
   - `state.ai.proposals` already contains proposals with `hunks[].anchor` (quote, prefix, suffix, start, end).
   - No changes needed to the data model.

2. **Anchoring approach — reuse comment highlight pattern:**
   - The existing comment system already positions overlays on the preview using text range matching. Follow the same approach.
   - Add a new `renderProposalDiffs()` function called after every preview render and AI state update.
   - For each open proposal, for each hunk:
     - Search the rendered preview DOM (`#previewContent`) for the text matching `hunk.anchor.quote`.
     - Validate with prefix/suffix context (same scoring as server-side `resolveProposalAnchor`).
     - Find the character range in the DOM text nodes.
     - Insert a diff block element at that position.

3. **Diff block HTML structure:**
   ```html
   <div class="ai-diff-block" data-proposal-id="..." data-hunk-id="...">
     <div class="ai-diff-header">
       <span class="ai-diff-label">AI proposal: Fix intro wording</span>
       <span class="ai-diff-badge">open</span>
     </div>
     <div class="ai-diff-content">
       <div class="ai-diff-deleted">
         <div class="ai-diff-section-label">Original</div>
         <div class="ai-diff-text">...</div>
       </div>
       <div class="ai-diff-added">
         <div class="ai-diff-section-label">Proposed</div>
         <div class="ai-diff-text">...</div>
       </div>
     </div>
     <div class="ai-diff-actions">
       <button data-ai-accept="...">Accept</button>
       <button data-ai-reject="...">Reject</button>
       <button data-ai-revise="...">Revise</button>
     </div>
   </div>
   ```

4. **DOM insertion strategy:**
   - Option A (recommended): Wrap the matched text range in a `<span class="ai-diff-anchor">`, then insert the diff block as the next sibling of the anchor's parent block element (e.g. after the `<p>` or `<li>` that contains the match). This avoids breaking markdown structure.
   - Option B: Use the `highlight-layer` overlay (absolute positioned, pointer-events) similar to comment highlights, with the diff block rendered as an overlay. This is cleaner for the DOM but harder to make interactive (accept/reject buttons need pointer events).

   **Recommendation: Option A** — it's simpler, the diff blocks are real DOM elements in the preview flow, and buttons are naturally interactive.

5. **Stale proposals:** Instead of a diff block, render a small inline badge near the target text: _"Proposal stale: target text changed"_. No accept/reject buttons, only dismiss.

6. **Multiple proposals:** If multiple proposals target overlapping or nearby text, stack their diff blocks vertically at the insertion point, each with a clear label and distinct left-border color.

### Step 5 — Wire up diff block actions

**Files:** `public/app.js`

1. After rendering diff blocks, attach event listeners to `[data-ai-accept]`, `[data-ai-reject]`, `[data-ai-revise]` buttons (same API calls as current modal-based accept/reject).
2. On accept: API call succeeds → `state.ai` is updated → preview re-renders → diff blocks re-render (accepted proposal gone).
3. On reject: Same flow, rejected proposal disappears from inline view.
4. On revise: Populate the sidebar prompt input with a revision request, focus the sidebar.
5. Use event delegation on `#previewContent` to avoid re-attaching listeners on every render.

### Step 6 — Update server-side proposal prompt

**Files:** `src/ai.ts`

1. Update `buildSystemInstructions()` and `buildPrompt()`:
   - Change the instruction from "Tell collaborators to review it in the AI panel" to something like "Proposals appear as inline diffs in the document preview. Collaborators review them in context."
2. No structural changes to the proposal tool, state model, or API — the backend stays the same.

### Step 7 — Clean up removed code

**Files:** `public/app.js`, `public/styles.css`

1. Remove `renderAiProposal()` function (proposal cards no longer rendered in sidebar/modal).
2. Remove all `.ai-panel-modal`, `.ai-proposal-*` (modal variant) CSS.
3. Remove `renderAiPanel()` function entirely.
4. Remove the modal-based AI event wiring (backdrop click, etc.).
5. Remove the `.ai-toggle` button styles that show proposal counts — the toggle becomes a simple sidebar toggle (could use a chat icon instead of text).
6. Remove the `modalBackdrop` usage from AI code paths (keep it for agent settings modal and other modals).

### Step 8 — Responsive / mobile behavior

**Files:** `public/styles.css`, `public/app.js`

1. On screens < 768px:
   - Sidebar becomes a full-width overlay (slides from right, covers preview/editor).
   - Inline diffs remain in preview as normal (they're in the DOM flow).
2. Toggle button always visible in topbar.

---

## Files Changed Summary

| File | Change |
|---|---|
| `public/app.js` | Replace modal AI panel with sidebar. Add inline diff rendering in preview. Remove `renderAiPanel`, `renderAiProposal`. Add `renderAiSidebar`, `renderProposalDiffs`. Update layout templates. |
| `public/styles.css` | Remove `.ai-panel-modal` CSS. Add `.ai-sidebar` layout. Add `.ai-diff-*` inline diff styles. Update `.workspace` to flex layout. Add responsive rules. |
| `src/ai.ts` | Minor: update system prompt wording for inline diffs. |
| `src/server.ts` | No changes. |
| `src/collab.ts` | No changes. |

---

## Risk & Open Questions

1. **DOM anchoring reliability:** Matching proposal anchor text to rendered HTML is inherently fragile (markdown → HTML transformation may change whitespace, entity encoding, etc.). The existing comment system handles this with prefix/suffix scoring — we'll reuse that pattern. Fallback: if anchor resolution fails, show the diff block at the top of the preview with a "could not locate in document" note.

2. **Preview re-render timing:** Every keystroke triggers a debounced preview re-render (`scheduleRender`). Diff blocks must be re-inserted after each render. This is the same constraint as comment highlights. Performance should be fine since we're only processing a small number of open proposals.

3. **Contenteditable interaction:** If the user is editing in the textarea (source view), diff blocks are only visible in the preview pane. This is acceptable — the preview is the rendered view where contextual diffs make sense.

4. **Diff block positioning inside lists/tables:** Nested structures may make DOM insertion awkward. The fallback is to render the diff block after the nearest block-level ancestor.

---

## Estimated Effort

| Step | Scope |
|---|---|
| Step 1: Layout restructure | Small — CSS + minor template changes |
| Step 2: Modal → sidebar | Medium — rewrite rendering, wire events |
| Step 3: Sidebar content | Small — extract from existing code |
| Step 4: Inline diffs | **Large** — new feature, DOM anchoring, rendering |
| Step 5: Wire actions | Small — reuse existing API calls |
| Step 6: Update prompts | Trivial — text changes |
| Step 7: Cleanup | Small — delete dead code |
| Step 8: Responsive | Small — CSS media queries |

**Total: ~2–3 focused sessions.** Step 4 is the bulk of the new work.
