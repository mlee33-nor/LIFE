# Tracker Logging API — Instructions for Instinct

Instinct (Myles's AI message agent) logs tracker entries live as Myles texts
updates, e.g. "started history hmwk", "had a burrito", "stomach hurts, like
a 6". Each message becomes one or more `POST /log` calls. The dashboard reads
the same data, so **use the exact shapes below**. Anything else is stored but
won't show up on the dashboard.

## Connection

- Base URL: `https://api-production-2ace4.up.railway.app`
- Every request carries: `Authorization: Bearer <API_KEY>` (the key is shared
  privately; it is not in this file)
- Body: JSON, `Content-Type: application/json`
- Timezone: **America/Phoenix** (UTC-7, no daylight saving)

## POST /log — append one entry

```json
{ "tracker": "life", "at": "2026-09-25T15:20:00-07:00", "data": { ... } }
```

- `tracker` (required): `life`, `food` or `skin`
- `at` (optional): when it happened, ISO-8601. **Leave it out if it
  happened just now**; the server stamps the current time. If Myles says
  "I had eggs at 8", send `"at": "2026-09-25T08:00:00-07:00"`. A time
  without an offset is treated as Phoenix time.
- `data` (required): one of the shapes below

Response: `200 {"ok": true, "id": "123"}`. Keep the `id` in case Myles
corrects the entry. A `400` means the body was invalid; its `error` field
says why.

## What to put in `data`

### life: sessions (time spent on something)

```json
{ "kind": "session", "action": "start", "activity": "hmwk", "subject": "history", "minutes": null }
{ "kind": "session", "action": "end",   "activity": "hmwk", "subject": "history", "minutes": null }
```

- `activity`: `work`, `hmwk`, `workout` or `walk`
- `subject` (hmwk only, otherwise null): `history`, `science`, `math` or `english`
- Send `start` when Myles starts and `end` when he stops. The dashboard
  pairs them to work out the minutes. The `end` must use the same
  activity and subject as its `start`.
- If Myles gives a duration after the fact ("did a 45 min workout"), send
  just an `end` with `"minutes": 45`.

### life: habits

```json
{ "kind": "habit", "habit": "water", "value": 1 }
```

- `habit`: `water`, `meal`, `shower`, `room_clean`, `am_skincare`,
  `pm_skincare`, `sunscreen`, `morning_ritual` or `bedtime`
- `value`: for `water`, the number of glasses (they're added up per day).
  Otherwise `null`.

### food: meals

```json
{ "kind": "meal", "text": "chicken burrito with cheese and salsa", "pain": null }
```

Put **every food eaten** in `text` as plain words, e.g. "eggs, toast, coffee
with milk". Trigger-food detection works from these words, so include things
like milk, cheese, sauces and drinks rather than just "breakfast".

### food: stomach pain

```json
{ "kind": "pain_report", "text": "cramps after lunch", "pain": 6 }
```

`pain` is 0 (none) to 10 (worst). If Myles describes pain without a number,
estimate one: mild ≈ 2-3, noticeable ≈ 4-5, bad ≈ 6-7, severe ≈ 8+. Also log
`"pain": 0` when he says his stomach feels fine, because good days matter
for spotting triggers.

### skin

```json
{ "kind": "routine", "text": "cleanser + moisturizer", "severity": null }
{ "kind": "note",    "text": "two new spots on chin", "severity": 5 }
{ "kind": "photo",   "text": "morning check", "photo_ref": "<link or id>", "severity": 3 }
```

`severity` is how bad the acne is right now, 0 (clear) to 10 (worst). **Include it
whenever Myles says anything about how his skin looks**, estimating if
needed. It powers the acne charts. Use `null` for routines where he didn't
mention his skin.

### food / skin: other notes

```json
{ "kind": "note", "text": "felt bloated all evening", "pain": null }
```

## GET /entries — read back entries

`GET /entries?tracker=food&since=2026-09-25&until=2026-09-25`

`tracker` is required; `since`/`until` are optional ISO dates or datetimes
(a date-only `until` covers that whole day). Returns
`{"entries": [{"id", "tracker", "at", "data"}]}`, oldest first. Use this to
answer questions like "what did I eat yesterday?" or to find an entry's id.

## DELETE /entries/:id — remove a mistaken entry

When Myles says "delete that" or "that was wrong", call `DELETE /entries/<id>`.
To change an entry, delete it and log the corrected version.

## Examples

| Myles texts | Calls |
|---|---|
| "starting math hmwk" | life `{kind:"session", action:"start", activity:"hmwk", subject:"math", minutes:null}` |
| "done with math" | life `{kind:"session", action:"end", activity:"hmwk", subject:"math", minutes:null}` |
| "2 glasses of water" | life `{kind:"habit", habit:"water", value:2}` |
| "pizza and a coke for lunch, stomach kinda hurts" | food `{kind:"meal", text:"pizza, coke", pain:null}` **and** food `{kind:"pain_report", text:"kinda hurts after lunch", pain:4}` |
| "did skincare, skin looking clear today" | life `{kind:"habit", habit:"pm_skincare", value:null}` **and** skin `{kind:"routine", text:"skincare, looking clear", severity:1}` |

## Non-goals

- Single user (Myles), no accounts.
- Streaks, XP and levels are calculated by the dashboard, not sent by Instinct.
