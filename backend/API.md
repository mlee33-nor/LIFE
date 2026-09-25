# Lifestyle Dashboard API

Node + Postgres, deployed on Railway. Instinct (the AI message agent) writes events; the
dashboard UI reads interpreted data and insights.

```
Instinct ─POST /log─▶  API  ──▶ Postgres (events table)
UI   ◀──/api/*────   API  ◀── LISTEN/NOTIFY (live updates)
```

All times are **America/Phoenix** (UTC-7, no DST). Dates are `YYYY-MM-DD`
local dates.

---

## Part 1: Logging-agent routes (Instinct; full instructions in `../tracker-api-contract.md`)

Every request needs `Authorization: Bearer <WRITE_API_KEY>`, otherwise it
gets a `401`.

### `POST /log`: append one event

```json
{ "tracker": "life | food | skin", "at": "2026-09-25T15:20:00-07:00", "data": { } }
```

- `tracker`: required, one of `life`, `food`, `skin`
- `at`: optional ISO-8601. If omitted, the server uses the current time. If it has no offset, it's read as Phoenix time.
- `data`: required, any JSON, stored as-is

→ `200 { "ok": true, "id": "123" }` · `400 { "ok": false, "error": "...", "details": [...] }`

### `GET /entries?tracker=food&since=...&until=...`

`tracker` is required. `since`/`until` are optional ISO values. A date-only
`until` includes that whole day. Results are sorted by `at` ascending.

→ `200 { "entries": [ { "id": "123", "tracker": "food", "at": "2026-09-25T12:00:00-07:00", "data": { } } ] }`

### `DELETE /entries/:id` (extra, for corrections)

Soft-deletes an event, e.g. when Myles says "delete that". The event is
excluded from everything afterwards. → `200 { "ok": true, "deleted": "123" }` or `404`.

### `data` shapes the dashboard understands

| tracker | data | used for |
|---|---|---|
| life | `{kind:"session", action:"start"\|"end", activity:"work"\|"hmwk"\|"workout"\|"walk", subject, minutes}` | activity minutes. Start/end are paired by activity+subject; `minutes` on an end event overrides the computed duration; an end with `minutes` and no start also counts |
| life | `{kind:"habit", habit, value}` | habit completion; `water` is summed by `value` (or counted if null) |
| food | `{kind:"meal", text, pain}` | food keywords taken from `text` for trigger analysis |
| food | `{kind:"pain_report", text, pain}` | stomach pain (daily max of `pain`, 0-10) |
| skin | `{kind:"routine"\|"photo"\|"note", text, photo_ref, severity}` | skin log; `severity` (0-10) is the daily acne score (daily max) |

Unknown shapes are stored and returned by `/entries`, but the dashboard ignores them.

---

## Part 2: Dashboard routes (for the UI)

Base: the Railway URL. If `READ_API_KEY` is set on the server, send
`Authorization: Bearer <READ_API_KEY>` (or `?key=` for EventSource).
`/api/health` is always public. Errors look like `{ ok:false, error }` with a 4xx/5xx status.
Most responses include a `meta` block: `{ timezone, loaded_at, last_write_at, event_count, day_count, stale_error }`.

### Live updates: `GET /api/events` (Server-Sent Events)

```js
const es = new EventSource(`${API}/api/events`);
es.addEventListener('data-updated', () => refetchEverything());
```

This fires within about 0.5 s of Instinct writing anything.

### `GET /api/summary?days=30&to=YYYY-MM-DD`

Headline numbers for the last `days` days ending at `to` (defaults to the latest logged day).

```jsonc
{
  "active_sessions": [{ "activity": "hmwk", "subject": "history", "started_at": "..." }],  // "currently doing"
  "period": { "from": "2026-08-27", "to": "2026-09-25", "days": 30 },
  "days_logged": 30, "last_logged_date": "2026-09-25", "days_since_last_log": 0,
  "averages":                 { "stomach_pain": 3.8, "acne": 4.1, "water": 4.4, "meals_logged": 3.4, "habits_done": 4.4, "work_minutes": 0, "hmwk_minutes": 48, "workout_minutes": 28, "walk_minutes": 0 },
  "previous_period_averages": { ...same keys },
  "change_vs_previous":       { ...same keys, current minus previous },
  "flare_days":               { "stomach_pain": 8, "acne": 7 },       // days scoring >= flare_threshold (4)
  "worst_day":                { "stomach_pain": { "date": "...", "value": 8 }, "acne": null },
  "current_streak_without_flare": { "stomach_pain": 0, "acne": 2 },
  "top_foods": [{ "food": "rice", "days_eaten": 6 }],
  "habit_completion": { "sunscreen": { "days_done": 5, "rate": 0.36 }, ... },
  "hmwk_minutes_by_subject": { "history": 293, "math": 133 },
  "totals_minutes": { "work_minutes": 0, "hmwk_minutes": 677, ... }
}
```

