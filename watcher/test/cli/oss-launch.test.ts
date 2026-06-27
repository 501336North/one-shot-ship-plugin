/**
 * @behavior oss-launch routes a Claude session through the OSS proxy ONLY when
 *           `models.agents` is configured. Users on solely Anthropic models with NO
 *           local models configured are COMPLETELY UNAFFECTED — claude is exec'd with
 *           an unchanged environment, no proxy is started, no base-URL redirect happens.
 * @user-story As an Anthropic-only OSS user, finishing per-agent local routing changes
 *             nothing about how my sessions run.
 * @acceptance-criteria
 *   AC1: No models.agents  -> useProxy=false; env has NO ANTHROPIC_BASE_URL, NO OSS_PROXY_ROUTING.
 *   AC2: models absent     -> useProxy=false (unaffected).
 *   AC3: models.agents={}  -> useProxy=false (unaffected).
 *   AC4: models.agents set -> useProxy=true; env gets ANTHROPIC_BASE_URL + OSS_PROXY_ROUTING=1.
 * @boundary CLI (oss-launch entrypoint)
 */
import { describe, it, expect } from 'vitest';
import { resolveLaunch } from '../../src/cli/oss-launch.js';

describe('oss-launch: Anthropic-only users (no local models) are unaffected', () => {
  it('AC1: does NOT route through the proxy when models.agents is absent', () => {
    const baseEnv = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-real' } as NodeJS.ProcessEnv;
    const decision = resolveLaunch({ models: { default: 'claude' } }, baseEnv);

    expect(decision.useProxy).toBe(false);
    // The env handed to the real claude must NOT be redirected or flagged.
    expect(decision.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(decision.env.OSS_PROXY_ROUTING).toBeUndefined();
    // Original env is preserved verbatim.
    expect(decision.env.ANTHROPIC_API_KEY).toBe('sk-real');
  });

  it('AC2: does NOT route when the models config is entirely absent', () => {
    const decision = resolveLaunch({}, { PATH: '/usr/bin' } as NodeJS.ProcessEnv);
    expect(decision.useProxy).toBe(false);
    expect(decision.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(decision.env.OSS_PROXY_ROUTING).toBeUndefined();
  });

  it('AC3: does NOT route when models.agents is an empty object', () => {
    const decision = resolveLaunch(
      { models: { agents: {} } },
      { PATH: '/usr/bin' } as NodeJS.ProcessEnv
    );
    expect(decision.useProxy).toBe(false);
    expect(decision.env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('AC4: routes through the proxy when models.agents maps an agent', () => {
    const decision = resolveLaunch(
      { models: { agents: { 'code-reviewer': 'ollama/gpt-oss:120b' } } },
      { PATH: '/usr/bin' } as NodeJS.ProcessEnv
    );
    expect(decision.useProxy).toBe(true);
    expect(decision.env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(decision.env.OSS_PROXY_ROUTING).toBe('1');
  });
});
