/**
 * StreamTransformer - Transform SSE streaming format between providers
 *
 * @behavior Transforms SSE chunks from OpenAI/Gemini to Anthropic format
 * @acceptance-criteria AC-STREAM.1 through AC-STREAM.5
 */
type SourceProvider = 'openai' | 'gemini';
/**
 * StreamTransformer - Handles SSE format transformation between providers
 *
 * Features:
 * - Buffers partial chunks for complete JSON parsing
 * - Transforms content deltas to Anthropic format
 * - Handles [DONE] markers
 * - Maintains event ordering
 */
export declare class StreamTransformer {
    private source;
    private buffer;
    private completed;
    private currentIndex;
    constructor(source: SourceProvider);
    /**
     * Transform a single SSE chunk
     *
     * @param chunk - The raw SSE chunk from the source provider
     * @returns Transformed chunk in Anthropic SSE format, empty string if ignored, or null if buffering
     */
    transform(chunk: string): string | null;
    /**
     * Transform multiple chunks at once (for batched data)
     *
     * @param data - Multiple SSE events potentially combined
     * @returns Array of transformed chunks
     */
    transformBatch(data: string): string[];
    /**
     * Check if the stream is complete
     */
    isComplete(): boolean;
    /**
     * Reset the transformer for a new stream
     */
    reset(): void;
    /**
     * Process the buffer and extract complete events
     */
    private processBuffer;
    /**
     * Transform OpenAI streaming chunk to Anthropic format
     */
    private transformOpenAIChunk;
    /**
     * Transform Gemini streaming chunk to Anthropic format
     */
    private transformGeminiChunk;
    /**
     * Create message_start event
     */
    private createMessageStart;
    /**
     * Create message_stop event
     */
    private createMessageStop;
    /**
     * Create content_block_delta event for text
     */
    private createContentDelta;
    /**
     * Create content_block_delta event for tool calls
     */
    private createToolDelta;
}
export {};
//# sourceMappingURL=stream-transformer.d.ts.map