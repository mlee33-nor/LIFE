# Tangible Analytics Frontend UX Directives — GPT

**Priority:** Feature Expansion — Tangible Analytics UX  
**Reference Document:** See [TANGIBLE-ANALYTICS-UX.md](file:///C:/Users/mleet/orca/workspaces/Agent%20testing/Agent3/TANGIBLE-ANALYTICS-UX.md)

---

## Deliverables for GPT

### 1. "The Optimal Day Blueprint" Component (Overview Tab)
- Build an interactive card: **"Your Peak Day Blueprint"**:
  - Displays reverse-engineered targets derived from Myles's top days:
    * 🛌 **Sleep Target:** e.g., `7.8 – 8.5 hrs` (with a pill badge showing whether last night hit the target).
    * 💧 **Hydration Goal:** e.g., `8 glasses` (with real-time progress bar from today's logs).
    * ⏰ **Evening Study Cutoff:** e.g., `Finish by 7:30 PM` for optimal sleep.
  - Interactive toggle: **"Peak vs Flare Comparison"**:
    * Clicking reveals a clean side-by-side contrast (e.g., Sleep: 8.1h on Peak vs 6.1h on Flare; Hydration: 8.2 vs 4.5).

### 2. "The Kitchen Compass" (Safe Foods & Trigger Shelf)
- Enhance the **Discoveries / Patterns** tab with tangible food intelligence:
  - 🟢 **Safe Baselines:** A clean visual shelf of foods tested 3+ times with 0 subsequent flare-ups (e.g., Oatmeal, Salmon, Berries, Rice).
  - 🟡 **Watchlist:** Foods with early mild reactions.
  - 🔴 **Confirmed Triggers:** High-confidence cards with concrete effect sizes (e.g., *"Dairy: +3.2 stomach discomfort after ~24 hours"*).
  - Include an active flare indicator if a trigger food was logged in the past 24 hours.

### 3. "Today's Power Move" Widget (Quest Board Integration)
- In the Player One quest board ([`public/index.html`](file:///C:/Users/mleet/orca/workspaces/Agent%20testing/Agent3/public/index.html)), add a dynamic banner:
  - Highlights the single highest-leverage action Myles can take right now based on today's logged state and the Blueprint.
  - Examples:
    * *"You're 2 glasses of water away from matching your Peak Day Blueprint."*
    * *"Great study block! Take a 15-minute break to stay above your focus stamina curve."*

### 4. Focus Stamina & Peak Window in Life Replay ([`public/life.js`](file:///C:/Users/mleet/orca/workspaces/Agent%20testing/Agent3/public/life.js))
- Add a cognitive energy indicator:
  - Highlight the **Peak Productivity Window** on the 24-hour replay (e.g., a subtle glowing bracket over `10 AM – 2 PM`).
  - Add a **Stamina Advisory** tag on sessions exceeding 75 minutes: *"Sessions >75m showed 35% higher subsequent fatigue"*.

### 5. Fallback & Empty State Support
- Ensure all new widgets render clean, inspiring empty/preview states when the backend API has fewer than 7 days of logs.
