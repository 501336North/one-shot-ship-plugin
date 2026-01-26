/**
 * @behavior Hardware ID generation provides stable, unique identifiers
 * @acceptance-criteria AC-DECRYPT-004
 * @business-rule DECRYPT-004
 * @boundary CLI Hardware
 */
import { describe, it, expect } from 'vitest';

import { getHardwareId } from '../src/hardware.js';

describe('Hardware ID Generation', () => {
  describe('getHardwareId', () => {
    it('should generate consistent hardware ID on same machine', () => {
      const id1 = getHardwareId();
      const id2 = getHardwareId();

      // Should be consistent
      expect(id1).toBe(id2);
    });

    it('should generate non-empty hardware ID', () => {
      const id = getHardwareId();

      expect(id).toBeTruthy();
      expect(id.length).toBeGreaterThan(0);
    });

    it('should generate hardware ID matching expected pattern', () => {
      const id = getHardwareId();

      // Should be a hex string (from sha256 hash)
      expect(id).toMatch(/^[a-f0-9]+$/);
      // Should be 32 characters (half of sha256 output)
      expect(id.length).toBe(32);
    });
  });
});
