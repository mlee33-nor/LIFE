# Tracker Logging API — Instructions for Instinct

Instinct (Myles's AI message agent) logs tracker entries live as Myles texts
updates, e.g. "started history hmwk", "had a burrito", "stomach hurts, like
a 6". Each message becomes one or more `POST /log` calls. The dashboard reads
the same data, so **use the exact shapes below**. Anything else is stored but
won't show up on the dashboard.

## Connection

- Base URL: `https://api-production-2ace4.up.railway.app`
- Timezone: **America/Phoenix** (UTC-7, no daylight saving)
- API key: shared privately; it is not in this file

## Using the browser form (for Instinct)

Open **`https://api-production-2ace4.up.railway.app/submit`**:

1. Type the API key into the **API key** field (`#key`).
2. Put the entry JSON into the **Entry JSON** box (`#json`). The body is
   the same as `POST /log` below: one entry `{"tracker", "at", "data"}`,
   or a **list** `[{...}, {...}]` when one message needs several entries.
3. Click **Submit** (`#submit`).
4. Read the result box (`#result`). `data-status="success"` shows e.g.
   "Logged 2 entries, id 41, 42"; `data-status="error"` lists what was
   wrong, and **nothing is saved** from that submission. Fix it and resubmit.

The key stays filled in after each submit. Below the form is a table of
the 10 latest entries with their ids. To remove a mistaken entry, submit
`{"delete": "42"}`. To look entries up, open
`/entries?tracker=food&since=2026-09-25&key=<API_KEY>`.

## Using HTTP directly (if an agent can send headers)

Every request carries `Authorization: Bearer <API_KEY>` and a JSON body
(`Content-Type: application/json`).

## POST /log — append one entry (same body as the form's JSON box)

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

- `activity`: `work`, `hmwk`, `workout`, `walk` or `rest` (naps, breaks, lying down)
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

### life: wake up

```json
{ "kind": "wake", "text": null }
```

Send this when Myles wakes up (with `at` if he tells you later, e.g. "woke
up at 7:10"). Sleep hours are calculated from the previous night's
`bedtime` habit to this wake-up, so log `bedtime` when he goes to sleep.

### life: headaches

```json
{ "kind": "headache", "severity": 5, "text": "behind eyes since lunch" }
```

`severity` is 0-10 (use the same scale as stomach pain; estimate if he doesn't
give a number). Log `"severity": 0` when he says the headache is gone or he
has none.

### life: missed habits

```json
{ "kind": "miss", "habit": "sunscreen", "text": "forgot" }
```

When Myles says he skipped or forgot a habit. `habit` uses the same names
as the habits list above. One per habit.

### life: XP

```json
{ "kind": "xp", "amount": 10, "reason": "finished history hmwk" }
```

Whenever you award Myles XP, log it here. `amount` is a number (negative
to take XP away). The dashboard adds it up per day and in total.

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
| "woke up 7:10, slight headache" | life `{kind:"wake"}` with `at` 07:10 **and** life `{kind:"headache", severity:3, text:"slight"}` |
| "forgot sunscreen" | life `{kind:"miss", habit:"sunscreen", text:"forgot"}` |
| "did skincare, skin looking clear today" | life `{kind:"habit", habit:"pm_skincare", value:null}` **and** skin `{kind:"routine", text:"skincare, looking clear", severity:1}` |

## Non-goals

- Single user (Myles), no accounts.
- XP is awarded by Instinct and logged as `{kind:"xp"}` entries. Levels and
  streaks are calculated by the dashboard.
