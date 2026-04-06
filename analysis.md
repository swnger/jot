# jot — Codebase Analysis

> **jot** is a minimal, self-hosted, collaborative markdown editor with inline comment threads. Published as `@mariozechner/jot` on npm.

---

## Sourcemap

| Path | Lines | Role |
|---|---|---|
| `src/server.ts` | ~2 200 | Express HTTP server, WebSocket hub, auth, persistence, markdown rendering, SSR page shells |
| `src/collab.ts` | ~350 | Collaborative editing CRDT layer (wraps the `articulated` library) — state, mutations, serialization |
| `public/app.js` | ~1 900 | Main frontend SPA — note list, editor, preview, comments UI, WebSocket client |
| `public/collab-editor.js` | ~470 | Browser-side collaborative editor — captures input events, builds mutations, applies remote patches |
| `public/collab-shared.js` | ~350 | Shared CRDT utilities for the browser — `SimpleIdList`, selection ↔ ID conversion, ID list update replay |
| `public/styles.css` | ~530 | Full stylesheet (light + dark theme, editor layout, comment threads, responsive) |
| `public/login.js` | ~70 | Login / setup password page logic |
| `public/theme.js` | ~40 | Theme detection and toggle icon helper |
| `public/components.js` | ~60 | Shared DOM component builders |
| `cli/jot.mjs` | ~520 | CLI — registers instances, proxies commands to the HTTP API (owner + shared modes) |
| `Dockerfile` | ~20 | Multi-stage Docker build (deps → build → runtime) |
| `docker/` | — | `docker-compose.base.yml`, `docker-compose.prod.yml`, `docker-compose.dev.yml`, `control.sh` |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (SPA)                                                  │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐│
│  │ collab-editor │  │ collab-shared  │  │ app.js (UI / render) ││
│  │ (input→mut.)  │  │ (SimpleIdList) │  │ (pages, comments)    ││
│  └──────┬───────┘  └───────┬────────┘  └──────────┬───────────┘│
│         │    WebSocket     │                       │ HTTP API   │
└─────────┼──────────────────┼───────────────────────┼────────────┘
          │                  │                       │
┌─────────┼──────────────────┼───────────────────────┼────────────┐
│  Server │                  │                       │            │
│  ┌──────▼──────────────────▼───────────────────────▼─────────┐ │
│  │                    src/server.ts                          │ │
│  │  Express (HTTP API + SSR)  │  WebSocketServer (ws)       │ │
│  │  • REST endpoints          │  • mutation broadcast       │ │
│  │  • session/auth cookies    │  • presence (cursors)       │ │
│  │  • markdown → HTML render  │  • heartbeat / reconnect    │ │
│  └──────────────┬────────────────────────────────────────────┘ │
│                 │                                               │
│  ┌──────────────▼──────────┐    ┌──────────────────────────┐   │
│  │    src/collab.ts         │    │  Filesystem (data/)      │   │
│  │  CollabState CRDT        │    │  auth.json               │   │
│  │  IdList + char map       │    │  notes/<id>.json         │   │
│  │  mutation apply/serial.  │    │  notes/<id>.md           │   │
│  └─────────────────────────┘    └──────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────┐                                       │
│  │  cli/jot.mjs          │  (standalone, talks to HTTP API)    │
│  └──────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Subsystems

### 1. Collaborative Editing (CRDT)

- Uses the **`articulated`** npm package (a list CRDT) to assign globally-unique IDs to every character. This enables conflict-free concurrent edits.
- **`src/collab.ts`** is the authoritative server-side CRDT layer. It defines `CollabState` (an `IdList` + `Map<id, char>`) and exposes `applyClientMutations()` which processes insert/delete operations, returns the new state + markdown + incremental `IdListUpdate[]`.
- **`public/collab-shared.js`** ships a lightweight `SimpleIdList` to the browser so the client can apply the same incremental updates locally without re-fetching the full state.
- **`public/collab-editor.js`** captures `beforeinput`, `keydown`, paste, and composition events on a `contenteditable` div, translates them into `ClientMutation[]` messages, and applies server acknowledgements / remote mutations.
- The protocol is **server-authoritative**: clients send mutations, the server applies them, increments `serverCounter`, and broadcasts incremental updates to all connected editors.

