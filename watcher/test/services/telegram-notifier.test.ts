/**
 * TelegramNotifier Tests
 *
 * @behavior Sends PR review notifications to Telegram
 * @acceptance-criteria AC-TELEGRAM-NOTIFIER.1 through AC-TELEGRAM-NOTIFIER.5
 * @business-rule PR review notifications are sent when changes are requested
 * @boundary HTTP client to telegram-bridge or direct Telegram API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramNotifier, PRReviewInfo } from '../../src/services/telegram-notifier.js';

// Mock global fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TelegramNotifier', () => {
  let notifier: TelegramNotifier;
  const testBridgeUrl = 'http://localhost:3737';

  beforeEach(() => {
    notifier = new TelegramNotifier(testBridgeUrl);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendPRReviewNotification', () => {
    /**
     * @behavior Sends formatted PR review notification via HTTP POST
     * @acceptance-criteria AC-TELEGRAM-NOTIFIER.1
     */
    it('should make HTTP POST request to telegram-bridge service', async () => {
      // GIVEN - A PR review info object
      const reviewInfo: PRReviewInfo = {
        prNumber: 123,
        prTitle: 'Add user authentication',
        reviewerName: 'alice',
        reviewBody: 'Please fix the type error on line 42',
      };

      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      // WHEN - We send the notification
      await notifier.sendPRReviewNotification(reviewInfo);

      // THEN - Should have made a POST request to the bridge URL
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(testBridgeUrl),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    /**
     * @behavior Sends formatted message in request body
     * @acceptance-criteria AC-TELEGRAM-NOTIFIER.2
     */
    it('should send formatted message in request body', async () => {
      // GIVEN - A PR review info object
      const reviewInfo: PRReviewInfo = {
        prNumber: 42,
        prTitle: 'Fix login bug',
        reviewerName: 'bob',
        reviewBody: 'Missing null check',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      // WHEN - We send the notification
      await notifier.sendPRReviewNotification(reviewInfo);

      // THEN - Request body should contain the message
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.message).toBeDefined();
      expect(body.message).toContain('PR #42');
      expect(body.message).toContain('Fix login bug');
      expect(body.message).toContain('bob');
    });

    /**
     * @behavior Throws error on HTTP failure
     * @acceptance-criteria AC-TELEGRAM-NOTIFIER.3
     */
    it('should throw error when HTTP request fails', async () => {
      // GIVEN - A PR review info and a failing response
      const reviewInfo: PRReviewInfo = {
        prNumber: 1,
        prTitle: 'Test',
        reviewerName: 'tester',
        reviewBody: 'Test body',
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // WHEN/THEN - Should throw an error
      await expect(notifier.sendPRReviewNotification(reviewInfo)).rejects.toThrow();
    });

    /**
     * @behavior Throws error on network failure
     * @acceptance-criteria AC-TELEGRAM-NOTIFIER.4
     */
    it('should throw error on network failure', async () => {
      // GIVEN - A PR review info and a network error
      const reviewInfo: PRReviewInfo = {
        prNumber: 1,
        prTitle: 'Test',
        reviewerName: 'tester',
        reviewBody: 'Test body',
      };

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // WHEN/THEN - Should propagate the error
      await expect(notifier.sendPRReviewNotification(reviewInfo)).rejects.toThrow('Network error');
    });
  });

  describe('formatReviewMessage', () => {
    /**
     * @behavior Formats message with PR number, title, reviewer, and body
     * @acceptance-criteria AC-TELEGRAM-NOTIFIER.5
     */
    it('should format message with all PR review details', () => {
      // GIVEN - PR review info
      const reviewInfo: PRReviewInfo = {
        prNumber: 123,
        prTitle: 'Add user authentication',
        reviewerName: 'alice',
        reviewBody: 'Please fix the type error on line 42',
      };

      // WHEN - We format the message
      const message = notifier.formatReviewMessage(reviewInfo);

      // THEN - Should contain all required elements with emojis
      expect(message).toContain('Changes Requested');
      expect(message).toContain('PR #123');
      expect(message).toContain('Add user authentication');
      expect(message).toContain('alice');
      expect(message).toContain('Please fix the type error on line 42');
    });

    /**
     * @behavior Truncates long review body with ellipsis
     * @acceptance-criteria AC-TELEGRAM-NOTIFIER.6
     */
    it('should truncate review body longer than 200 characters', () => {
      // GIVEN - PR review with very long body
      const longBody = 'A'.repeat(250);
      const reviewInfo: PRReviewInfo = {
        prNumber: 99,
        prTitle: 'Big change',
        reviewerName: 'reviewer',
        reviewBody: longBody,
      };

      // WHEN - We format the message
      const message = notifier.formatReviewMessage(reviewInfo);

      // THEN - Body should be truncated with ellipsis
      expect(message).not.toContain(longBody);
      expect(message).toContain('...');
      // Should contain first 200 chars
      expect(message).toContain('A'.repeat(200));
    });

    /**
     * @behavior Uses emojis for visual distinction
     * @acceptance-criteria AC-TELEGRAM-NOTIFIER.7
     */
    it('should use emojis for visual distinction', () => {
      // GIVEN - PR review info
      const reviewInfo: PRReviewInfo = {
        prNumber: 1,
        prTitle: 'Test',
        reviewerName: 'tester',
        reviewBody: 'Fix this',
      };

      // WHEN - We format the message
      const message = notifier.formatReviewMessage(reviewInfo);

      // THEN - Should contain appropriate emojis
      // Red circle for changes requested
      expect(message).toMatch(/[\u{1F534}\u{1F6D1}\u{274C}]/u); // Red circle, stop sign, or X
    });

    /**
     * @behavior Handles empty review body gracefully
     * @acceptance-criteria AC-TELEGRAM-NOTIFIER.8
     */
    it('should handle empty review body', () => {
      // GIVEN - PR review with empty body
      const reviewInfo: PRReviewInfo = {
        prNumber: 5,
        prTitle: 'Quick fix',
        reviewerName: 'bob',
        reviewBody: '',
      };

      // WHEN - We format the message
      const message = notifier.formatReviewMessage(reviewInfo);

      // THEN - Should not throw and should have valid format
      expect(message).toContain('PR #5');
      expect(message).toContain('Quick fix');
      expect(message).toContain('bob');
    });
  });
});