### `GET /api/daily?from=&to=`

One record per day. Use it for day views, calendars, and heatmaps.

```jsonc
{ "days": [{
  "date": "2026-09-25", "event_count": 19,
  "stomach_pain": 6, "pain_reports": [{ "at": "...", "pain": 6, "text": "bloated" }],
  "acne": 6,                                   // null if no severity logged
  "meals": [{ "at": "...", "text": "chicken burrito" }], "foods": ["chicken", "burrito"], "meals_logged": 5,
  "water": 5, "habits": { "water": { "count": 5, "value": 5 }, "sunscreen": { "count": 1, "value": null } }, "habits_done": 4,
  "sessions": [{ "activity": "hmwk", "subject": "history", "minutes": 84, "start": "...", "end": "..." }],
  "work_minutes": 0, "hmwk_minutes": 84, "workout_minutes": 0, "walk_minutes": 0, "hmwk_by_subject": { "history": 84 },
  "skin": { "routines": 1, "photos": 0, "notes": [{ "at": "...", "kind": "routine", "text": "..." }] },
  "notes": [{ "tracker": "food", "at": "...", "text": "..." }]
}] }
```

### `GET /api/timeseries?metrics=stomach_pain,acne&from=&to=&smooth=7`

One point per calendar day (days with no data are `null`), plus a trailing moving average `<metric>_avg<smooth>`.
Metrics: `stomach_pain, acne, water, meals_logged, habits_done, work_minutes, hmwk_minutes, workout_minutes, walk_minutes`.

```json
{ "from": "...", "to": "...", "smooth": 7, "points": [{ "date": "2026-09-24", "stomach_pain": 7, "stomach_pain_avg7": 4.3 }] }
```

### `GET /api/insights/foods?min_days=3&from=&to=`

Possible trigger foods, sorted by `difference` (how much worse the symptom is after eating the food than otherwise). Each lag is tested separately: stomach pain at 0-1 days after eating, acne at 1-3 days.

```json
{ "stomach_pain": { "window_days": [0, 1], "foods": [
  { "food": "yogurt", "lag_days": 1, "days_eaten": 8, "avg_after_eating": 4.9, "avg_otherwise": 2.9,
    "difference": 1.97, "flare_rate_after_eating": 0.6, "confidence": "low",
    "by_lag": [{ "lag_days": 0, "difference": 0.3, "days_eaten": 8 }, { "lag_days": 1, "difference": 1.97, "days_eaten": 8 }] }
] }, "acne": { ... }, "disclaimer": "..." }
```

Food names are keywords pulled from Instinct's free-text meal descriptions, so expect some noise. Please show the disclaimer and `confidence`.

### `GET /api/insights/lifestyle?from=&to=`

Pearson correlations between each lifestyle metric and each symptom, on the same day (`lag_days: 0`) and the next day (`1`), sorted by strength.

```json
{ "correlations": [{ "factor": "workout_minutes", "symptom": "stomach_pain", "lag_days": 0, "r": -0.25, "n": 45, "strength": "weak negative" }] }
```

### `GET /api/feed?tracker=&from=&to=&limit=200`

Raw events for an activity feed, newest first, with `at` in Phoenix time.

### `GET /api/schema`

Lists trackers, metrics, activities, habits, the flare threshold, and symptom windows.

---

## Running locally

```bash
cd backend
npm install
docker run -d --name life-pg -e POSTGRES_PASSWORD=dev -p 55432:5432 postgres:16-alpine
export DATABASE_URL=postgresql://postgres:dev@localhost:55432/postgres
npm run db:seed-sample          # 45 days of fake data (remove later: npm run db:seed-sample -- --clear)
WRITE_API_KEY=devkey npm run dev # http://localhost:3001
npm test
```

## Environment variables

| var | |
|---|---|
| `DATABASE_URL` | required. On Railway: `${{Postgres.DATABASE_URL}}` |
| `WRITE_API_KEY` | required for the logging routes. A long random string, shared only with Instinct (`MUSE_API_KEY` is still accepted as a fallback) |
| `READ_API_KEY` | optional. Locks the dashboard routes (recommended, since this is health data) |
| `APP_TIMEZONE` | default `America/Phoenix` |
| `CORS_ORIGIN` | default `*`. Set it to the UI's URL in production |
| `PORT` | set by Railway |

The schema is applied automatically on every start (`db/schema.sql`, idempotent).
