/**
 * StreamTransformer Tests
 *
 * @behavior StreamTransformer transforms SSE format between providers
 * @acceptance-criteria AC-STREAM.1 through AC-STREAM.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StreamTransformer } from '../../src/services/stream-transformer.js';

describe('StreamTransformer', () => {
  describe('OpenAI to Anthropic SSE', () => {
    let transformer: StreamTransformer;

    beforeEach(() => {
      transformer = new StreamTransformer('openai');
    });

    it('should transform content delta chunk', () => {
      const openaiChunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}';

      const result = transformer.transform(openaiChunk);

      expect(result).toContain('content_block_delta');
      expect(result).toContain('Hello');
    });

    it('should transform multiple chunks in sequence', () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
      ];

      const results: string[] = [];
      for (const chunk of chunks) {
        const result = transformer.transform(chunk);
        if (result) results.push(result);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toContain('Hello');
      expect(results[1]).toContain(' world');
    });

    it('should handle [DONE] marker', () => {
      const chunk = 'data: [DONE]';

      const result = transformer.transform(chunk);

      expect(result).toContain('message_stop');
    });

    it('should handle role delta at stream start', () => {
      const chunk = 'data: {"choices":[{"delta":{"role":"assistant"}}]}';

      const result = transformer.transform(chunk);

      expect(result).toContain('message_start');
    });

    it('should handle empty delta', () => {
      const chunk = 'data: {"choices":[{"delta":{}}]}';

      const result = transformer.transform(chunk);

      // Empty delta should return empty/null
      expect(result).toBe('');
    });

    it('should preserve SSE data: prefix in output', () => {
      const chunk = 'data: {"choices":[{"delta":{"content":"test"}}]}';

      const result = transformer.transform(chunk);

      expect(result.startsWith('data: ')).toBe(true);
    });

    it('should transform tool call delta', () => {
      const chunk =
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"test","arguments":"{\\"x\\":"}}]}}]}';

      const result = transformer.transform(chunk);

      expect(result).toContain('content_block_delta');
      expect(result).toContain('input_json_delta');
    });
  });

  describe('Partial chunk handling', () => {
    let transformer: StreamTransformer;

    beforeEach(() => {
      transformer = new StreamTransformer('openai');
    });

    it('should handle partial chunks split mid-JSON', () => {
      // First part of chunk
      const partial1 = 'data: {"choices":[{"del';
      // Second part of chunk
      const partial2 = 'ta":{"content":"Hi"}}]}';

      const result1 = transformer.transform(partial1);
      const result2 = transformer.transform(partial2);

      // First should return null (incomplete)
      expect(result1).toBeNull();
      // Second should combine and return valid result
      expect(result2).toContain('Hi');
    });

    it('should handle chunks split at data: prefix', () => {
      const partial1 = 'dat';
      const partial2 = 'a: {"choices":[{"delta":{"content":"test"}}]}';

      const result1 = transformer.transform(partial1);
      const result2 = transformer.transform(partial2);

      expect(result1).toBeNull();
      expect(result2).toContain('test');
    });

    it('should handle multiple complete chunks in single buffer', () => {
      const combined =
        'data: {"choices":[{"delta":{"content":"A"}}]}\n\ndata: {"choices":[{"delta":{"content":"B"}}]}';

      const results = transformer.transformBatch(combined);

      expect(results).toHaveLength(2);
      expect(results[0]).toContain('A');
      expect(results[1]).toContain('B');
    });

    it('should clear buffer after successful parse', () => {
      // Send incomplete, then complete
      transformer.transform('data: {"choices":[{"del');
      transformer.transform('ta":{"content":"Hi"}}]}');

      // Next chunk should start fresh
      const result = transformer.transform(
        'data: {"choices":[{"delta":{"content":"Next"}}]}'
      );

      expect(result).toContain('Next');
      expect(result).not.toContain('Hi');
    });
  });

  describe('Stream end handling', () => {
    let transformer: StreamTransformer;

    beforeEach(() => {
      transformer = new StreamTransformer('openai');
    });

    it('should detect stream completion', () => {
      const doneChunk = 'data: [DONE]';

      const result = transformer.transform(doneChunk);

      expect(result).toContain('message_stop');
      expect(transformer.isComplete()).toBe(true);
    });

    it('should track stream state', () => {
      expect(transformer.isComplete()).toBe(false);

      transformer.transform('data: {"choices":[{"delta":{"content":"Hi"}}]}');
      expect(transformer.isComplete()).toBe(false);

      transformer.transform('data: [DONE]');
      expect(transformer.isComplete()).toBe(true);
    });

    it('should reset state on new stream', () => {
      transformer.transform('data: [DONE]');
      expect(transformer.isComplete()).toBe(true);

      transformer.reset();

      expect(transformer.isComplete()).toBe(false);
    });
  });

  describe('Event ordering', () => {
    let transformer: StreamTransformer;

    beforeEach(() => {
      transformer = new StreamTransformer('openai');
    });

    it('should maintain event index', () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"A"}}]}',
        'data: {"choices":[{"delta":{"content":"B"}}]}',
        'data: {"choices":[{"delta":{"content":"C"}}]}',
      ];

      const results = chunks
        .map((c) => transformer.transform(c))
        .filter((r) => r);

      // All should have incrementing indices
      const indices = results.map((r) => {
        const parsed = JSON.parse(r.replace('data: ', '').trim());
        return parsed.index;
      });

      expect(indices[0]).toBe(0);
      expect(indices[1]).toBe(0);
      expect(indices[2]).toBe(0);
    });

    it('should track content block index', () => {
      // First content block
      transformer.transform(
        'data: {"choices":[{"delta":{"content":"text1"}}]}'
      );

      // Tool call starts new block
      const toolChunk =
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_1","function":{"name":"test"}}]}}]}';
      const result = transformer.transform(toolChunk);

      // Should have different index for tool block
      const parsed = JSON.parse(result.replace('data: ', '').trim());
      expect(parsed.index).toBe(1);
    });
  });

  describe('Error handling', () => {
    let transformer: StreamTransformer;

    beforeEach(() => {
      transformer = new StreamTransformer('openai');
    });

    it('should handle malformed JSON gracefully', () => {
      const badChunk = 'data: {not valid json}';

      // Should not throw
      expect(() => transformer.transform(badChunk)).not.toThrow();

      // Should return empty or buffer it
      const result = transformer.transform(badChunk);
      expect(result === '' || result === null).toBe(true);
    });

    it('should handle unexpected chunk format', () => {
      const unexpectedChunk = 'event: ping\ndata: {}';

      const result = transformer.transform(unexpectedChunk);

      // Should not crash, return empty
      expect(result === '' || result === null).toBe(true);
    });

    it('should handle empty string', () => {
      const result = transformer.transform('');

      expect(result === '' || result === null).toBe(true);
    });
  });

  describe('Gemini to Anthropic SSE', () => {
    let transformer: StreamTransformer;

    beforeEach(() => {
      transformer = new StreamTransformer('gemini');
    });

    it('should transform Gemini streaming chunks', () => {
      const geminiChunk = JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello from Gemini' }],
              role: 'model',
            },
          },
        ],
      });

      const result = transformer.transform(`data: ${geminiChunk}`);

      expect(result).toContain('content_block_delta');
      expect(result).toContain('Hello from Gemini');
    });
  });
});
