# Shared AI Layer Implementation Plan

## Problem and approach

Add a shared AI layer to Jot using the GitHub Copilot SDK without taking on GitHub-backed storage yet. The first implementation should treat the current note as shared context, keep one **logical shared conversation** per note, stream AI output to connected editor participants, and keep AI-generated document changes reviewable and attributable instead of silently editing the note.

Assumptions for this phase:

- Notes remain Jot-managed notes for now; repo-backed file storage is out of scope.
- The server remains authoritative for document mutations and AI state.
- The AI layer is collaborative by default: one shared conversation and one shared proposal set per note.
- The first implementation is intentionally conservative:
  - prompting and live streaming are limited to owner and `edit` participants
  - `view` and `comment` participants can read persisted completed conversation/proposal state, but do not prompt or receive live AI streaming in v1
  - broadening AI access to `comment` users requires a separate transport path plus rate-limiting and audit controls
- Non-trivial AI edits land as proposals that collaborators explicitly accept or reject.

## Phases

### Phase 1 — Shared conversation backbone

Goal: create one shared, multi-turn AI conversation per note without coupling it to note-save churn or stale document snapshots.

Implementation shape:

- Add a server-side AI runtime manager keyed by `noteId`.
- Integrate the GitHub Copilot SDK in Node/TypeScript, but treat the SDK session as a runtime detail rather than the durable source of truth for conversation state.
- Keep one **logical shared conversation** per note, persisted separately from note metadata in adjacent AI state such as `data/notes/<noteId>.ai.json`.
- Persist AI state independently from note persistence so normal collaborative typing does not rewrite growing AI history on every keystroke.
- Treat the current note markdown as **ephemeral per-turn context**, not durable chat history. Rebuild or refresh the Copilot session from bounded transcript + current note snapshot as needed so old note snapshots do not accumulate inside a long-lived session.
- Add a per-note run queue/lock in this phase so prompt submission is serialized from the first prompt-capable version.
- Add authenticated/share-aware endpoints for:
  - listing shared conversation history
  - posting a prompt into the shared conversation
  - clearing or resetting the shared conversation
- Scope prompt submission in v1 to owner and `edit` access only.

Likely code surfaces:

- `src/server.ts` for API/WebSocket orchestration and access control
- new server module such as `src/ai.ts` or `src/copilot.ts` for Copilot SDK runtime, prompt queueing, and persistence
- separate AI persistence types/files rather than note metadata
- `public/app.js` for the shared chat panel and prompt submission UX

Exit criteria:

- An editor participant can open a note, see prior AI turns for that note, submit a prompt, and the shared conversation state survives reconnects and restarts.
- Prompt execution is serialized per note before any streaming work begins.

### Phase 2 — Streaming response fan-out

Goal: stream Copilot output progressively to connected editor participants in the active note.

Implementation shape:

- Subscribe to Copilot SDK streaming events for assistant deltas and turn lifecycle.
- Add a dedicated AI event path to the existing realtime layer instead of assuming existing `public-viewer` connections can consume AI traffic.
- In v1, broadcast AI deltas, tool activity, completion, failure, and cancellation to the owner/editor/public-editor connections that already participate in rich realtime note activity.
- Keep AI events separate from document mutation events.
- Add reconnect behavior so refreshed editor clients can rebuild the in-progress or latest completed assistant turn.
- Expose completed turn state through non-streaming APIs so non-editor viewers can still read durable conversation state.

Likely code surfaces:

- `src/server.ts` WebSocket message types and note-scoped AI broadcast paths
- new AI integration module for SDK event mapping
- `public/app.js` for streaming UI state, turn assembly, loading/cancel UX

Exit criteria:

- When an editor participant prompts the AI, every connected editor participant in that note sees the answer stream in real time and the final assistant turn is durable.

### Phase 3 — Visible AI collaborator identity

Goal: make AI conversation activity visible and attributable as a first-class collaborator.

Implementation shape:

- Introduce an explicit AI participant identity per note, including display name, avatar styling, and event attribution.
- Render AI turns and AI-originated activity distinctly from human chat/comments.
- Add AI activity to existing collaboration surfaces where it helps comprehension:
  - conversation timeline
  - optional activity/status indicator in the editor shell
- Prepare attribution fields that Phase 4 can reuse for proposals and accepted edits.
- Keep AI presence out of cursor/presence overlays in v1 unless a later pass shows clear value.

Likely code surfaces:

- `public/app.js` UI rendering and activity labeling
- shared message/event typing in server/client protocol
- separate AI state schema for stable attribution metadata

Exit criteria:

- Collaborators can always tell which conversation turns and activity states came from the AI.
- The identity model is ready to attribute future proposals and accepted edits.

