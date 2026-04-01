# jot

Minimal self-hosted markdown editor with inline comment threads.

- Single owner, password set on first startup
- Per-device auth tokens
- Plain `.md` files on disk
- Split editor/preview
- Syntax highlighting in preview
- Share notes via public URL
- Inline comment threads anchored to text selections
- Threaded replies, resolve/reopen
- Anonymous commenters with cookie-based identity
- Dark and light theme
- Mobile support

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3210`. Set the owner password on first visit.

## Production

```bash
npm run build
node dist/server.js                          # port 3210, data in ./data
node dist/server.js --port=8080              # custom port
node dist/server.js --data=/var/lib/jot       # custom data directory
```

## Docker

```bash
docker compose up --build
```

## Data

```
data/
  auth.json
  notes/
    <id>.md
    <id>.json
```

Notes are plain markdown files. Metadata and comment threads live in the sidecar JSON.

## No support

This is a personal tool. No issues, no PRs, no support. Fork it if you want.

## License

MIT
