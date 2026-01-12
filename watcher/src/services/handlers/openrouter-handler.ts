/**
 * OpenRouterHandler - Handle requests to OpenRouter API
 *
 * @behavior Transforms Anthropic requests to OpenAI format and forwards to OpenRouter
 * @acceptance-criteria AC-HANDLER-OR.1 through AC-HANDLER-OR.5
 */

import * as https from 'https';
import {
  transformToOpenAI,
  transformFromOpenAI,
  type AnthropicRequest,
  type AnthropicResponse,
  type OpenAIResponse,
} from '../api-transformer.js';

/**
 * Configuration for OpenRouterHandler
 */
export interface OpenRouterHandlerConfig {
  /** API key for OpenRouter (required) */
  apiKey: string;
}

/**
 * OpenRouterHandler - Forwards requests to OpenRouter API
 *
 * - Transforms Anthropic requests to OpenAI format
 * - Adds proper authorization headers
 * - Transforms OpenAI responses back to Anthropic format
 */
export class OpenRouterHandler {
  private config: OpenRouterHandlerConfig;

  constructor(config: OpenRouterHandlerConfig) {
    if (!config.apiKey || config.apiKey.length === 0) {
      throw new Error('API key is required for OpenRouter');
    }
    this.config = config;
  }

  /**
   * Get headers for OpenRouter API requests
   */
  getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://oneshotship.com',
      'X-Title': 'OSS Dev Workflow',
    };
  }

  /**
   * Get the OpenRouter API endpoint
   */
  getEndpoint(): string {
    return 'https://openrouter.ai/api/v1/chat/completions';
  }

  /**
   * Handle a request by forwarding to OpenRouter
   */
  async handle(request: AnthropicRequest): Promise<AnthropicResponse> {
    // Transform Anthropic request to OpenAI format
    const openaiRequest = transformToOpenAI(request);

    // Make request to OpenRouter
    const openaiResponse = await this.makeRequest(openaiRequest);

    // Transform response back to Anthropic format
    return transformFromOpenAI(openaiResponse);
  }

  /**
   * Make HTTPS request to OpenRouter
   */
  private makeRequest(body: unknown): Promise<OpenAIResponse> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const headers = this.getHeaders();

      const req = https.request(
        {
          hostname: 'openrouter.ai',
          path: '/api/v1/chat/completions',
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          let responseData = '';

          res.on('data', (chunk) => {
            responseData += chunk;
          });

          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              let errorMessage = `OpenRouter API error: ${res.statusCode}`;
              try {
                const errorBody = JSON.parse(responseData);
                if (errorBody.error?.message) {
                  errorMessage = `OpenRouter API error: ${errorBody.error.message}`;
                }
              } catch {
                // Use default error message
              }
              reject(new Error(errorMessage));
              return;
            }

            try {
              const parsed = JSON.parse(responseData) as OpenAIResponse;
              resolve(parsed);
            } catch (err) {
              reject(new Error(`Failed to parse OpenRouter response: ${err}`));
            }
          });
        }
      );

      req.on('error', (err) => {
        reject(err);
      });

      req.write(data);
      req.end();
    });
  }
}
