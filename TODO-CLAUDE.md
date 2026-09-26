# Tangible Analytics Backend Directives — Claude

**Priority:** Feature Expansion — Tangible Analytics API  
**Reference Document:** See [TANGIBLE-ANALYTICS-UX.md](file:///C:/Users/mleet/orca/workspaces/Agent%20testing/Agent3/TANGIBLE-ANALYTICS-UX.md)

---

## Deliverables for Claude

### 1. `GET /api/analytics/blueprint` (Optimal Day Blueprint)
Implement in `backend/src/analytics.js` and expose in `backend/src/index.js`:
- Analyze the top 20% best days (days with `stomach_pain <= 1`, `acne <= 2`, or high wellbeing score) vs. bottom 20% flare days (`stomach_pain >= 4` or `acne >= 5`).
- Compute actionable contrast thresholds:
  * `sleep_range`: Target hours (e.g., `7.5 - 8.5`)
  * `water_target`: Target glasses / ounces
  * `habit_target`: Routine completion target
  * `study_cutoff`: Recommended latest study session end time (e.g., before 8:00 PM)
  * `top_habits_on_best_days`: Habits present on 80%+ of peak days
- Return JSON structure:
  ```json
  {
    "blueprint": {
      "targets": {
        "sleep_hours": { "min": 7.5, "optimal": 8.0, "current_avg": 7.2 },
        "water_glasses": { "min": 7, "optimal": 8, "current_avg": 5.5 },
        "habits_count": { "min": 4, "optimal": 6, "current_avg": 3.8 },
        "study_cutoff_hour": "19:30"
      },
      "contrasts": [
        { "factor": "Sleep", "peak_days_avg": 8.1, "flare_days_avg": 6.1, "unit": "hrs" },
        { "factor": "Hydration", "peak_days_avg": 8.2, "flare_days_avg": 4.5, "unit": "glasses" }
      ]
    }
  }
  ```

### 2. `GET /api/analytics/food-compass` (The Kitchen Compass)
Categorize logged foods using `foodTriggers()` output:
- `safe_foods`: Eaten $\ge 3$ times with subsequent average pain $\le 1.0$ and acne severity $\le 2.0$.
- `confirmed_triggers`: Foods with `difference >= 1.5`, `confidence: "medium"|"high"`, including estimated onset lag (`lag_days`).
- `watchlist`: Foods with fewer logs but early positive pain/acne delta.
- Return structured categories so GPT can render a clear visual grocery/meal guide.

### 3. `GET /api/analytics/focus-curve` (Study & Work Stamina)
Analyze `sessions` from `interpret.js`:
- Group sessions by hour-of-day (0–23) to identify the peak productivity window.
- Calculate average session duration before a long break or fatigue drop.
- Compare subject velocity (e.g., minutes per subject vs. notes/mood).

### 4. Unit Tests
- Add tests in `backend/test/analytics.test.js` validating:
  * Blueprint properly splits peak vs flare days and calculates thresholds.
  * Food compass accurately tags safe foods vs triggers.
  * Empty or single-day states return graceful fallbacks without crashing.