### 2. Server (`src/server.ts`)

This is a **single-file monolith** (~2 200 lines) containing:

| Concern | Lines (approx.) | Notes |
|---|---|---|
| Express app + routes | 700–900 | REST API for notes, threads, comments, auth, API keys, sharing |
| WebSocket hub | 200–300 | Connection management, mutation broadcast, presence relay |
| Auth system | 250–300 | Single-owner password, device tokens (scrypt hashes), API keys, commenter cookies |
| HTML rendering | 100–150 | SSR page shells (login, editor, shared view), markdown → HTML via `marked` + `highlight.js` + `sanitize-html` |
| Data layer | 150–200 | In-memory `Map<string, NoteRecord>`, filesystem persistence (`data/notes/*.json` + `*.md`) |
| Utility functions | 100–150 | ID generation, cookie parsing, HTML escaping, string normalization |

**Notable patterns:**
- All notes are loaded into memory at startup; there is no database.
- Persistence is synchronous (`fs.writeFileSync`) on every mutation — simple but may block under high write load.
- Markdown rendering uses `marked` with a custom code renderer for syntax highlighting (`highlight.js`) and Mermaid diagram support.
- The `renderAppShell()` function generates full HTML pages server-side with inline `data-*` attributes that the client JS reads to bootstrap the SPA.

### 3. Authentication & Authorization

- **Single owner model:** one password protects the entire instance. On first visit, the owner sets the password.
- **Device tokens:** after login, a random token is stored in an `HttpOnly` cookie and also returned for `localStorage` persistence. Tokens are verified with scrypt hashes.
- **API keys:** the owner can create labeled API keys (`Bearer` token auth) for programmatic access (CLI / agents).
- **Commenter identity:** shared-note visitors get a random cookie-based ID and can set a display name. Comment permissions are scoped to this identity.
- **Share access levels:** `none` → `view` → `comment` → `edit` (hierarchical). Middleware `requireShareAccess()` enforces minimum level.
- All secret comparisons use `crypto.timingSafeEqual` to prevent timing attacks.

### 4. Real-Time WebSocket Protocol

Messages are JSON. The protocol has these message types:

| Direction | Type | Purpose |
|---|---|---|
| Server → Client | `hello` | Full state on connect (markdown, idListState, serverCounter) |
| Client → Server | `mutation` | Array of insert/delete mutations with clientCounter |
| Server → Client | `mutation` | Acknowledgement + broadcast (markdown snapshot + idListUpdates) |
| Client → Server | `presence` | Cursor/selection position |
| Server → Client | `presence` | Remote user's cursor/selection |
| Server → Client | `presence-leave` | User disconnected |
| Server → Client | `updated` | Note content changed (for public viewers) |
| Server → Client | `threads-updated` | Comments changed — triggers re-fetch |

Heartbeat: server pings every 30s; clients that miss pong are terminated.

### 5. Frontend (`public/`)

- **Zero build step** — plain JS files served statically, no bundler.
- `app.js` is the main SPA (~1 900 lines). It detects the page type from `document.body.dataset.page` (`list` | `editor` | `public`) and renders the appropriate UI.
- The editor view uses a `contenteditable` div with `collab-editor.js` for collaborative editing.
- Preview pane renders server-side markdown HTML (fetched via API) and supports Mermaid diagrams with pan/zoom.
- Comment threads are anchored to text selections using `{quote, prefix, suffix, start, end}` tuples.
- Mobile detection adjusts layout (single-pane vs. split-pane editor/preview).

### 6. CLI (`cli/jot.mjs`)

