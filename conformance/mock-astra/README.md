# mock-astra

A tiny HTTP server that stands in for Astra's Data API during
conformance testing.

## What it does

- Captures every inbound request (method, path, headers, JSON body).
- Returns a stub success response so clients can keep executing.
- Exposes a capture-control protocol:
  - `POST /_reset` — clear captured requests.
  - `GET /_captured` — return captured requests as JSON.
  - `GET /_health` — liveness probe.

## What it does NOT do

- Persist any state.
- Validate the shape of client requests (that's the fixture diff's job).
- Return realistic Data API errors.
- Enforce authentication (the Authorization header is captured, not
  verified).

## Running

From the repo root:

```bash
npm run conformance:mock
```

Defaults: `http://127.0.0.1:4010`. Override with `PORT` / `HOST` env
vars.

## Protocol by example

```bash
# Reset the capture log
curl -X POST http://localhost:4010/_reset

# Send something a client would send
curl -X POST http://localhost:4010/api/json/v1/workbench/wb_workspaces \
  -H "Content-Type: application/json" \
  -H "Token: test-token" \
  -d '{"insertOne": {"document": {"uid": "...", "name": "prod"}}}'

# Read the capture log
curl http://localhost:4010/_captured
# → [{ "method": "POST", "path": "...", "headers": {...}, "body": {...} }]
```
