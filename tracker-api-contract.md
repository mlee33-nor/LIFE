# Tracker Logging API — Instructions for Hermes

Hermes (Myles's AI message agent) logs tracker entries live as Myles texts
updates, e.g. "started history hmwk", "had a burrito", "stomach hurts, like
a 6". Each message becomes one or more `POST /log` calls. The dashboard reads
the same data, so **use the exact shapes below**. Anything else is stored but
won't show up on the dashboard.

## Connection

- Base URL: `https://api-production-2ace4.up.railway.app`
- Timezone: **America/Phoenix** (UTC-7, no daylight saving)
- API key: shared privately; it is not in this file

## Google Sheet rules (Hermes writes the sheet; the dashboard reads it every minute)

The dashboard reads the **"All events"** tab, plus these side tabs for their
extra columns: **DoorDash**, **Math revisitor**, **Emotion check-ins**,
**Skin** (rows missing from All events are added) and **Food** (pain score
`severity_0_10`, `eaten_at_local`). The Life tab is *not* read, so every Life
row must also be in All events. To keep the numbers right:

1. **One row per thing, one `row_id` each, never reused.** Edit a row in place
   to correct it (e.g. flip a to-do's `status` to `done`) instead of adding a
   second row with a new id for the same thing.
2. **`date` is `YYYY-MM-DD`.** Use `credit_date` when an entry counts toward a
   different day than it happened (e.g. 12:30 AM homework counted for the
   evening before). Times are Phoenix time.
3. **Close every session.** Each `start` needs a matching `end` (or `pause`)
   row with the same `start_at`, plus `end_at` and `minutes_confirmed`. A start
   left `open` for over 16 hours is listed as an unclosed session (see below)
   and never counts. If a session was really only `N` minutes and has no end,
   put `N` in the start row's `minutes_confirmed`.
4. **Wake-ups:** `category=sleep, event=wake` (or `category=wake`) with the wake
   time; put the bedtime in `start_at` and the sleep minutes in
   `minutes_confirmed`. **Bedtime:** `category=sleep, event=sleep` (or `bed`).
5. **Homework subject = the session `label`** ("Math", "History", "Geology").
   Calculus counts toward a Math goal and Geology toward Science. A standing
   daily target is `category=goal, event=daily_target`, `value` = minutes.
6. **Numbers are plain numbers** — format spot counts, minutes and money cells
   as Number, not Time/Date (a 16 formatted as time shows up as `0:00`).
7. **Scores:** stomach pain 0-10 goes in the Food tab's `severity_0_10`; a
   headache score goes in the symptom row's `value`; an acne score uses a Skin
   row labelled `Acne severity` with `value` 0-10.
8. **Exams:** one row per exam: `category=exam`, `label` = its name ("MAT 213
   Midterm"), `value` = its date (YYYY-MM-DD), optional `unit` = subject. Set
   `status=cancelled` if it's called off. The dashboard counts down to it.
9. **Income (RSA, eBay, Upwork):** `tracker=Money`, `category=income`, `label` =
   the job (RSA / eBay / Upwork), `value` = dollars. For a month's total use
   `event=monthly` (the month = the row's `date`, or put `YYYY-MM` in `unit`);
   for one payment or sale use `event=payment` / `sale`. eBay amounts are
   profit. A month total replaces that job's single payments for the month.
10. **Check your work:** `GET /api/sync/issues` lists rows the dashboard couldn't
   read (`skipped`, with the reason) and sessions that were started but never
   ended (`unclosed_sessions`). Fix those rows in the sheet.

Useful read-only endpoints for texting Myles: `GET /api/nudges` (what's off track right now; send its `text` during the day), `GET /api/countdown`, `GET /api/caffeine`, `GET /api/recap` (today's
recap; `?date=YYYY-MM-DD` for another day), `GET /api/report/weekly` (the
week, plain text), `GET /api/streaks`, `GET /api/revisit` (open math
problems), `GET /api/doordash`.

## Using the browser form (for Hermes)

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

### Sending face photos (acne tracker)

**Whenever Myles sends a face photo, upload the actual image** so it shows up
on the dashboard. Links into Hermes's own file storage don't work, because
the dashboard can't open them.

- **Browser form:** on `/submit`, attach the image in the **Photo** field
  (`#photo`), put e.g. `Face photo front` / `left` / `right` in **Photo label**
  (`#photo_label`), and submit. The JSON box can be left empty, or used at the
  same time for a skin note like
  `{"tracker":"skin","data":{"kind":"note","text":"two new spots on chin","severity":4}}`.
- **HTTP:** `POST /photos?label=Face%20photo%20front` with the raw image as the
  body (`Content-Type: image/jpeg` or `image/png`), or `POST /photos` with JSON
  `{"url": "<public image link>", "label": "Face photo front"}`.

Label each face photo with its angle (`Face photo front` / `left` / `right`):
**front** = facing the camera, **left** = head turned so the left cheek
shows, **right** = right cheek shows. The before/after slider compares photos
by these angles, so a wrong label compares a front shot to a side shot.

Uploading the same image twice is harmless (it's detected and not duplicated).
Photos appear on the day they're uploaded unless you pass `at`.

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

### life: to-dos (the dashboard's daily to-do list)

When Myles says "add to my to-dos: …", "remind me to …" or "I finished …":

**In the Google Sheet (preferred):** add one row per task to **All events**:

| column | value |
|---|---|
| `row_id` | stable and unique, e.g. `todo-20260929-1` (never reuse) |
| `date` | the day the task is for, `YYYY-MM-DD` |
| `tracker` / `category` / `event` | `Life` / `todo` / `task` |
| `label` | the task, e.g. `Finish calculus problem set` |
| `value` | priority: `high`, `normal` (default) or `low` |
| `status` | `open`, then change **the same row** to `done` or `skipped` |
| `notes` | optional details |

To complete or edit a task, **update its existing row** (status/label). Don't
add a second row. Unfinished tasks automatically carry over to later days on the
dashboard, so only add a task again if Myles wants it on a new day explicitly.

**Or via the form/API:**
`{"tracker":"life","data":{"kind":"todo","todo_id":"todo-20260929-1","text":"Finish calculus problem set","status":"open","priority":"high"}}`
and later the same `todo_id` with `"status":"done"`.

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
- XP is awarded by Hermes and logged as `{kind:"xp"}` entries. Levels and
  streaks are calculated by the dashboard.
