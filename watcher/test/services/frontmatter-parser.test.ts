/**
 * FrontmatterParser Tests
 *
 * @behavior Frontmatter is extracted from markdown files correctly
 * @acceptance-criteria AC-FRONTMATTER.1 through AC-FRONTMATTER.3
 */

import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  FrontmatterData,
} from '../../src/services/frontmatter-parser.js';

describe('FrontmatterParser', () => {
  describe('parseFrontmatter', () => {
    it('should extract model from prompt frontmatter', () => {
      const content = `---
name: code-reviewer
description: Expert code reviewer
model: openrouter/deepseek/deepseek-chat
model_fallback: true
---

# Code Reviewer

You are an expert code reviewer...`;

      const parsed = parseFrontmatter(content);

      expect(parsed.model).toBe('openrouter/deepseek/deepseek-chat');
      expect(parsed.model_fallback).toBe(true);
      expect(parsed.name).toBe('code-reviewer');
      expect(parsed.description).toBe('Expert code reviewer');
    });

    it('should return undefined for prompts without model', () => {
      const content = `---
name: simple-agent
description: A simple agent
---

# Agent

You are a simple agent...`;

      const parsed = parseFrontmatter(content);

      expect(parsed.model).toBeUndefined();
      expect(parsed.model_fallback).toBeUndefined();
      expect(parsed.name).toBe('simple-agent');
    });

    it('should handle missing frontmatter gracefully', () => {
      const content = `# Agent Without Frontmatter

This is a markdown file without frontmatter.`;

      const parsed = parseFrontmatter(content);

      expect(parsed.model).toBeUndefined();
      expect(parsed.name).toBeUndefined();
      expect(Object.keys(parsed)).toHaveLength(0);
    });

    it('should handle empty content gracefully', () => {
      const parsed = parseFrontmatter('');

      expect(parsed.model).toBeUndefined();
      expect(Object.keys(parsed)).toHaveLength(0);
    });

    it('should handle frontmatter with various model types', () => {
      const testCases: Array<{ content: string; expectedModel: string }> = [
        {
          content: `---
model: ollama/codellama
---
# Test`,
          expectedModel: 'ollama/codellama',
        },
        {
          content: `---
model: openai/gpt-4o
---
# Test`,
          expectedModel: 'openai/gpt-4o',
        },
        {
          content: `---
model: gemini/gemini-2.0-flash
---
# Test`,
          expectedModel: 'gemini/gemini-2.0-flash',
        },
        {
          content: `---
model: default
---
# Test`,
          expectedModel: 'default',
        },
        {
          content: `---
model: claude
---
# Test`,
          expectedModel: 'claude',
        },
      ];

      for (const { content, expectedModel } of testCases) {
        const parsed = parseFrontmatter(content);
        expect(parsed.model).toBe(expectedModel);
      }
    });

    it('should preserve other frontmatter fields', () => {
      const content = `---
name: test-agent
description: A test agent
version: 1.0.0
author: test
model: openai/gpt-4o
tags:
  - test
  - example
---

# Test Agent`;

      const parsed = parseFrontmatter(content);

      expect(parsed.name).toBe('test-agent');
      expect(parsed.description).toBe('A test agent');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.author).toBe('test');
      expect(parsed.model).toBe('openai/gpt-4o');
      expect(parsed.tags).toEqual(['test', 'example']);
    });

    it('should handle model_fallback boolean correctly', () => {
      const contentTrue = `---
model: ollama/codellama
model_fallback: true
---
# Test`;

      const contentFalse = `---
model: ollama/codellama
model_fallback: false
---
# Test`;

      expect(parseFrontmatter(contentTrue).model_fallback).toBe(true);
      expect(parseFrontmatter(contentFalse).model_fallback).toBe(false);
    });

    it('should handle frontmatter with only closing delimiters', () => {
      const content = `No opening delimiter
---

Some content here`;

      const parsed = parseFrontmatter(content);

      expect(parsed.model).toBeUndefined();
      expect(Object.keys(parsed)).toHaveLength(0);
    });

    it('should handle malformed YAML gracefully', () => {
      const content = `---
name: test
model: openai/gpt-4o
invalid yaml : : : here
---

# Test`;

      // Should not throw, should return partial or empty result
      expect(() => parseFrontmatter(content)).not.toThrow();
    });

    it('should handle frontmatter with windows line endings', () => {
      const content = `---\r\nname: test-agent\r\nmodel: openai/gpt-4o\r\n---\r\n\r\n# Test`;

      const parsed = parseFrontmatter(content);

      expect(parsed.name).toBe('test-agent');
      expect(parsed.model).toBe('openai/gpt-4o');
    });

    it('should handle frontmatter with extra whitespace', () => {
      const content = `---
name:   test-agent
model:   openai/gpt-4o
---

# Test`;

      const parsed = parseFrontmatter(content);

      expect(parsed.name).toBe('test-agent');
      expect(parsed.model).toBe('openai/gpt-4o');
    });
  });

  describe('type definitions', () => {
    it('should define FrontmatterData interface with model fields', () => {
      const data: FrontmatterData = {
        name: 'test',
        model: 'openai/gpt-4o',
        model_fallback: true,
      };

      expect(data.model).toBe('openai/gpt-4o');
      expect(data.model_fallback).toBe(true);
    });
  });
});
