/**
 * Hardware ID generation for device binding
 * Generates a stable, unique identifier for the current machine
 */

import { networkInterfaces, hostname, homedir } from 'os';
import crypto from 'crypto';

/**
 * Get primary MAC address (or fallback to empty string)
 */
function getMacAddress(): string {
  const interfaces = networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const info of iface) {
      // Skip internal (loopback) and IPv6
      if (!info.internal && info.mac && info.mac !== '00:00:00:00:00:00') {
        return info.mac;
      }
    }
  }

  return '';
}

/**
 * Generate a stable, unique hardware ID for this machine
 * Uses combination of MAC address, hostname, and home directory
 *
 * @returns 32-character hex string
 */
export function getHardwareId(): string {
  const components = [
    getMacAddress(),
    hostname(),
    homedir(),
    process.platform,
    process.arch,
  ].join(':');

  // Hash the components to produce a stable ID
  const hash = crypto.createHash('sha256').update(components).digest('hex');

  // Return first 32 characters (128 bits)
  return hash.substring(0, 32);
}
