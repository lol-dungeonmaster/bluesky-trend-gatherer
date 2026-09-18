# <img src="assets/icon-on.svg" width="40" height="40" alt="Icon" valign="middle" style="margin-right: 8px;"> Bluesky Trend Gatherer

A lightweight, privacy-first Firefox extension designed to archive and analyze temporal trend data from the Bluesky network.

## Design Goal

The primary objective of this project is to enable rich, longitudinal analytics on Bluesky trending topics. Social media trends are highly ephemeral; by capturing and archiving these shifts over time, we can uncover insights about network attention, meme life-cycles, and platform dialogue.

Currently, the extension serves as a robust foundational archiver. It passively gathers data during normal browsing sessions, safely handling temporal deduplication and network syncing, and compiles it into a high-performance local database. Ultimately, the goal is to expand this project to include built-in analytics, live visualization dashboards, and deeper metric tracking.



## Project Structure

<details>
<summary><b>📁 project_root/</b> (Click to expand)</summary>

```text
├── LEXICON.md            <-- Terminology and glossary
├── LICENSE               <-- MIT License
├── README.md             <-- Main project documentation
├── TESTING.md            <-- Test suite documentation & coverage
├── .gitignore            <-- Git ignore rules
├── jest.config.js        <-- Jest testing configuration
├── manifest.json         <-- Core extension config & permissions
├── package-lock.json     <-- Dependency tree lockfile
├── package.json          <-- Node dependencies & build scripts
├── src/                  <-- Core extension logic
│   ├── background.src.js <-- Main DuckDB worker & network listener
│   ├── background.html   <-- Sandbox wrapper for background script
│   ├── popup.js          <-- UI rendering logic & DOM manipulation
│   ├── popup.html        <-- Primary dashboard UI structure
│   ├── options.js        <-- Parquet database export logic
│   ├── options.html      <-- Export settings UI page
│   ├── content.js        <-- Active tab state monitoring
│   ├── math_deltas.js    <-- Trend delta & rank mathematics
│   └── schemas.js        <-- Zod validation & DuckDB tables
├── assets/               <-- Visuals and Icons
│   ├── icon-on.svg       <-- Active state extension icon
│   └── icon-off.svg      <-- Inactive state extension icon
├── lib/                  <-- Static heavy dependencies
│   ├── duckdb-eh.wasm    <-- DuckDB WebAssembly binary engine
│   ├── duckdb-browser.mjs<-- DuckDB JS binding wrapper
│   └── duckdb-browser-eh.worker.js <-- DuckDB web worker
├── dist/                 <-- Esbuild compilation targets
│   └── background.bundle.js <-- Compiled & CSP-scrubbed worker
├── scripts/              <-- Maintenance utilities
│   ├── build.js          <-- Esbuild compilation script
│   ├── zod-config.js     <-- JIT suppression config for Zod
│   └── patch_*.js        <-- Various one-off utility scripts
└── tests/                <-- Jest testing suite
```

</details>

## Features

- **Passive Archival:** Seamlessly captures timeline shifts and trending topics in the background without interrupting your normal browsing experience.
- **Privacy-First Storage:** Avoids third-party analytics platforms or remote servers. All data is processed and stored entirely locally on your machine using an embedded DuckDB database.
- **Export for Data Science:** Instantly export your collected timeline as a compressed `.parquet` file, ready for immediate integration into Jupyter Notebooks, pandas, or other data science workflows.
- **Dynamic Interface:** Features a minimalist popover dashboard that natively adapts to your browser's theme, with a live hover-tooltip for monitoring current session metrics.

---

## 🚀 Installation (For Regular Users)

You don't need any coding experience to install and use this extension!

1. Download or clone this repository to your computer.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click the **Load Temporary Add-on...** button.
4. Select the `manifest.json` file from the downloaded folder.
5. Open a tab to `bsky.app`, click the new extension icon in your toolbar, and toggle it "On" to begin archiving!

---

## 🛠️ Development (For Coders)

If you'd like to fork the repository to build your own analytics features, the source files are ready for development. The extension relies on `esbuild` to bundle DuckDB and Apache Arrow dependencies.

**Setup Instructions:**
1. Ensure you have [Node.js](https://nodejs.org/) installed.
2. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
3. Make your modifications to the core logic in `background.src.js` or the UI in `popup.html`. *(Do not edit `background.bundle.js` directly, as it is auto-generated).*
4. Re-bundle the background script by running:
   ```bash
   npm run build
   ```
5. Reload the extension in Firefox's `about:debugging` page to test your changes.

---

## Exporting Data
To export your collected data for analysis:
1. Go to `about:addons` in Firefox.
2. Find **Bluesky Trend Gatherer** and click the **Preferences/Options** tab.
3. Click the **Export to Parquet** button. Your data will instantly download as a `.parquet` file!

## License
This project is licensed under the MIT License. See the `LICENSE` file for details.
