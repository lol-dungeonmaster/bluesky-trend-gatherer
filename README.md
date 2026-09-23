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

- **Passive Background Archival:** Seamlessly intercepts Bluesky API traffic (`getTrends`) to capture timeline shifts without making any external network requests or interrupting your browsing experience.
- **Privacy-First DuckDB OPFS:** Avoids third-party analytics entirely. All data is processed and stored locally on your machine using an embedded DuckDB WebAssembly engine running on the Origin Private File System (OPFS).
- **Trend Longevity & Rank Deltas:** Dynamically tracks how long each topic survives in the Top 20 (e.g. `34m in pos`). Computes live statistical diffs to show exactly how many ranks a topic has jumped (`▲3`), how many new posts it gained (`+4.2k`), or if it's completely `New`.
- **Live Actor Cohort Diffing:** Explore key drivers of a trend with a themed popover displaying the "Top Actors". The extension actively tracks cohort shifts: if an actor newly joins the Top 5, they receive a glowing green ring; if they drop out, they are banished to a red-tinted lower row.
- **Data Portability & Import Idempotency:** Instantly export your collected timeline as a compressed `.parquet` file, ready for Jupyter or Pandas. You can also **import** `.parquet` backups directly back into the extension—fortified by rigorous Zod schema validation and idempotent duplicate protection.

---

## 🚀 Installation (For Regular Users)

You don't need any coding experience to install and use this extension!

1. Download or clone this repository to your computer.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click the **Load Temporary Add-on...** button.
4. Select the `manifest.json` file from the downloaded folder.
5. Open a tab to `bsky.app`, click the new extension icon in your toolbar, and toggle it "On" to begin archiving!

> [!WARNING]
> **Data Persistence:** When installed as a "Temporary Add-on" via `about:debugging`, Firefox will **permanently delete** your collected OPFS database whenever the browser is restarted. To keep your data between sessions, you must either frequently use the Export button or install the extension permanently.

<details>
<summary><b>Advanced: Permanent Installation</b> (Click to expand)</summary>

To prevent Firefox from wiping your database on restart, you can permanently install the extension via a packaged `.xpi` file.

1. Generate the `.xpi` file (see the Development section below on how to run `npm run package`), or use an existing one in the `dist/` folder.
2. Open Firefox and navigate to `about:config`.
3. Search for `xpinstall.signatures.required` and double-click it to set it to **`false`**. *(This allows you to install your own unsigned extensions locally).*
4. Navigate to `about:addons`, click the gear icon ⚙️ in the top right, and select **Install Add-on From File...**
5. Select the `dist/bluesky-trend-gatherer.xpi` file and add it to Firefox.

Your database will now safely persist across all browser restarts!
</details>

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
6. To generate a production-ready `.xpi` file for permanent installation, run:
   ```bash
   npm run package
   ```
   *(The final bundled file will be output to `dist/bluesky-trend-gatherer.xpi`)*

---

## Exporting Data
To export your collected data for analysis:
1. Go to `about:addons` in Firefox.
2. Find **Bluesky Trend Gatherer** and click the **Preferences/Options** tab.
3. Click the **Export to Parquet** button. Your data will instantly download as a `.parquet` file!

## License
This project is licensed under the MIT License. See the `LICENSE` file for details.
