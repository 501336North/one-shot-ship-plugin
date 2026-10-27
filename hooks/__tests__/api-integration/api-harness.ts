/**
 * Test helper for release-channels.api.integration.test.sh: boots the REAL OSS API (packages/api/src/index.ts of the
 * checkout in API_SRC) on 127.0.0.1 with its in-memory prisma double (NODE_ENV=test), records every request and the
 * bytes answered, and seeds users through the API's own routes.
 *
 * The manifest is signed at startup with a THROWAWAY Ed25519 key made here (its public half goes to OUT/pub.b64), the
 * way staging signs its own (MANIFEST_SIGN_AT_STARTUP=1). The real staging/production private keys are never used.
 *
 * Env: API_SRC (the API's packages/api directory), OUT (a fresh directory). The caller runs this with cwd = an empty
 * temp directory, so dotenv finds no .env (the checkout's packages/api/.env is never loaded).
 * Writes: OUT/api.json {url, team, none} (API keys of a team owner with one enabled + one disabled law, and of a user
 * with no laws), OUT/requests.log ("<n> <method> <url> <status> <sha256 of body> <bytes>"), OUT/ready last.
 */
import crypto from 'crypto';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Express, Request, Response, NextFunction } from 'express';

interface PrismaSeed {
  team: { create(args: { data: { name: string; slug: string; plan: string } }): Promise<{ id: string }> };
  teamMember: { create(args: { data: { teamId: string; userId: string; role: string } }): Promise<unknown> };
}

type Writer = (chunk?: unknown, ...rest: unknown[]) => unknown;

async function main(): Promise<void> {
  const apiSrc = process.env.API_SRC as string;
  const out = process.env.OUT as string;

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  process.env.MANIFEST_SIGN_AT_STARTUP = '1';
  process.env.MANIFEST_SIGNING_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  fs.writeFileSync(path.join(out, 'pub.b64'), publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));

  // express from the API checkout's own dependencies (this file lives in the plugin, which has none of them)
  const express = createRequire(path.join(apiSrc, 'package.json'))('express') as () => Express;
  const app = ((await import(path.join(apiSrc, 'src/index.ts'))) as { default: Express }).default;
  const { prisma } = (await import(path.join(apiSrc, 'src/lib/prisma.ts'))) as { prisma: PrismaSeed };

  let n = 0;
  const outer = express();
  outer.use((req: Request, res: Response, next: NextFunction) => {
    const chunks: Buffer[] = [];
    const keep = (c: unknown) => {
      if (c != null && typeof c !== 'function') chunks.push(Buffer.from(c as string));
    };
    const write = res.write.bind(res) as Writer;
    const end = res.end.bind(res) as Writer;
    (res as unknown as { write: Writer }).write = (c?: unknown, ...rest: unknown[]) => {
      keep(c);
      return write(c, ...rest);
    };
    (res as unknown as { end: Writer }).end = (c?: unknown, ...rest: unknown[]) => {
      keep(c);
      const body = Buffer.concat(chunks);
      n += 1;
      const hash = crypto.createHash('sha256').update(body).digest('hex');
      fs.appendFileSync(path.join(out, 'requests.log'), `${n} ${req.method} ${req.originalUrl} ${res.statusCode} ${hash} ${body.length}\n`);
      return end(c, ...rest);
    };
    next();
  });
  outer.use(app);
  const server = outer.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, route: string, key?: string, body?: object): Promise<Record<string, string>> => {
    const r = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${route} -> ${r.status} ${text}`);
    return JSON.parse(text) as Record<string, string>;
  };
  const register = async (tag: string) => {
    const r = await call('POST', '/api/v1/auth/register', undefined, {
      email: `itest-${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`,
      password: 'SecurePass123!x',
    });
    return { apiKey: r.apiKey, userId: r.userId };
  };

  const owner = await register('team');
  const team = await prisma.team.create({ data: { name: 'Itest Team', slug: `itest-${Date.now()}`, plan: 'TEAM' } });
  await prisma.teamMember.create({ data: { teamId: team.id, userId: owner.userId, role: 'OWNER' } });
  // A heading in the name and a heading + horizontal rule in the text: the API sanitises both.
  await call('POST', '/api/v1/iron-laws/custom', owner.apiKey, {
    name: '## Use Tailwind',
    text: 'Always use utility classes.\n# not a heading\n---\nKeep it short.',
    teamId: team.id,
  });
  const off = await call('POST', '/api/v1/iron-laws/custom', owner.apiKey, {
    name: 'Disabled law',
    text: 'DISABLED-LAW-TEXT must never be served.',
    teamId: team.id,
  });
  await call('PUT', `/api/v1/iron-laws/custom/${off.id}`, owner.apiKey, { enabled: false, teamId: team.id });
  const none = await register('none');

  fs.writeFileSync(path.join(out, 'api.json'), JSON.stringify({ url: base, team: owner.apiKey, none: none.apiKey }));
  fs.writeFileSync(path.join(out, 'ready'), '1');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
