import { state } from './state.js';

export async function bootstrapAppPassword() {
  const data = await browser.storage.local.get(["bskyHandle", "bskyPassword"]);
  if (data.bskyHandle && data.bskyPassword) {
    try {
      const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          identifier: data.bskyHandle,
          password: data.bskyPassword
        })
      });
      if (res.ok) {
        const session = await res.json();
        state.appPasswordHeaders = {
          'Authorization': `Bearer ${session.accessJwt}`,
          'Accept': 'application/json'
        };
        console.log(`[${new Date().toISOString()}] [Auth] App Password authentication successful. Switching to autonomous mode.`);
      } else {
        console.warn(`[${new Date().toISOString()}] [Auth] App Password authentication failed (${res.status}). Falling back to passive sniffing.`);
        state.appPasswordHeaders = null;
      }
    } catch (e) {
      console.warn(`[${new Date().toISOString()}] [Auth] App Password network error. Falling back to passive sniffing.`);
      state.appPasswordHeaders = null;
    }
  } else {
    state.appPasswordHeaders = null;
  }
}

export async function fetchWithAuth(url) {
  let headersToUse = state.appPasswordHeaders || state.activeAuthHeaders;
  if (!headersToUse) {
    throw new Error("[Auth] Warning: No active Bearer token. Please configure an App Password or wait for bootstrap.");
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: headersToUse
  });
  if (response.status === 401 || response.status === 403) {
    if (state.appPasswordHeaders && headersToUse === state.appPasswordHeaders) {
      state.appPasswordHeaders = null;
      bootstrapAppPassword(); // Try to renew it asynchronously
      throw new Error(`[Auth] Warning: App Password session expired (${response.status}). Attempting re-auth and falling back to passive capability.`);
    } else {
      state.activeAuthHeaders = null; // Force the passive listener to parse the very next request
      throw new Error(`[Auth] Warning: API returned ${response.status}. The Bearer token is stale. Purging token to re-enter bootstrap mode.`);
    }
  }
  return response.json();
}
