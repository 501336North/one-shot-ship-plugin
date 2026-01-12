/**
 * ApiTransformer Tests
 *
 * @behavior Anthropic messages are transformed to OpenAI format and vice versa
 * @acceptance-criteria AC-TRANSFORM.1 through AC-TRANSFORM.6
 */

import { describe, it, expect } from 'vitest';
import {
  transformToOpenAI,
  transformFromOpenAI,
  transformStreamChunk,
} from '../../src/services/api-transformer.js';

describe('ApiTransformer - Anthropic to OpenAI', () => {
  describe('transformToOpenAI', () => {
    it('should transform simple message format', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 1024,
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect(openaiRequest.messages[0].role).toBe('user');
      expect(openaiRequest.messages[0].content).toBe('Hello');
      expect(openaiRequest.max_tokens).toBe(1024);
    });

    it('should transform content array to string for text-only messages', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [
          {
            role: 'user' as const,
            content: [{ type: 'text' as const, text: 'Hello world' }],
          },
        ],
        max_tokens: 1024,
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect(openaiRequest.messages[0].content).toBe('Hello world');
    });

    it('should transform tool_use to tool_calls', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [
          {
            role: 'assistant' as const,
            content: [
              {
                type: 'tool_use' as const,
                id: 'tool_1',
                name: 'get_weather',
                input: { city: 'London' },
              },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect(openaiRequest.messages[0].tool_calls).toBeDefined();
      expect(openaiRequest.messages[0].tool_calls![0].id).toBe('tool_1');
      expect(openaiRequest.messages[0].tool_calls![0].function.name).toBe(
        'get_weather'
      );
      expect(openaiRequest.messages[0].tool_calls![0].function.arguments).toBe(
        JSON.stringify({ city: 'London' })
      );
    });

    it('should transform tool_result to tool role message', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: 'tool_1',
                content: 'Sunny, 72F',
              },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect(openaiRequest.messages[0].role).toBe('tool');
      expect(openaiRequest.messages[0].tool_call_id).toBe('tool_1');
      expect(openaiRequest.messages[0].content).toBe('Sunny, 72F');
    });

    it('should drop anthropic-specific parameters', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 1024,
        metadata: { user_id: 'xxx' }, // Anthropic-specific
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect((openaiRequest as Record<string, unknown>).metadata).toBeUndefined();
    });

    it('should transform system parameter to system message', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        system: 'You are a helpful assistant',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 1024,
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect(openaiRequest.messages[0].role).toBe('system');
      expect(openaiRequest.messages[0].content).toBe(
        'You are a helpful assistant'
      );
      expect(openaiRequest.messages[1].role).toBe('user');
    });

    it('should transform tools to OpenAI function format', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 1024,
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather',
            input_schema: {
              type: 'object' as const,
              properties: {
                city: { type: 'string', description: 'City name' },
              },
              required: ['city'],
            },
          },
        ],
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect(openaiRequest.tools).toBeDefined();
      expect(openaiRequest.tools![0].type).toBe('function');
      expect(openaiRequest.tools![0].function.name).toBe('get_weather');
      expect(openaiRequest.tools![0].function.parameters).toEqual({
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      });
    });

    it('should preserve temperature and top_p', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.9,
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect(openaiRequest.temperature).toBe(0.7);
      expect(openaiRequest.top_p).toBe(0.9);
    });

    it('should set stream parameter correctly', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 1024,
        stream: true,
      };

      const openaiRequest = transformToOpenAI(anthropicRequest);

      expect(openaiRequest.stream).toBe(true);
    });
  });
});

