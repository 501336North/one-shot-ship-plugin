/**
 * GeminiTransformer - Transform between Anthropic and Gemini API formats
 *
 * @behavior Anthropic requests/responses are converted to/from Gemini generateContent format
 * @acceptance-criteria AC-GEMINI.1 through AC-GEMINI.4
 */

import {
  AnthropicRequest,
  AnthropicResponse,
  AnthropicResponseContent,
  AnthropicMessage,
  AnthropicContentBlock,
} from './api-transformer.js';

// ============================================================================
// Gemini Types
// ============================================================================

export interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
}

export interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
}

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: GeminiPart[];
  };
  tools?: GeminiTool[];
  generationConfig?: GeminiGenerationConfig;
}

export interface GeminiCandidate {
  content: {
    role: string;
    parts: GeminiPart[];
  };
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'OTHER';
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Transform Anthropic request to Gemini generateContent format
 */
export function transformToGemini(request: AnthropicRequest): GeminiRequest {
  const result: GeminiRequest = {
    contents: [],
  };

  // Handle system prompt as systemInstruction
  if (request.system) {
    result.systemInstruction = {
      parts: [{ text: request.system }],
    };
  }

  // Transform messages
  for (const msg of request.messages) {
    const geminiContent = transformMessageToGemini(msg);
    result.contents.push(geminiContent);
  }

  // Transform tools to functionDeclarations
  if (request.tools && request.tools.length > 0) {
    result.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        })),
      },
    ];
  }

  // Set generation config
  if (
    request.max_tokens !== undefined ||
    request.temperature !== undefined ||
    request.top_p !== undefined
  ) {
    result.generationConfig = {};

    if (request.max_tokens !== undefined) {
      result.generationConfig.maxOutputTokens = request.max_tokens;
    }
    if (request.temperature !== undefined) {
      result.generationConfig.temperature = request.temperature;
    }
    if (request.top_p !== undefined) {
      result.generationConfig.topP = request.top_p;
    }
  }

  return result;
}

/**
 * Transform a single Anthropic message to Gemini content
 */
function transformMessageToGemini(msg: AnthropicMessage): GeminiContent {
  // Map role: assistant -> model
  const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';

  // Handle string content
  if (typeof msg.content === 'string') {
    return {
      role,
      parts: [{ text: msg.content }],
    };
  }

  // Handle content array
  const parts: GeminiPart[] = [];

  for (const block of msg.content) {
    const part = transformContentBlockToGeminiPart(block);
    parts.push(part);
  }

  return { role, parts };
}

/**
 * Transform an Anthropic content block to a Gemini part
 */
function transformContentBlockToGeminiPart(
  block: AnthropicContentBlock
): GeminiPart {
  switch (block.type) {
    case 'text':
      return { text: block.text };

    case 'tool_use':
      return {
        functionCall: {
          name: block.name,
          args: block.input,
        },
      };

    case 'tool_result':
      return {
        functionResponse: {
          name: block.tool_use_id,
          response: { result: block.content },
        },
      };

    default:
      // Fallback for unknown types
      return { text: '' };
  }
}

/**
 * Transform Gemini response to Anthropic format
 */
export function transformFromGemini(response: GeminiResponse): AnthropicResponse {
  const candidate = response.candidates[0];
  const content: AnthropicResponseContent[] = [];

  // Transform parts to content blocks
  for (const part of candidate.content.parts) {
    if (part.text !== undefined) {
      content.push({
        type: 'text',
        text: part.text,
      });
    } else if (part.functionCall) {
      content.push({
        type: 'tool_use',
        id: `call_${generateId()}`,
        name: part.functionCall.name,
        input: part.functionCall.args,
      });
    }
  }

  // Map finish reason
  let stopReason: AnthropicResponse['stop_reason'] = null;
  switch (candidate.finishReason) {
    case 'STOP':
      stopReason = 'end_turn';
      break;
    case 'MAX_TOKENS':
      stopReason = 'max_tokens';
      break;
    default:
      stopReason = 'end_turn';
  }

  return {
    id: `msg_${generateId()}`,
    type: 'message',
    role: 'assistant',
    model: 'gemini',
    content,
    stop_reason: stopReason,
    usage: {
      input_tokens: response.usageMetadata.promptTokenCount,
      output_tokens: response.usageMetadata.candidatesTokenCount,
    },
  };
}

/**
 * Generate a random ID for message responses
 */
function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
