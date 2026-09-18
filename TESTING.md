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
We are currently pushing for maximum test coverage across the entire extension. 

**Latest Coverage Run:**
- **Overall Lines**: `72.30%` (70.37% Statements)
- **`schemas.js`**: `100%`
- **`math_deltas.js`**: `100%` (Lines) / `78.94%` (Branch)
- **`popup.js`**: `82.29%` (Lines)
- **`background.src.js`**: `61.66%` (Lines)

### Outstanding Coverage Gaps
The remaining 28% of the codebase is heavily locked behind JSDOM limitations and browser API sandboxes that are intensely difficult to mock:
1. **DuckDB Parquet Extraction:** Export logic relying on complex Blob buffering and the OPFS file handle system.
2. **WebExtension Script Injections:** The monitor loop triggers `chrome.tabs.executeScript` injections into the active tab which cannot be cleanly executed inside a JSDOM environment.
3. **`crypto.subtle.digest` Hashes:** Generating SHA-1 hashes of HTTP payloads is currently failing because JSDOM creates read-only getters for `global.crypto` that crash Jest overrides.
4. **Popup `requestAnimationFrame` Loops:** JSDOM does not natively simulate a rendering pipeline, making smooth scrolling animation branch coverage impossible without massive polyfills.
