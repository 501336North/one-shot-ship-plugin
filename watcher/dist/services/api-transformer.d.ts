/**
 * ApiTransformer - Transform between Anthropic and OpenAI API formats
 *
 * @behavior Anthropic requests/responses are converted to/from OpenAI format
 * @acceptance-criteria AC-TRANSFORM.1 through AC-TRANSFORM.6
 */
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
export type AnthropicContentBlock = AnthropicTextContent | AnthropicToolUseContent | AnthropicToolResultContent;
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
/**
 * Transform Anthropic request to OpenAI format
 */
export declare function transformToOpenAI(request: AnthropicRequest): OpenAIRequest;
/**
 * Transform OpenAI response to Anthropic format
 */
export declare function transformFromOpenAI(response: OpenAIResponse): AnthropicResponse;
/**
 * Transform OpenAI streaming chunk to Anthropic SSE format
 */
export declare function transformStreamChunk(chunk: string): string;
//# sourceMappingURL=api-transformer.d.ts.map