# Tangible Analytics Architecture & UX Specification

**Purpose:** Shift the Soma / Life dashboard from passive reporting ("what happened") to **tangible, actionable decision intelligence** ("what to do, what to avoid, and what creates your best days").

---

## 1. Core Principles of "Tangible" Analytics

1. **Decisions Over Raw Metrics:** Instead of showing `r = 0.42`, show `"Eating dairy adds +3.2 stomach discomfort ~24 hours later (85% certainty across 14 logs)"`.
2. **The Blueprint Over Averages:** Don't just show averages—reverse-engineer Myles's top 10% peak days to deliver a concrete recipe for feeling great.
3. **Ripple Effects & Compounding:** Show how habits in the morning directly influence skin and stomach outcomes 24–48 hours later.
4. **Frictionless Real-World Application:** Everything connects to simple daily choices (what to eat for dinner, when to stop studying, which habit to prioritize when tired).

---

## 2. The Four Tangible Analytics Modules

### Module 1: The "Optimal Day Blueprint" (Peak Days vs. Flare Days)
- **Concept:** Contrast Myles's best days (0 pain, 0 acne, high energy/XP) against flare days.
- **Tangible Output:**
  - Optimal Sleep Window (e.g. `7.7 – 8.5 hrs`)
  - Hydration Threshold (e.g. `≥ 7 glasses`)
  - Homework Cutoff Hour (e.g. `Stop before 7:30 PM`)
  - Safe Movement (e.g. `15+ min walk`)
- **UX Element:** A side-by-side comparison slider and a 1-click "Blueprint Checklist".

### Module 2: The Kitchen Compass (Safe Foods vs. Trigger Radar)
- **Concept:** Classify foods into 3 clear operational buckets based on the lag correlation engine:
  - 🟢 **Safe Baselines:** Eaten 5+ times with zero subsequent pain/acne spikes (e.g., Oatmeal, Salmon, Rice, Berries).
  - 🟡 **Watchlist / Early Signal:** 2–3 logs showing mild discomfort (+1 to +2).
  - 🔴 **Confirmed Triggers:** High confidence flare drivers (+3+ severity within 24–48h).
- **Tangible Output:** Real-time "Flare Recovery Clock" (e.g. "Trigger eaten yesterday at 1:00 PM — inflammation window clears in ~6 hours").

### Module 3: Habit Ripple Effect & Multiplier Matrix
- **Concept:** Track pairwise habit synergies.
- **Tangible Output:**
  - *"AM Skincare + Sunscreen reduces breakout duration from 3.5 days to 1.2 days."*
  - *"Walking for 20m adds ~45m to subsequent night sleep and cuts stomach pain by 35%."*
- **UX Element:** Compounding impact cards showing ROI on each habit.

### Module 4: Focus Stamina & Energy Curve (Time Analytics)
- **Concept:** Turn session start/end and duration data into cognitive energy patterns.
- **Tangible Output:**
  - **Peak Output Zone:** Identify the prime study window (e.g. 10:00 AM – 2:00 PM).
  - **Fatigue Cliff:** Highlight session duration limits (e.g. "Focus drops sharply after 75 minutes of continuous study").
  - **Subject Velocity:** Compare pace and mood across History, Math, Science, and English.

---

## 3. Agent Responsibilities & Deliverables

- **Claude (Backend Engine):** Build the analytical aggregation pipelines and endpoints in `backend/src/` to compute blueprints, safe food baselines, habit synergies, and stamina curves.
- **GPT (Frontend UX):** Design and build the visual interactive components in `public/` (Blueprint card, Kitchen Compass, Ripple Effect cards, and Quest Board integration).
