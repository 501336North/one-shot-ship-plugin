/**
 * @behavior API client fetches credentials and encrypted prompts
 * @acceptance-criteria AC-DECRYPT-005
 * @business-rule DECRYPT-005
 * @boundary CLI API Client
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchCredentials, fetchEncryptedPrompt } from '../src/api-client.js';

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

    it('should throw on 404 (prompt not found)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
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
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(
        fetchEncryptedPrompt('ak', 'https://api.example.com', 'commands', 'plan')
      ).rejects.toThrow('Unauthorized');
    });
  });
});
