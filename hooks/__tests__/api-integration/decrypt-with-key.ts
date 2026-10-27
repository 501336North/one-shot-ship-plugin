/**
 * Test helper for release-channels.api.integration.test.sh: runs the plugin's REAL decryptCommand
 * (packages/cli-decrypt/src) for --type shared --name iron-laws, with the throwaway key the API harness signed its
 * manifest with injected as the "staging" key. That injection is the one difference from the shipped bundle, which pins
 * the real staging key for a loopback address (and so refuses a manifest no real key signed).
 *
 * Env: CLI_SRC (packages/cli-decrypt/src), PUB (base64 SPKI DER public key), HOME / OSS_CONFIG_DIR as for oss-decrypt.
 * Prints what oss-decrypt prints; exit 1 with "Error: <message>" on a refusal.
 */
import path from 'path';

interface Keys {
  production: string;
  staging: string;
}

async function main(): Promise<void> {
  const src = process.env.CLI_SRC as string;
  const { decryptCommand } = (await import(path.join(src, 'commands/decrypt.ts'))) as {
    decryptCommand: (type: string, name: string, debug: boolean, options: { manifestKeys: Keys }) => Promise<void>;
  };
  const { PRODUCTION_MANIFEST_PUBLIC_KEY } = (await import(path.join(src, 'manifest-keys.ts'))) as {
    PRODUCTION_MANIFEST_PUBLIC_KEY: string;
  };
  await decryptCommand('shared', 'iron-laws', false, {
    manifestKeys: { production: PRODUCTION_MANIFEST_PUBLIC_KEY, staging: process.env.PUB as string },
  });
}

main().catch((e: unknown) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
