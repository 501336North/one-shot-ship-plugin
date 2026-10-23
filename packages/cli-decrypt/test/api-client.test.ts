/**
 * @behavior API client fetches credentials and encrypted prompts
 * @acceptance-criteria AC-DECRYPT-005
 * @business-rule DECRYPT-005
 * @boundary CLI API Client
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchCredentials, fetchEncryptedPrompt, fetchCustomPrompt } from '../src/api-client.js';

// Keep the real fetch so header-validation tests run undici's own checks
const realFetch = globalThis.fetch;

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchCredentials', () => {
    it('should fetch credentials from API', async () => {
      const mockResponse = {
        userId: 'user_123',
        salt: 'salt_abc',
        hardwareId: 'hw_xyz',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchCredentials(
        'ak_test_key',
        'https://api.example.com',
        'hw_xyz'
      );

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/auth/credentials?hardwareId=hw_xyz',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer ak_test_key',
          }),
        })
      );
    });

    it('should throw on invalid API key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(
        fetchCredentials('invalid_key', 'https://api.example.com', 'hw_xyz')
      ).rejects.toThrow('Unauthorized');
    });

    it('should use custom API URL if configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ userId: 'u', salt: 's', hardwareId: 'h' }),
      });

      await fetchCredentials('ak_test', 'https://custom.api.com', 'hw');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.api.com/api/v1/auth/credentials?hardwareId=hw',
        expect.anything()
      );
    });
  });

  describe('fetchEncryptedPrompt', () => {
    it('should fetch encrypted prompt from commands endpoint', async () => {
      const mockResponse = {
        encrypted: 'enc_data',
        iv: 'iv_data',
        authTag: 'tag_data',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchEncryptedPrompt(
        'ak_test',
        'https://api.example.com',
        'commands',
        'plan'
      );

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/prompts/plan',
        expect.anything()
      );
    });

    it('should fetch encrypted prompt from workflows endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ encrypted: 'e', iv: 'i', authTag: 'a' }),
      });

      await fetchEncryptedPrompt(
        'ak_test',
        'https://api.example.com',
        'workflows',
        'build'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/prompts/workflows/build',
        expect.anything()
      );
    });

    /**
     * @behavior Custom command prompts fetch from /api/v1/prompts/custom/:name
     * @acceptance-criteria AC-CUSTOM-TYPE-002
     * @business-rule CUSTOM-002
     * @boundary CLI API Client
     */
    it('should fetch encrypted prompt from custom commands endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ encrypted: 'e', iv: 'i', authTag: 'a' }),
      });

      await fetchEncryptedPrompt(
        'ak_test',
        'https://api.example.com',
        'custom',
        'review-code-standards'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/api/v1/prompts/custom/review-code-standards',
        expect.anything()
      );
    });

    it('should throw on 404 (prompt not found)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ error: 'Not found' }),
      });

      await expect(
        fetchEncryptedPrompt('ak', 'https://api.example.com', 'commands', 'unknown')
      ).rejects.toThrow('Prompt not found');
    });

    it('should throw on 401 (unauthorized)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(
        fetchEncryptedPrompt('ak', 'https://api.example.com', 'commands', 'plan')
      ).rejects.toThrow('Unauthorized');
    });

    it('should reject an unknown type without sending a request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ encrypted: 'e', iv: 'i', authTag: 'a' }),
      });

      await expect(
        fetchEncryptedPrompt(
          'ak_test',
          'https://api.example.com',
          'x/../../auth/y?' as unknown as 'agents',
          'a'
        )
      ).rejects.toThrow(/Invalid prompt type/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  /**
   * @behavior A prompt or team-command name can only address its own endpoint:
   *   `?`, `=` and `#` in a name never add a query string or fragment to a keyed request
   *   (`/` and `..` are refused before any request by validateName - see the dot-segment suite)
   * @business-rule DECRYPT-005 (names are URL-encoded)
   * @boundary CLI API Client
   */
  describe('name encoding', () => {
    const HOSTILE = 'b?x=1#y';
    const ENCODED = 'b%3Fx%3D1%23y';

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ encrypted: 'e', iv: 'i', authTag: 'a', prompt: 'p', name: 'n', displayName: 'd', isBlocking: false }),
      });
    });

    it('fetchCustomPrompt should encode the name', async () => {
      await fetchCustomPrompt('ak_test', 'https://api.example.com', HOSTILE);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.example.com/api/v1/prompts/custom/${ENCODED}`,
        expect.anything()
      );
    });

    it('fetchEncryptedPrompt should encode the name for commands', async () => {
      await fetchEncryptedPrompt('ak_test', 'https://api.example.com', 'commands', HOSTILE);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.example.com/api/v1/prompts/${ENCODED}`,
        expect.anything()
      );
    });

    it('fetchEncryptedPrompt should encode the name for workflows', async () => {
      await fetchEncryptedPrompt('ak_test', 'https://api.example.com', 'workflows', HOSTILE);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.example.com/api/v1/prompts/workflows/${ENCODED}`,
        expect.anything()
      );
    });

    it('fetchEncryptedPrompt should encode the name for a typed path (agents)', async () => {
      await fetchEncryptedPrompt('ak_test', 'https://api.example.com', 'agents', HOSTILE);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.example.com/api/v1/prompts/agents/${ENCODED}`,
        expect.anything()
      );
    });
  });

  /**
   * @behavior A name that is a dot segment (`.`, `..`) or empty never sends the user's key anywhere:
   *   URL parsing would resolve it to a parent API path such as /api/v1/ or /api/v1/prompts/
   * @business-rule KEY-002 (one name rule, shared with the cache: validateName)
   * @boundary CLI API Client
   */
  describe('dot-segment and empty names are refused before any request', () => {
    const REFUSED_NAMES = ['.', '..', ''];
    const ENCRYPTED_TYPES = ['commands', 'workflows', 'agents'] as const;

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ encrypted: 'e', iv: 'i', authTag: 'a', prompt: 'p', name: 'n', displayName: 'd', isBlocking: false }),
      });
    });

    for (const type of ENCRYPTED_TYPES) {
      for (const name of REFUSED_NAMES) {
        it(`fetchEncryptedPrompt (${type}) refuses the name ${JSON.stringify(name)} without a request`, async () => {
          await expect(
            fetchEncryptedPrompt('ak_test', 'https://api.example.com', type, name)
          ).rejects.toThrow(/Invalid prompt name/);
          expect(mockFetch).not.toHaveBeenCalled();
        });
      }
    }

    for (const name of REFUSED_NAMES) {
      it(`fetchCustomPrompt refuses the name ${JSON.stringify(name)} without a request`, async () => {
        await expect(
          fetchCustomPrompt('ak_test', 'https://api.example.com', name)
        ).rejects.toThrow(/Invalid prompt name/);
        expect(mockFetch).not.toHaveBeenCalled();
      });
    }
  });

  /**
   * @behavior The API key is sent only to the configured API URL: a keyed request never follows a redirect
   * @business-rule FOLLOWUPS 46 (keyed fetches use redirect: 'error')
   * @boundary CLI API Client
   */
  describe('keyed requests refuse redirects', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ userId: 'u', salt: 's', hardwareId: 'h', encrypted: 'e', iv: 'i', authTag: 'a', prompt: 'p', name: 'n', displayName: 'd', isBlocking: false }),
      });
    });

    it('fetchCredentials never follows a redirect', async () => {
      await fetchCredentials('ak_test', 'https://api.example.com', 'hw-1');
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
    });

    it('fetchEncryptedPrompt never follows a redirect', async () => {
      await fetchEncryptedPrompt('ak_test', 'https://api.example.com', 'commands', 'build');
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
    });

    it('fetchCustomPrompt never follows a redirect', async () => {
      await fetchCustomPrompt('ak_test', 'https://api.example.com', 'deploy');
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
    });
  });

  /**
   * @behavior A stored API key with a control character never shows up in an error message
   * @business-rule The API key is a secret; errors are printed to stderr and agent transcripts
   */
  describe('API key with an invalid header character', () => {
    const secret = 'secret_marker_123';
    const apiUrl = 'http://127.0.0.1:1';

    beforeEach(() => {
      global.fetch = realFetch;
    });

    afterEach(() => {
      global.fetch = mockFetch;
    });

    const cases: Array<[string, string, (key: string) => Promise<unknown>]> = [
      ['fetchCredentials', '\n', (key) => fetchCredentials(key, apiUrl, 'hw_xyz')],
      ['fetchEncryptedPrompt', '\n', (key) => fetchEncryptedPrompt(key, apiUrl, 'commands', 'plan')],
      ['fetchCustomPrompt', '\n', (key) => fetchCustomPrompt(key, apiUrl, 'deploy')],
      ['fetchCredentials', '\r', (key) => fetchCredentials(key, apiUrl, 'hw_xyz')],
      ['fetchEncryptedPrompt', '\0', (key) => fetchEncryptedPrompt(key, apiUrl, 'commands', 'plan')],
    ];

    it.each(cases)('%s rejects without echoing the key (char %j)', async (_name, ch, call) => {
      const error = await call(`oss_test_${ch}${secret}`).then(
        () => undefined,
        (err: unknown) => err
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).toContain('/oss:login');
    });
  });

  /**
   * @behavior An error text sent by the API cannot drive the user's terminal
   * @business-rule Server-supplied text is printed to stderr; control sequences (colour, OSC 8 links,
   *   BEL, carriage-return overwrite, C1 CSI) are removed while the readable words are kept
   */
  describe('server error text is stripped of terminal control characters', () => {
    const hostile = 'bad\u001b[31mred\u001b]8;;http://x\u0007link\rover\u009b2J';

    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({ error: hostile }),
      });
    });

    const cases: Array<[string, () => Promise<unknown>]> = [
      ['fetchCredentials', () => fetchCredentials('ak_test', 'https://api.example.com', 'hw-1')],
      ['fetchEncryptedPrompt', () => fetchEncryptedPrompt('ak_test', 'https://api.example.com', 'commands', 'build')],
      ['fetchCustomPrompt', () => fetchCustomPrompt('ak_test', 'https://api.example.com', 'deploy')],
    ];

    it.each(cases)('%s throws a message with no control characters', async (_name, call) => {
      const error = await call().then(
        () => undefined,
        (err: unknown) => err
      );
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(message).toContain('bad');
      expect(message).toContain('red');
    });
  });
});
