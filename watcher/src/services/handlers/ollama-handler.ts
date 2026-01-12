/**
 * OllamaHandler - Handle requests to local Ollama server
 *
 * @behavior Transforms Anthropic requests to Ollama format and connects to local server
 * @acceptance-criteria AC-HANDLER-OLLAMA.1 through AC-HANDLER-OLLAMA.5
 */

import * as http from 'http';
import type {
  AnthropicRequest,
  AnthropicResponse,
  AnthropicResponseContent,
} from '../api-transformer.js';

/**
 * Configuration for OllamaHandler
 */
export interface OllamaHandlerConfig {
  /** Base URL for Ollama server (default: http://localhost:11434) */
  baseUrl?: string;
}

/**
 * Ollama API response format
 */
interface OllamaResponse {
  model: string;
  created_at?: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama models list response
 */
interface OllamaModelsResponse {
  models: Array<{
    name: string;
    size: number;
    modified_at?: string;
  }>;
}

/**
 * OllamaHandler - Connects to local Ollama server
 *
 * - Transforms Anthropic requests to Ollama format
 * - No API key required (local server)
 * - Transforms Ollama responses back to Anthropic format
 */
export class OllamaHandler {
  private baseUrl: string;

  constructor(config: OllamaHandlerConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  /**
   * Get the base URL for the Ollama server
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the Ollama chat endpoint
   */
  getEndpoint(): string {
    return `${this.baseUrl}/api/chat`;
  }

  /**
   * Handle a request by forwarding to Ollama
   */
  async handle(request: AnthropicRequest): Promise<AnthropicResponse> {
    // Transform Anthropic request to Ollama format
    const ollamaRequest = this.transformToOllama(request);

    // Make request to Ollama
    const ollamaResponse = await this.makeRequest('/api/chat', ollamaRequest) as OllamaResponse;

    // Transform response back to Anthropic format
    return this.transformFromOllama(ollamaResponse);
  }

  /**
   * Check if Ollama server is running
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.makeRequest('/', null, 'GET');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    const response = (await this.makeRequest(
      '/api/tags',
      null,
      'GET'
    )) as OllamaModelsResponse;
    return response.models.map((m) => m.name);
  }

  /**
   * Transform Anthropic request to Ollama format
   */
  private transformToOllama(request: AnthropicRequest): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = [];

    // Handle system message
    if (request.system) {
      messages.push({
        role: 'system',
        content: request.system,
      });
    }

    // Transform messages
    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      } else {
        // Handle content array - concatenate text parts
        const textContent = msg.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { type: 'text'; text: string }).text)
          .join('');

        messages.push({
          role: msg.role,
          content: textContent,
        });
      }
    }

    return {
      model: request.model,
      messages,
      stream: false,
      options: {
        num_predict: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
      },
    };
  }

  /**
   * Transform Ollama response to Anthropic format
   */
  private transformFromOllama(response: OllamaResponse): AnthropicResponse {
    const content: AnthropicResponseContent[] = [
      {
        type: 'text',
        text: response.message.content,
      },
    ];

    return {
      id: `msg_${generateId()}`,
      type: 'message',
      role: 'assistant',
      model: response.model,
      content,
      stop_reason: response.done ? 'end_turn' : null,
      usage: {
        input_tokens: response.prompt_eval_count || 0,
        output_tokens: response.eval_count || 0,
      },
    };
  }

  /**
   * Make HTTP request to Ollama server
   */
  private makeRequest(
    path: string,
    body: unknown,
    method = 'POST'
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl);
      const data = body ? JSON.stringify(body) : '';

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: parseInt(url.port) || 11434,
        path,
        method,
        headers: body
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            }
          : {},
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            let errorMessage = `Ollama error: ${res.statusCode}`;
            try {
              const errorBody = JSON.parse(responseData);
              if (errorBody.error) {
                errorMessage = `Ollama error: ${errorBody.error}`;
              }
            } catch {
              // Use default error message
            }
            reject(new Error(errorMessage));
            return;
          }

          try {
            // Handle empty responses (like health check)
            if (!responseData.trim()) {
              resolve({});
              return;
            }
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (err) {
            // For non-JSON responses (like health check text)
            resolve({ text: responseData });
          }
        });
      });

      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ECONNREFUSED') {
          reject(new Error('Ollama is not running. Start Ollama with: ollama serve'));
        } else {
          reject(err);
        }
      });

      if (body) {
        req.write(data);
      }
      req.end();
    });
  }
}

/**
 * Generate a random ID for responses
 */
function generateId(): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
