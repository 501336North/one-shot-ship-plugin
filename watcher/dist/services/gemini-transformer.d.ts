/**
 * GeminiTransformer - Transform between Anthropic and Gemini API formats
 *
 * @behavior Anthropic requests/responses are converted to/from Gemini generateContent format
 * @acceptance-criteria AC-GEMINI.1 through AC-GEMINI.4
 */
import { AnthropicRequest, AnthropicResponse } from './api-transformer.js';
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
/**
 * Transform Anthropic request to Gemini generateContent format
 */
export declare function transformToGemini(request: AnthropicRequest): GeminiRequest;
/**
 * Transform Gemini response to Anthropic format
 */
export declare function transformFromGemini(response: GeminiResponse): AnthropicResponse;
//# sourceMappingURL=gemini-transformer.d.ts.map