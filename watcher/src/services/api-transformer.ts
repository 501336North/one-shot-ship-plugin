/**
 * ApiTransformer - Transform between Anthropic and OpenAI API formats
 *
 * @behavior Anthropic requests/responses are converted to/from OpenAI format
 * @acceptance-criteria AC-TRANSFORM.1 through AC-TRANSFORM.6
 */

// ============================================================================
// Anthropic Types
// ============================================================================

export interface AnthropicTextContent {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type AnthropicContentBlock =
  | AnthropicTextContent
  | AnthropicToolUseContent
  | AnthropicToolResultContent;

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  metadata?: Record<string, unknown>;
}

export interface AnthropicResponseContent {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicResponseContent[];
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// OpenAI Types
// ============================================================================

export interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: OpenAIFunctionCall;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIRequest {
  model?: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: OpenAITool[];
}

export interface OpenAIChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | null;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Transform Anthropic request to OpenAI format
 */
export function transformToOpenAI(request: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = [];

  // Add system message if present
  if (request.system) {
    messages.push({
      role: 'system',
      content: request.system,
    });
  }

  // Transform messages
  for (const msg of request.messages) {
    const transformed = transformMessageToOpenAI(msg);
    messages.push(...transformed);
  }

  const result: OpenAIRequest = {
    messages,
    max_tokens: request.max_tokens,
  };

  // Copy compatible parameters
  if (request.temperature !== undefined) {
    result.temperature = request.temperature;
  }
  if (request.top_p !== undefined) {
    result.top_p = request.top_p;
  }
  if (request.stream !== undefined) {
    result.stream = request.stream;
  }

  // Transform tools
  if (request.tools && request.tools.length > 0) {
    result.tools = request.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  // Note: metadata is dropped (Anthropic-specific)

  return result;
}

/**
 * Transform a single Anthropic message to OpenAI format
 * May return multiple messages (e.g., tool_result becomes tool role message)
 */
function transformMessageToOpenAI(msg: AnthropicMessage): OpenAIMessage[] {
  // Handle string content
  if (typeof msg.content === 'string') {
    return [
      {
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      },
    ];
  }

  // Handle content array
  const results: OpenAIMessage[] = [];
  const textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        textParts.push(block.text);
        break;

      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
        break;

      case 'tool_result':
        // Tool results become separate 'tool' role messages
        results.push({
          role: 'tool',
          content: block.content,
          tool_call_id: block.tool_use_id,
        });
        break;
    }
  }

  // If we have tool_result messages, return them directly
  if (results.length > 0) {
    return results;
  }

  // Build assistant/user message
  const role = msg.role === 'user' ? 'user' : 'assistant';
  const message: OpenAIMessage = {
    role,
    content: textParts.length > 0 ? textParts.join('') : null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return [message];
}

/**
 * Transform OpenAI response to Anthropic format
 */
export function transformFromOpenAI(response: OpenAIResponse): AnthropicResponse {
  const choice = response.choices[0];
  const content: AnthropicResponseContent[] = [];

  // Transform content
  if (choice.message.content) {
    content.push({
      type: 'text',
      text: choice.message.content,
    });
  }

  // Transform tool calls to tool_use
  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments),
      });
    }
  }

  // Map finish reason
  let stopReason: AnthropicResponse['stop_reason'] = null;
  switch (choice.finish_reason) {
    case 'stop':
      stopReason = 'end_turn';
      break;
    case 'length':
      stopReason = 'max_tokens';
      break;
    case 'tool_calls':
      stopReason = 'tool_use';
      break;
  }

  return {
    id: `msg_${generateId()}`,
    type: 'message',
    role: 'assistant',
    model: response.model,
    content,
    stop_reason: stopReason,
    usage: {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
    },
  };
}

/**
 * Transform OpenAI streaming chunk to Anthropic SSE format
 */
export function transformStreamChunk(chunk: string): string {
  // Handle [DONE] marker
  if (chunk.includes('[DONE]')) {
    return `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
  }

  // Parse the chunk
  const dataPrefix = 'data: ';
  if (!chunk.startsWith(dataPrefix)) {
    return '';
  }

  const jsonStr = chunk.substring(dataPrefix.length).trim();
  if (!jsonStr) {
    return '';
  }

  let parsed: {
    choices?: Array<{
      delta?: {
        role?: string;
        content?: string;
        tool_calls?: Array<{
          index: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return '';
  }

  const delta = parsed.choices?.[0]?.delta;
  if (!delta) {
    return '';
  }

  // Handle role delta (message start)
  if (delta.role === 'assistant') {
    return `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: `msg_${generateId()}`,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'unknown',
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })}\n\n`;
  }

  // Handle content delta
  if (delta.content !== undefined && delta.content !== '') {
    return `data: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: delta.content,
      },
    })}\n\n`;
  }

  // Handle tool call delta
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    const toolCall = delta.tool_calls[0];
    return `data: ${JSON.stringify({
      type: 'content_block_delta',
      index: toolCall.index,
      delta: {
        type: 'input_json_delta',
        partial_json: toolCall.function?.arguments || '',
      },
    })}\n\n`;
  }

  // Empty delta
  return '';
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
