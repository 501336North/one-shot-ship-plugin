/**
 * ApiTransformer - Transform between Anthropic and OpenAI API formats
 *
 * @behavior Anthropic requests/responses are converted to/from OpenAI format
 * @acceptance-criteria AC-TRANSFORM.1 through AC-TRANSFORM.6
 */
// ============================================================================
// Transform Functions
// ============================================================================
/**
 * Transform Anthropic request to OpenAI format
 */
export function transformToOpenAI(request) {
    const messages = [];
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
    const result = {
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
            type: 'function',
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
function transformMessageToOpenAI(msg) {
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
    const results = [];
    const textParts = [];
    const toolCalls = [];
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
    const message = {
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
export function transformFromOpenAI(response) {
    const choice = response.choices[0];
    const content = [];
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
    let stopReason = null;
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
export function transformStreamChunk(chunk) {
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
    let parsed;
    try {
        parsed = JSON.parse(jsonStr);
    }
    catch {
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
function generateId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 24; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
//# sourceMappingURL=api-transformer.js.map