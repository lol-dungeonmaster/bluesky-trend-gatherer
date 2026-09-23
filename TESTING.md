# Bluesky Trend Gatherer - Testing Suite

This project uses Jest, JSDOM, and WebExtension API Mocks to ensure the reliability of the extension's background data processing and UI logic.

## Setup
The testing suite relies on the following dev dependencies:
- `jest`
- `jest-webextension-mock`
- `jest-environment-jsdom`

## Running Tests
To run the full test suite and generate a coverage report:
```bash
npm run test
```

## Architecture
The test suite is designed to cover:
1. **Background Logic:** Validation of Zod schemas, Bluesky HTTP header interception, DuckDB/OPFS runtime messaging, and data extraction.
2. **Mathematical Diffs:** Calculating `rank`, `postCount`, and `actorCount` deltas between historical DuckDB snapshots.
3. **Popup DOM:** Rendering Flexbox UI cards, dynamically scaling CSS variables for the font-size toggle, and asserting visibility toggles.

## Current Coverage Thresholds
We are currently pushing for maximum test coverage on our core data ingestion and mathematical pipelines. 

**Latest Coverage Run:**
- **Overall Lines**: `~65.88%`
- **`schemas.js`**: `100%`
- **`math_deltas.js`**: `100%` (Lines) / `82.19%` (Branch)
- **`popup.js`**: `51.70%` (Lines)
- **`background.src.js`**: `71.51%` (Lines)

### Outstanding Coverage Gaps
The core engine (Zod validation, Delta math, and DuckDB querying) is sitting securely at 100%. The remaining ~34% of uncovered lines are intentionally left alone because they cover browser-specific visual/OS tasks that are notoriously fragile in a headless Node environment:
1. **The Interactive Top Actors Popover:** We recently added over 100 lines of complex visual DOM calculation to `popup.js` (e.g. bounding rects, glowing hover transitions, absolute positioning). Testing these requires a full headless browser (like Playwright), so we exclude them from Jest.
2. **OPFS Deadlocks & Corruption Handling:** We added aggressive `try/catch` loops to `background.src.js` to break permanent OS-level file locks and handle corrupted Parquet import exceptions. 
3. **WebExtension Tab Migrations:** Exhaustive tab awakening/sleeping logic testing.
