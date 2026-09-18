---
name: stride-lint
description: >-
  Use this skill to run a STRIDE threat modeling linting pass across the project, generating or updating a STRIDE.md report in the root.
---

# STRIDE Threat Modeling Linter

When the user asks you to run a STRIDE lint, follow these instructions to generate or update the `STRIDE.md` file.

## Objective
Analyze the extension codebase using the STRIDE threat modeling methodology:
- **S**poofing
- **T**ampering
- **R**epudiation
- **I**nformation Disclosure
- **D**enial of Service
- **E**levation of Privilege

## Output Format & Updating Strategy
You must CREATE `STRIDE.md` in the project root if it doesn't exist. If it DOES exist, you MUST NOT rewrite the entire file from scratch. Instead, update it as follows:

1. **Executive Summary & Final Report**: UPDATE this section at the top of the file to reflect the current security posture.
2. **Issue Breakdown**: UPDATE this section with the current, actively unmitigated issues.
3. **Mitigation Analysis**: UPDATE this section with mitigations for currently active issues, or document newly resolved issues.
4. **Appendix (Raw Results)**: DO NOT overwrite the existing appendix. Instead, APPEND your new raw scan logs (with a timestamp) to the bottom of the appendix. This acts as a historical ledger of past issues and mitigations applied.

## Execution Steps

1. **Information Gathering**: Search the codebase for critical security boundaries:
   - Network requests (e.g., `fetch`, `XMLHttpRequest`, `webRequest` listeners)
   - Data storage (e.g., `browser.storage`, OPFS, DuckDB interactions)
   - Input handling and message passing (e.g., `browser.runtime.onMessage`, `postMessage`)
   - Content scripts and background script communications.
2. **STRIDE Analysis**: Map findings to each STRIDE category. Identify potential vectors for each threat type.
3. **Mitigation Research**: Develop pragmatic, functional mitigations for each identified risk. Exclude mitigations that would break existing user flows.
4. **Drafting**: Update `STRIDE.md` by replacing the top sections with fresh analysis, and appending the raw scan results to the Appendix.
