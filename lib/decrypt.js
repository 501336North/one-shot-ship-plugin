#!/usr/bin/env node
/**
 * One Shot Ship - Prompt Decryption Script
 *
 * This script decrypts encrypted prompts from the One Shot Ship API.
 * It requires a valid API key and active subscription to work.
 *
 * Usage: node decrypt.js <type> <name>
 *   type: commands, skills, agents, hooks
 *   name: the specific item name
 *
 * Examples:
 *   node decrypt.js commands read-the-winds
 *   node decrypt.js skills armored-hull
 *   node decrypt.js agents code-reviewer
 *   node decrypt.js hooks pre-commit
 *
 * Legacy usage (defaults to commands):
 *   node decrypt.js read-the-winds
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const API_URL = 'https://one-shot-ship-api.onrender.com';
const VALID_TYPES = ['commands', 'skills', 'agents', 'hooks'];

/**
 * Get hardware ID for encryption key derivation
 * Currently uses 'default' to match server-side encryption
 */
function getHardwareId() {
  return 'default';
}

/**
 * Derive encryption key from credentials (must match server-side)
 */
function deriveKey(apiKey, licenseId, hardwareId, salt) {
  const combined = `${apiKey}:${licenseId}:${hardwareId}:${salt}`;
  return crypto.createHash('sha256').update(combined).digest();
}

/**
 * Decrypt AES-256-GCM encrypted data
 */
function decrypt(encrypted, iv, authTag, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Make HTTPS request and return JSON response
 */
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 401) {
          reject(new Error('UNAUTHORIZED: Invalid API key. Check ~/.oss/config.json'));
        } else if (res.statusCode === 403) {
          reject(new Error('FORBIDDEN: Subscription expired. Upgrade at https://one-shot-ship.onrender.com/pricing'));
        } else if (res.statusCode === 404) {
          reject(new Error('NOT_FOUND: Resource not available'));
        } else if (res.statusCode >= 400) {
          reject(new Error(`API_ERROR: ${res.statusCode} - ${data}`));
        } else {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('PARSE_ERROR: Invalid JSON response'));
          }
        }
      });
    });

    req.on('error', (e) => reject(new Error(`NETWORK_ERROR: ${e.message}`)));
    req.end();
  });
}

/**
 * Load API key from config file
 */
function loadApiKey() {
  const configPath = path.join(os.homedir(), '.oss', 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error('NO_CONFIG: API key not configured. Run: mkdir -p ~/.oss && echo \'{"apiKey": "YOUR_KEY"}\' > ~/.oss/config.json');
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.apiKey) {
      throw new Error('NO_API_KEY: No apiKey found in ~/.oss/config.json');
    }
    return config.apiKey;
  } catch (e) {
    if (e.message.startsWith('NO_')) throw e;
    throw new Error('INVALID_CONFIG: Could not parse ~/.oss/config.json');
  }
}

/**
 * Parse command line arguments
 * Supports both:
 *   node decrypt.js <type> <name>
 *   node decrypt.js <name> (defaults to commands)
 */
function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node decrypt.js [type] <name>');
    console.error('  type: commands (default), skills, agents, hooks');
    console.error('  name: the specific item name');
    process.exit(1);
  }
  
  if (args.length === 1) {
    // Legacy mode: just name, assume commands
    return { type: 'commands', name: args[0] };
  }
  
  const [typeOrName, name] = args;
  
  if (VALID_TYPES.includes(typeOrName)) {
    return { type: typeOrName, name };
  }
  
  // First arg is not a valid type, assume it's a name (legacy mode)
  return { type: 'commands', name: typeOrName };
}

/**
 * Main decryption flow
 */
async function main() {
  const { type, name } = parseArgs();

  try {
    // Step 1: Load API key
    const apiKey = loadApiKey();

    // Step 2: Get hardware ID (uses 'default' to match server)
    const hardwareId = getHardwareId();

    // Step 3: Fetch license info (includes licenseId and salt)
    const licenseInfo = await fetchJson(
      `${API_URL}/api/v1/license/info`,
      { 'Authorization': `Bearer ${apiKey}` }
    );

    // Step 4: Fetch encrypted prompt based on type
    const encryptedResponse = await fetchJson(
      `${API_URL}/api/v1/prompts/${type}/${name}`,
      { 'Authorization': `Bearer ${apiKey}` }
    );

    // Step 5: Derive decryption key
    const key = deriveKey(
      apiKey,
      licenseInfo.licenseId,
      hardwareId,
      licenseInfo.salt
    );

    // Step 6: Decrypt
    const prompt = decrypt(
      encryptedResponse.encrypted,
      encryptedResponse.iv,
      encryptedResponse.authTag,
      key
    );

    // Output decrypted prompt
    console.log(prompt);

  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

main();
