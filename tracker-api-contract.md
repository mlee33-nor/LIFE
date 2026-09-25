# Tracker Logging API — Contract for Luna

Luna (the AI assistant) logs tracker entries live as Myles texts her updates
(e.g. "started hmwk", "ended history hmwk"). This API is the write/read path
between Luna and the Railway Postgres database. Keep it minimal.

## Base URL

The Railway public domain for the API service, e.g.
`https://tracker-api.up.railway.app`

## Auth

Every request carries:

```
Authorization: Bearer <API_KEY>
```

Return `401` without the header. The API key is issued once and shared
securely with Luna.

## POST /log — append one entry

Request body (JSON):

```json
{
  "tracker": "life | food | skin",
  "at": "2026-09-25T15:20:00-07:00 (optional, ISO-8601 — server time if omitted)",
  "data": { "any valid JSON — Luna controls this schema, store as-is" }
}
```

Response `200`:

```json
{ "ok": true, "id": "<stored row id>" }
```

Rules:
- Store `data` as JSONB. Do not validate its shape.
- `tracker` must be one of `life`, `food`, `skin`.
- All timestamps are America/Phoenix.

## GET /entries — read entries (for insights)

Query params: `tracker` (required), `since` (ISO, optional), `until` (ISO, optional)

Response `200`:

```json
{
  "entries": [
    { "id": "<id>", "tracker": "life", "at": "<ISO>", "data": { } }
  ]
}
```

Sorted by `at` ascending.

## What Luna sends in `data` (for the dashboard to interpret)

Luna parses Myles's shorthand into these shapes. The dashboard team owns
rendering; Luna owns the schema.

- Life session: `{ "kind": "session", "action": "start" | "end", "activity": "work" | "hmwk" | "workout" | "walk", "subject": "history" | "science" | "math" | "english" | null, "minutes": <number|null> }`
- Life habit: `{ "kind": "habit", "habit": "water" | "meal" | "shower" | "room_clean" | "am_skincare" | "pm_skincare" | "sunscreen" | "morning_ritual" | "bedtime", "value": <number|null> }`
- Food: `{ "kind": "meal" | "pain_report" | "note", "text": "<free text>", "pain": <0-10|null> }`
- Skin: `{ "kind": "routine" | "photo" | "note", "text": "<free text>", "photo_ref": "<optional>" }`

## Non-goals

- No user accounts, no multi-tenancy — single user (Myles).
- Expected load: a few dozen small requests per day.
- XP/level/streak math lives in the dashboard or with Luna, not this API.