- Standalone Node.js ESM script, distributed via `package.json.bin`.
- Config stored at `~/.config/jot/settings.json` — maps instance names to `{baseUrl, token}` (owner) or `{baseUrl, shareId}` (shared).
- Supports two modes:
  - **Owner mode:** full CRUD on notes, threads, comments, API keys via `Authorization: Bearer <key>`.
  - **Shared mode:** limited to what the share link permits (read, edit, comment, reply).
- The `serve` command execs `node dist/server.js` as a child process.

### 7. Persistence & Data Layout

```
data/
  auth.json                # {passwordSalt, passwordHash, tokens[], apiKeys[]}
  notes/
    <id>.md                # Markdown (derived, for grep/backup)
    <id>.json              # {id, title, shareId, shareAccess, threads[], collab: SavedCollabState}
```

- The `.json` sidecar is the source of truth. `.md` files are derived from the CRDT state on every save.
- Note IDs are 8-char random base64url strings. Share IDs are 14-char.
- Thread and message IDs are 10-char random strings.

---

## Notable Design Decisions

1. **Single-file server:** Everything in `server.ts`. Simple to read and deploy, but the file is ~2 200 lines. The route definitions, WebSocket handling, auth logic, and persistence are all interleaved.

2. **No database:** All notes live in an in-memory `Map` backed by per-note JSON files. Good for single-user / small-team use; would need rethinking for scale.

3. **CRDT-based collaboration:** Uses `articulated` (a positional list CRDT) rather than OT. The server is still authoritative — it applies mutations and broadcasts — but the CRDT ensures convergence even if operations arrive out of order.

4. **Server-rendered page shells:** Each page (login, list, editor, shared) is an HTML document rendered by the server, then the client JS bootstraps the SPA. No client-side routing.

5. **No frontend build pipeline:** Plain JS, no TypeScript, no bundler. Keeps the project simple but means no tree-shaking or type-checking on the frontend code.

6. **Agent-friendly CLI:** The CLI and share links are explicitly designed for AI agent integration. The README documents agent setup, and the `--name=` flag lets agents set their display name in comments.

---

## Code Quality Observations

| Aspect | Observation |
|---|---|
| **Type safety** | Server code is strict TypeScript with proper types for all data structures. Frontend is plain JS with no type checking. |
| **Error handling** | API routes validate inputs and return proper error objects. WebSocket mutations are try-caught with fallback to re-sending hello. |
| **Security** | Scrypt hashing, timing-safe comparisons, `sanitize-html` for markdown output, HttpOnly cookies, SameSite=Lax, Bearer token auth, input length limits. |
| **Test coverage** | No test files found in the repository. |
| **Duplication** | The `POST /api/notes/:id/edit` and `POST /api/share/:shareId/edit` handlers are nearly identical (~60 lines each). Same for several thread/message CRUD routes in owner vs. share contexts. |
| **Config** | Port and data directory via CLI args, env vars, or defaults. No `.env` file support. |

---

## Dependency Graph

```
server.ts
  ├── express (HTTP framework)
  ├── ws (WebSocket server)
  ├── marked (markdown → HTML)
  ├── highlight.js (syntax highlighting in code blocks)
  ├── sanitize-html (HTML sanitization)
  ├── mermaid (served as static asset for browser-side diagram rendering)
  └── articulated (CRDT list — imported via collab.ts)

collab.ts
  ├── articulated (IdList CRDT)
  └── crypto (UUID generation)

CLI (jot.mjs)
  └── (Node.js built-ins only — fetch, fs, child_process)
```

---

## Quick Stats

| Metric | Value |
|---|---|
| Total source lines (server) | ~2 550 |
| Total source lines (frontend) | ~3 380 |
| Total source lines (CLI) | ~520 |
| Total source lines (CSS) | ~530 |
| Total source lines (all) | **~6 980** |
| Dependencies (runtime) | 7 (`articulated`, `express`, `highlight.js`, `marked`, `mermaid`, `sanitize-html`, `ws`) |
| Dev dependencies | 6 |
| API endpoints | ~30 |
| WebSocket message types | 7 |
