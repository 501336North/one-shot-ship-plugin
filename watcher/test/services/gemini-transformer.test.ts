/**
 * GeminiTransformer Tests
 *
 * @behavior Anthropic messages are transformed to Gemini generateContent format
 * @acceptance-criteria AC-GEMINI.1 through AC-GEMINI.4
 */

import { describe, it, expect } from 'vitest';
import {
  transformToGemini,
  transformFromGemini,
  GeminiRequest,
  GeminiResponse,
} from '../../src/services/gemini-transformer.js';

describe('GeminiTransformer', () => {
  describe('transformToGemini', () => {
    it('should transform simple message to Gemini generateContent format', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 1024,
      };

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.contents).toBeDefined();
      expect(geminiRequest.contents[0].role).toBe('user');
      expect(geminiRequest.contents[0].parts[0].text).toBe('Hello');
    });

    it('should handle system prompts as systemInstruction', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        system: 'You are a helpful assistant',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 1024,
      };

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.systemInstruction).toBeDefined();
      expect(geminiRequest.systemInstruction!.parts[0].text).toBe(
        'You are a helpful assistant'
      );
    });

    it('should transform multiple messages correctly', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [
          { role: 'user' as const, content: 'Hello' },
          { role: 'assistant' as const, content: 'Hi there!' },
          { role: 'user' as const, content: 'How are you?' },
        ],
        max_tokens: 1024,
      };

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.contents.length).toBe(3);
      expect(geminiRequest.contents[0].role).toBe('user');
      expect(geminiRequest.contents[1].role).toBe('model');
      expect(geminiRequest.contents[2].role).toBe('user');
    });

    it('should transform assistant role to model role', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [
          { role: 'user' as const, content: 'Hello' },
          { role: 'assistant' as const, content: 'Hi!' },
        ],
        max_tokens: 1024,
      };

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.contents[1].role).toBe('model');
      expect(geminiRequest.contents[1].parts[0].text).toBe('Hi!');
    });

    it('should transform content array with text blocks', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: 'Part 1' },
              { type: 'text' as const, text: 'Part 2' },
            ],
          },
        ],
        max_tokens: 1024,
      };

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.contents[0].parts.length).toBe(2);
      expect(geminiRequest.contents[0].parts[0].text).toBe('Part 1');
      expect(geminiRequest.contents[0].parts[1].text).toBe('Part 2');
    });

    it('should transform tool_use to functionCall', () => {
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

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.contents[0].parts[0].functionCall).toBeDefined();
      expect(geminiRequest.contents[0].parts[0].functionCall!.name).toBe(
        'get_weather'
      );
      expect(geminiRequest.contents[0].parts[0].functionCall!.args).toEqual({
        city: 'London',
      });
    });

    it('should transform tool_result to functionResponse', () => {
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

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.contents[0].parts[0].functionResponse).toBeDefined();
      expect(geminiRequest.contents[0].parts[0].functionResponse!.name).toBe(
        'tool_1'
      );
      expect(
        geminiRequest.contents[0].parts[0].functionResponse!.response
      ).toEqual({ result: 'Sunny, 72F' });
    });

    it('should transform tools to functionDeclarations', () => {
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

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.tools).toBeDefined();
      expect(geminiRequest.tools![0].functionDeclarations).toBeDefined();
      expect(geminiRequest.tools![0].functionDeclarations![0].name).toBe(
        'get_weather'
      );
      expect(
        geminiRequest.tools![0].functionDeclarations![0].description
      ).toBe('Get current weather');
    });

    it('should set generationConfig with maxOutputTokens', () => {
      const anthropicRequest = {
        model: 'claude-3-opus',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 2048,
        temperature: 0.7,
        top_p: 0.9,
      };

      const geminiRequest = transformToGemini(anthropicRequest);

      expect(geminiRequest.generationConfig).toBeDefined();
      expect(geminiRequest.generationConfig!.maxOutputTokens).toBe(2048);
      expect(geminiRequest.generationConfig!.temperature).toBe(0.7);
      expect(geminiRequest.generationConfig!.topP).toBe(0.9);
    });
  });

  describe('transformFromGemini', () => {
    it('should transform simple Gemini response to Anthropic format', () => {
      const geminiResponse: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hello!' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const anthropicResponse = transformFromGemini(geminiResponse);

      expect(anthropicResponse.content[0].type).toBe('text');
      expect((anthropicResponse.content[0] as { text: string }).text).toBe(
        'Hello!'
      );
      expect(anthropicResponse.usage.input_tokens).toBe(10);
      expect(anthropicResponse.usage.output_tokens).toBe(5);
    });

    it('should transform functionCall to tool_use', () => {
      const geminiResponse: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'search',
                    args: { query: 'test' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const anthropicResponse = transformFromGemini(geminiResponse);

      expect(anthropicResponse.content[0].type).toBe('tool_use');
      const toolUse = anthropicResponse.content[0] as {
        type: 'tool_use';
        id: string;
        name: string;
        input: Record<string, unknown>;
      };
      expect(toolUse.name).toBe('search');
      expect(toolUse.input).toEqual({ query: 'test' });
    });

    it('should map STOP finish reason to end_turn', () => {
      const geminiResponse: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Done' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const anthropicResponse = transformFromGemini(geminiResponse);

      expect(anthropicResponse.stop_reason).toBe('end_turn');
    });

    it('should map MAX_TOKENS finish reason to max_tokens', () => {
      const geminiResponse: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Truncated...' }],
            },
            finishReason: 'MAX_TOKENS',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 100,
          totalTokenCount: 110,
        },
      };

      const anthropicResponse = transformFromGemini(geminiResponse);

      expect(anthropicResponse.stop_reason).toBe('max_tokens');
    });

    it('should handle multiple parts in response', () => {
      const geminiResponse: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Part 1' }, { text: 'Part 2' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const anthropicResponse = transformFromGemini(geminiResponse);

      expect(anthropicResponse.content.length).toBe(2);
      expect((anthropicResponse.content[0] as { text: string }).text).toBe(
        'Part 1'
      );
      expect((anthropicResponse.content[1] as { text: string }).text).toBe(
        'Part 2'
      );
    });

    it('should generate unique id for response', () => {
      const geminiResponse: GeminiResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hello' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const anthropicResponse = transformFromGemini(geminiResponse);

      expect(anthropicResponse.id).toBeDefined();
      expect(anthropicResponse.id.startsWith('msg_')).toBe(true);
    });
  });
});
