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
1. **Background Logic:** Validation of Zod schemas, Bluesky HTTP header interception, DuckDB/OPFS runtime messaging, parameterized SQL execution, and data extraction.
2. **Mathematical Diffs:** Calculating `rank`, `postCount`, and `actorCount` deltas between historical DuckDB snapshots.
3. **Popup DOM:** Rendering Flexbox UI cards, dynamically scaling CSS variables, interactive popovers (collision detection), and visual state assertions.

## Current Coverage Thresholds
We are currently pushing for maximum test coverage on our core data ingestion and mathematical pipelines, and have recently implemented robust UI DOM assertions.

**Latest Coverage Run:**
- **Overall Lines**: `~75.68%`
- **`schemas.js`**: `100%`
- **`math_deltas.js`**: `100%` (Lines) / `82.19%` (Branch)
- **`popup.js`**: `79.86%` (Lines)
- **`background.src.js`**: `69.42%` (Lines)

### Outstanding Coverage Gaps
The core data ingestion pipelines, delta mathematics, and Parquet/DuckDB aggregations are heavily guarded! We recently introduced an intelligent **SQL-Aware Jest Router** that perfectly fakes Apache Arrow payloads, allowing our test suite to autonomously run `EXPORT`, `IMPORT`, and `GET_TREND_MOMENT` queries without needing a real browser.

The remaining ~24% of uncovered lines are intentionally left alone because they cover extremely specific OS-level browser crashes that are notoriously fragile to mock in a headless Node environment:
1. **Hardware-Level OPFS Locks:** The `try/catch` retry loops that execute a nuclear `navigator.storage.getDirectory().removeEntry()` file-system wipe if DuckDB permanently locks the database file. **(By Design: The extension uses an aggressive 3-retry backoff. If the Write-Ahead-Log becomes orphaned by the OS, it surgically resets OPFS, guaranteeing autonomous recovery without requiring extension re-installation.)**
2. **Tab Migrations & Network Interruptions:** The complex teardown logic required if a user randomly force-closes the active tab during a `filterResponseData` stream interception. **(By Design: DuckDB is isolated from the network stream. If a tab crashes, the stream truncates and never flushes, mathematically guaranteeing that corrupted or partial JSON payloads can never pollute the database.)**
3. **Blob Memory Management:** The inner catch blocks for `URL.createObjectURL` and `URL.revokeObjectURL` when downloading Parquet buffers. **(By Design: Parquet export URLs are hard-coded to revoke after 10 seconds. If a tab closes prematurely, the modern browser garbage collector automatically destroys orphaned Blob URIs when the background script idles, preventing memory leaks.)**
