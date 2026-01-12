/**
 * StreamTransformer - Transform SSE streaming format between providers
 *
 * @behavior Transforms SSE chunks from OpenAI/Gemini to Anthropic format
 * @acceptance-criteria AC-STREAM.1 through AC-STREAM.5
 */
/**
 * StreamTransformer - Handles SSE format transformation between providers
 *
 * Features:
 * - Buffers partial chunks for complete JSON parsing
 * - Transforms content deltas to Anthropic format
 * - Handles [DONE] markers
 * - Maintains event ordering
 */
export class StreamTransformer {
    source;
    buffer = '';
    completed = false;
    currentIndex = 0;
    constructor(source) {
        this.source = source;
    }
    /**
     * Transform a single SSE chunk
     *
     * @param chunk - The raw SSE chunk from the source provider
     * @returns Transformed chunk in Anthropic SSE format, empty string if ignored, or null if buffering
     */
    transform(chunk) {
        if (!chunk) {
            return '';
        }
        // Add to buffer
        this.buffer += chunk;
        // Try to parse complete SSE events from buffer
        return this.processBuffer();
    }
    /**
     * Transform multiple chunks at once (for batched data)
     *
     * @param data - Multiple SSE events potentially combined
     * @returns Array of transformed chunks
     */
    transformBatch(data) {
        const results = [];
        // Split on double newlines (SSE event separator)
        const events = data.split('\n\n').filter((e) => e.trim());
        for (const event of events) {
            const result = this.transform(event);
            if (result && result.length > 0) {
                results.push(result);
            }
            // Clear buffer between events
            this.buffer = '';
        }
        return results;
    }
    /**
     * Check if the stream is complete
     */
    isComplete() {
        return this.completed;
    }
    /**
     * Reset the transformer for a new stream
     */
    reset() {
        this.buffer = '';
        this.completed = false;
        this.currentIndex = 0;
    }
    /**
     * Process the buffer and extract complete events
     */
    processBuffer() {
        const buffer = this.buffer.trim();
        // Check for [DONE] marker
        if (buffer.includes('[DONE]')) {
            this.completed = true;
            this.buffer = '';
            return this.createMessageStop();
        }
        // Try to extract data: prefix and JSON
        const dataMatch = buffer.match(/^data:\s*(.+)$/s);
        if (!dataMatch) {
            // Could be partial, keep buffering
            // But if it doesn't start with 'data' at all, it's invalid
            if (!buffer.startsWith('dat')) {
                this.buffer = '';
                return '';
            }
            return null;
        }
        const jsonStr = dataMatch[1].trim();
        // Try to parse as JSON
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        }
        catch {
            // Incomplete JSON, keep buffering
            return null;
        }
        // Successfully parsed - clear buffer
        this.buffer = '';
        // Transform based on source provider
        if (this.source === 'openai') {
            return this.transformOpenAIChunk(parsed);
        }
        else if (this.source === 'gemini') {
            return this.transformGeminiChunk(parsed);
        }
        return '';
    }
    /**
     * Transform OpenAI streaming chunk to Anthropic format
     */
    transformOpenAIChunk(data) {
        const chunk = data;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
            return '';
        }
        // Handle role delta (message start)
        if (delta.role === 'assistant') {
            return this.createMessageStart();
        }
        // Handle content delta
        if (delta.content !== undefined && delta.content !== '') {
            return this.createContentDelta(delta.content, 0);
        }
        // Handle tool call delta
        if (delta.tool_calls && delta.tool_calls.length > 0) {
            const toolCall = delta.tool_calls[0];
            return this.createToolDelta(toolCall);
        }
        // Empty delta
        return '';
    }
    /**
     * Transform Gemini streaming chunk to Anthropic format
     */
    transformGeminiChunk(data) {
        const chunk = data;
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts;
        if (!parts || parts.length === 0) {
            return '';
        }
        // Handle text content
        const textPart = parts.find((p) => p.text !== undefined);
        if (textPart && textPart.text) {
            return this.createContentDelta(textPart.text, 0);
        }
        // Handle function call
        const fnPart = parts.find((p) => p.functionCall !== undefined);
        if (fnPart && fnPart.functionCall) {
            return this.createToolDelta({
                index: 0,
                id: `call_${generateId()}`,
                function: {
                    name: fnPart.functionCall.name,
                    arguments: JSON.stringify(fnPart.functionCall.args),
                },
            });
        }
        return '';
    }
    /**
     * Create message_start event
     */
    createMessageStart() {
        return (`data: ${JSON.stringify({
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
        })}\n\n`);
    }
    /**
     * Create message_stop event
     */
    createMessageStop() {
        return `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
    }
    /**
     * Create content_block_delta event for text
     */
    createContentDelta(text, index) {
        return (`data: ${JSON.stringify({
            type: 'content_block_delta',
            index,
            delta: {
                type: 'text_delta',
                text,
            },
        })}\n\n`);
    }
    /**
     * Create content_block_delta event for tool calls
     */
    createToolDelta(toolCall) {
        return (`data: ${JSON.stringify({
            type: 'content_block_delta',
            index: toolCall.index,
            delta: {
                type: 'input_json_delta',
                partial_json: toolCall.function?.arguments || '',
            },
        })}\n\n`);
    }
}
/**
 * Generate a random ID
 */
function generateId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 24; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
//# sourceMappingURL=stream-transformer.js.map