### Phase 4 — Reviewable AI edit proposals

Goal: make AI edits reviewable and explicit before they touch the note.

Implementation shape:

- Define a proposal model for AI-generated edits that is separate from the live document until accepted.
- Use a **text-first, anchor-backed proposal format** rather than storing raw CRDT mutations. Each proposal hunk should carry:
  - `oldText`
  - `newText`
  - an anchor object such as `{ quote, prefix, suffix }`
  - optional metadata such as `summary`, `sourceTurnId`, and informational `baseServerCounter`
- Store proposals in a review-friendly form with a readable diff. The AI proposes text changes; it does not directly emit authoritative editor mutations.
- Add proposal UX in the editor:
  - show proposed change summary/diff
  - accept
  - reject
  - keep v1 all-or-nothing per proposal rather than partial apply
- On accept, resolve each proposal hunk against the **current** markdown using the stored anchors, then translate the resolved range into normal delete/insert mutations through the existing server-authoritative collab path.
- If a hunk cannot be resolved uniquely at accept-time, mark the proposal stale instead of guessing.
- Keep accepted/rejected status and AI attribution visible in the shared conversation history.

Likely code surfaces:

- `src/server.ts` for proposal creation, storage, acceptance, and broadcast
- `src/collab.ts` for mapping resolved accepted ranges into mutation-safe operations
- `public/app.js` for review UI and proposal state

Exit criteria:

- The AI can propose a meaningful text change, collaborators can review it without it auto-applying, and accepting it updates the note through the normal collab path with AI attribution.

### Phase 5 — Stale proposal detection and safe apply

Goal: prevent AI proposals from applying when their target region no longer matches the live note.

Implementation shape:

- Stamp every proposal with target-region information captured from generation-time state, including its anchor context and any resolved range metadata that helps later validation.
- Make stale detection **range-aware first**:
  - validate that the target text is still uniquely resolvable via `quote/prefix/suffix`
  - validate that the corresponding current range still matches what the proposal expects
  - use global note version or `serverCounter` only as supplementary context, not as the primary stale gate
- Do not mark a proposal stale just because unrelated edits happened elsewhere in the note.
- If validation fails, mark the proposal stale and block direct apply.
- Surface a clear stale state in the UI and allow regenerate/revise from current note content instead of forcing unsafe application.
- Keep the first implementation conservative: no auto-rebasing of stale proposals.

Likely code surfaces:

- `src/server.ts` proposal validation and stale-state transitions
- `src/collab.ts` range validation helpers if needed
- `public/app.js` stale proposal messaging and regenerate actions

Exit criteria:

- AI proposals that still match their target region can be applied even if unrelated edits happened elsewhere in the note.
- AI proposals whose target region is missing, ambiguous, or meaningfully changed are visibly marked stale and cannot be applied as if they were still valid.

## Todo map

1. `ai-shared-session-foundation` — Add note-scoped Copilot runtime/session management, separate AI persistence, per-note run serialization, and shared conversation APIs.
2. `ai-streaming-protocol` — Add note-scoped AI streaming events and editor-participant fan-out without relying on existing viewer connections for realtime AI traffic.
3. `ai-visible-attribution` — Add first-class AI identity, attribution, and activity rendering in the client.
4. `ai-reviewable-proposals` — Add anchored text proposal data models, review UI, and accept-time translation into normal collaborative mutations.
5. `ai-stale-proposal-guardrails` — Add range-aware validation and stale marking before proposal application, using global version only as secondary context.

## Notes and considerations

- The current monolithic `src/server.ts` can support an initial slice, but extracting the Copilot SDK integration into a dedicated server module should happen immediately to avoid further entangling note, auth, WebSocket, and AI concerns.
- The existing collaboration model is a good fit for AI proposals because the server already owns mutation application and clients already reconcile against authoritative state.
- The first release should avoid letting the AI write directly into the note stream while generating. Streaming text belongs in the conversation layer; document mutations should stay proposal-based until explicitly accepted.
- Do not persist AI history inside note metadata. AI state must live in its own persistence unit so collaborative typing does not rewrite growing AI blobs on every note save.
- The first release should treat note content as replaceable turn context, not durable chat transcript content inside a long-lived SDK session.
- Existing share access levels imply likely AI permissions in v1:
  - `view`: read persisted conversation/proposal state only
  - `comment`: read persisted conversation/proposal state only
  - `edit`: prompt AI, receive live streaming, review proposals, and apply accepted proposals
- If later expanding prompting or live streaming beyond `edit`, add a dedicated non-editor AI transport path plus rate limiting, audit logging, and quota-abuse controls first.
- Persistence format should leave room for future repo-backed context, tool traces, and richer proposal metadata without forcing a migration immediately afterward.
