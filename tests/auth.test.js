import { bootstrapAppPassword, fetchWithAuth } from '../src/background/auth.js';
import { state } from '../src/background/state.js';

describe('auth.js', () => {
  beforeEach(() => {
    // Reset state
    state.appPasswordHeaders = null;
    state.activeAuthHeaders = null;

    // Reset mocks
    global.fetch = jest.fn();
    global.browser = {
      storage: {
        local: {
          get: jest.fn()
        }
      }
    };
    
    // Silence console warnings in tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('bootstrapAppPassword', () => {
    it('sets appPasswordHeaders on 200 OK', async () => {
      global.browser.storage.local.get.mockResolvedValue({ bskyHandle: 'test', bskyPassword: 'pass' });
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessJwt: 'token' })
      });

      await bootstrapAppPassword();

      expect(state.appPasswordHeaders).toEqual({
        'Authorization': 'Bearer token',
        'Accept': 'application/json'
      });
    });

    it('sets appPasswordHeaders to null on non-200', async () => {
      global.browser.storage.local.get.mockResolvedValue({ bskyHandle: 'test', bskyPassword: 'pass' });
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401
      });
      state.appPasswordHeaders = { test: 1 };

      await bootstrapAppPassword();

      expect(state.appPasswordHeaders).toBeNull();
    });

    it('sets appPasswordHeaders to null on network error', async () => {
      global.browser.storage.local.get.mockResolvedValue({ bskyHandle: 'test', bskyPassword: 'pass' });
      global.fetch.mockRejectedValue(new Error('network error'));
      state.appPasswordHeaders = { test: 1 };

      await bootstrapAppPassword();

      expect(state.appPasswordHeaders).toBeNull();
    });

    it('sets appPasswordHeaders to null if handle/password are missing', async () => {
      global.browser.storage.local.get.mockResolvedValue({});
      state.appPasswordHeaders = { test: 1 };

      await bootstrapAppPassword();

      expect(state.appPasswordHeaders).toBeNull();
    });
  });

  describe('fetchWithAuth', () => {
    it('throws if no headers are available', async () => {
      await expect(fetchWithAuth('http://example.com')).rejects.toThrow("[Auth] Warning: No active Bearer token");
    });

    it('fetches successfully with activeAuthHeaders', async () => {
      state.activeAuthHeaders = { 'Authorization': 'Bearer token' };
      global.fetch.mockResolvedValue({
        status: 200,
        json: async () => ({ data: 'ok' })
      });

      const res = await fetchWithAuth('http://example.com');
      expect(res).toEqual({ data: 'ok' });
      expect(global.fetch).toHaveBeenCalledWith('http://example.com', {
        method: 'GET',
        headers: state.activeAuthHeaders
      });
    });

    it('re-bootstraps on 401 with appPasswordHeaders', async () => {
      state.appPasswordHeaders = { 'Authorization': 'Bearer token' };
      global.fetch.mockResolvedValueOnce({
        status: 401,
      });
      global.browser.storage.local.get.mockResolvedValue({ bskyHandle: 'test', bskyPassword: 'pass' });
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessJwt: 'new_token' })
      }); // For bootstrapAppPassword

      await expect(fetchWithAuth('http://example.com')).rejects.toThrow("[Auth] Warning: App Password session expired");
      expect(state.appPasswordHeaders).toBeNull(); 
      
      await new Promise(r => setTimeout(r, 10)); 
      expect(state.appPasswordHeaders).toEqual({
        'Authorization': 'Bearer new_token',
        'Accept': 'application/json'
      });
    });

    it('purges activeAuthHeaders on 403 when not using appPasswordHeaders', async () => {
      state.activeAuthHeaders = { 'Authorization': 'Bearer token' };
      global.fetch.mockResolvedValue({
        status: 403,
      });

      await expect(fetchWithAuth('http://example.com')).rejects.toThrow("[Auth] Warning: API returned 403");
      expect(state.activeAuthHeaders).toBeNull();
    });
  });
});
