// Fills the database with ~45 days of fake events in Muse's shapes (see
// tracker-api-contract.md) so the UI has something to render before real
// data exists. Every sample event has data.sample = true.
//
// Planted patterns: dairy meals -> next-day stomach pain; sweets -> worse
// skin two days later.
//
//   DATABASE_URL=... npm run db:seed-sample            add sample data
//   DATABASE_URL=... npm run db:seed-sample -- --clear remove it again

import { createPool, migrate } from '../src/db.js';

const pool = createPool();
await migrate(pool);

if (process.argv.includes('--clear')) {
  const { rowCount } = await pool.query(`DELETE FROM events WHERE data->>'sample' = 'true'`);
  console.log(`Removed ${rowCount} sample events.`);
  await pool.end();
  process.exit(0);
}

let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];

const BREAKFAST = ['oatmeal with banana', 'eggs and toast', 'yogurt with granola', 'cereal with milk', 'smoothie'];
const LUNCH = ['chicken salad', 'turkey sandwich', 'rice and beans', 'pizza', 'burrito', 'sushi', 'pasta'];
const DINNER = ['salmon rice broccoli', 'steak and potatoes', 'tacos', 'mac and cheese', 'stir fry', 'burger and fries'];
const SNACK = ['ice cream', 'chips', 'apple', 'cheese and crackers', 'chocolate'];
const DAIRY = /milk|yogurt|cheese|ice cream|pizza/;
const SWEET = /ice cream|chocolate/;
const SUBJECTS = ['history', 'science', 'math', 'english'];

// Phoenix is UTC-7 all year.
const at = (date, hhmm) => `${date}T${hhmm}:00-07:00`;
const DAYS = 45;
const events = [];
const add = (tracker, date, hhmm, data) => events.push([tracker, at(date, hhmm), { ...data, sample: true }]);

const todayPhx = new Date(Date.now() - 7 * 3600e3);
let prevDairy = false;
const sweets = [];

for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(Date.UTC(todayPhx.getUTCFullYear(), todayPhx.getUTCMonth(), todayPhx.getUTCDate() - i));
  const date = d.toISOString().slice(0, 10);

  if (rnd() < 0.7) add('life', date, '07:30', { kind: 'habit', habit: 'morning_ritual', value: null });
  if (rnd() < 0.8) add('life', date, '07:45', { kind: 'habit', habit: 'am_skincare', value: null });
  if (rnd() < 0.5) add('life', date, '07:50', { kind: 'habit', habit: 'sunscreen', value: null });

  const meals = [['08:00', pick(BREAKFAST)], ['12:30', pick(LUNCH)], ['19:00', pick(DINNER)]];
  if (rnd() < 0.4) meals.push(['15:30', pick(SNACK)]);
  for (const [t, text] of meals) add('food', date, t, { kind: 'meal', text, pain: null });
  const text = meals.map((m) => m[1]).join(' ');

  for (let w = 0; w < 3 + Math.floor(rnd() * 5); w++) {
    add('life', date, `${String(9 + w * 2).padStart(2, '0')}:10`, { kind: 'habit', habit: 'water', value: 1 });
  }

  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
    const subject = pick(SUBJECTS);
    const len = 30 + Math.floor(rnd() * 60);
    add('life', date, '16:00', { kind: 'session', action: 'start', activity: 'hmwk', subject, minutes: null });
    add('life', date, `${16 + Math.floor(len / 60)}:${String(len % 60).padStart(2, '0')}`,
      { kind: 'session', action: 'end', activity: 'hmwk', subject, minutes: null });
  }
  if (rnd() < 0.5) {
    add('life', date, '18:00', { kind: 'session', action: 'end', activity: 'workout', subject: null, minutes: 30 + Math.floor(rnd() * 40) });
  }

  const pain = Math.min(10, Math.round((prevDairy ? 4 : 1) + rnd() * 3));
  add('food', date, '21:00', { kind: 'pain_report', text: pain >= 5 ? 'bloated, cramps' : 'fine', pain });

  const recentSweets = sweets.slice(-2).some(Boolean);
  const severity = Math.min(10, Math.round((recentSweets ? 5 : 2) + rnd() * 2));
  if (rnd() < 0.85) add('life', date, '22:00', { kind: 'habit', habit: 'pm_skincare', value: null });
  add('skin', date, '22:05', { kind: 'routine', text: 'cleanser + moisturizer', severity });
  add('life', date, '23:00', { kind: 'habit', habit: 'bedtime', value: null });

  prevDairy = DAIRY.test(text);
  sweets.push(SWEET.test(text));
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const [tracker, ts, data] of events) {
    await client.query('INSERT INTO events (tracker, at, data) VALUES ($1, $2, $3)', [tracker, ts, data]);
  }
  await client.query('COMMIT');
  console.log(`Inserted ${events.length} sample events over ${DAYS} days.`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