describe('ApiTransformer - OpenAI to Anthropic Response', () => {
  describe('transformFromOpenAI', () => {
    it('should transform simple response format', () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant' as const, content: 'Hello!' },
            finish_reason: 'stop' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const anthropicResponse = transformFromOpenAI(openaiResponse);

      expect(anthropicResponse.content[0].type).toBe('text');
      expect((anthropicResponse.content[0] as { text: string }).text).toBe(
        'Hello!'
      );
      expect(anthropicResponse.usage.input_tokens).toBe(10);
      expect(anthropicResponse.usage.output_tokens).toBe(5);
    });

    it('should transform tool_calls to tool_use blocks', () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: { name: 'search', arguments: '{"q":"test"}' },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const anthropicResponse = transformFromOpenAI(openaiResponse);

      expect(anthropicResponse.content[0].type).toBe('tool_use');
      const toolUse = anthropicResponse.content[0] as {
        type: 'tool_use';
        id: string;
        name: string;
        input: Record<string, unknown>;
      };
      expect(toolUse.id).toBe('call_1');
      expect(toolUse.name).toBe('search');
      expect(toolUse.input).toEqual({ q: 'test' });
    });

    it('should transform finish_reason correctly', () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant' as const, content: 'Done' },
            finish_reason: 'stop' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const anthropicResponse = transformFromOpenAI(openaiResponse);

      expect(anthropicResponse.stop_reason).toBe('end_turn');
    });

    it('should handle length finish reason', () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant' as const, content: 'Truncated...' },
            finish_reason: 'length' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
      };

      const anthropicResponse = transformFromOpenAI(openaiResponse);

      expect(anthropicResponse.stop_reason).toBe('max_tokens');
    });

    it('should handle tool_calls finish reason', () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function' as const,
                  function: { name: 'test', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const anthropicResponse = transformFromOpenAI(openaiResponse);

      expect(anthropicResponse.stop_reason).toBe('tool_use');
    });

    it('should include model in response', () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o-2024-08-06',
        choices: [
          {
            index: 0,
            message: { role: 'assistant' as const, content: 'Hello' },
            finish_reason: 'stop' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const anthropicResponse = transformFromOpenAI(openaiResponse);

      expect(anthropicResponse.model).toBe('gpt-4o-2024-08-06');
    });

    it('should generate unique id for response', () => {
      const openaiResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant' as const, content: 'Hello' },
            finish_reason: 'stop' as const,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const anthropicResponse = transformFromOpenAI(openaiResponse);

      expect(anthropicResponse.id).toBeDefined();
      expect(anthropicResponse.id.startsWith('msg_')).toBe(true);
    });
  });

  describe('transformStreamChunk', () => {
    it('should transform content delta chunk', () => {
      const chunk = 'data: {"choices":[{"delta":{"content":"Hi"}}]}';

      const transformed = transformStreamChunk(chunk);

      expect(transformed).toContain('"type":"content_block_delta"');
      expect(transformed).toContain('"text":"Hi"');
    });

    it('should handle [DONE] marker', () => {
      const chunk = 'data: [DONE]';

      const transformed = transformStreamChunk(chunk);

      expect(transformed).toContain('"type":"message_stop"');
    });

    it('should handle empty delta', () => {
      const chunk = 'data: {"choices":[{"delta":{}}]}';

      const transformed = transformStreamChunk(chunk);

      // Should return empty or skip message
      expect(transformed).toBe('');
    });

    it('should handle tool call delta', () => {
      const chunk =
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"test","arguments":"{\\"x\\""}}]}}]}';

      const transformed = transformStreamChunk(chunk);

      expect(transformed).toContain('content_block_delta');
    });

    it('should handle role delta at start of stream', () => {
      const chunk = 'data: {"choices":[{"delta":{"role":"assistant"}}]}';

      const transformed = transformStreamChunk(chunk);

      expect(transformed).toContain('"type":"message_start"');
    });

    it('should preserve SSE format with data: prefix', () => {
      const chunk = 'data: {"choices":[{"delta":{"content":"test"}}]}';

      const transformed = transformStreamChunk(chunk);

      expect(transformed.startsWith('data: ')).toBe(true);
    });
  });
});
