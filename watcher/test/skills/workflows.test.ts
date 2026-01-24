/**
 * @behavior /oss:workflows skill displays workflow configuration
 * @acceptance-criteria Task 16: Users can view their workflow config
 * @boundary CLI Skill
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Path to the workflows skill
const SKILL_PATH = join(__dirname, '../../../commands/workflows.md');

describe('/oss:workflows skill', () => {
  /**
   * @behavior Skill file exists
   * @acceptance-criteria Task 16: Skill file created
   */
  it('should have a workflows.md skill file', () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
  });

  /**
   * @behavior Skill has proper frontmatter
   * @acceptance-criteria Task 16: Valid skill metadata
   */
  it('should have frontmatter with description', () => {
    const content = readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('description:');
  });

  /**
   * @behavior Skill lists all 4 workflows
   * @acceptance-criteria Task 16: Shows ideate, plan, build, ship
   */
  it('should reference all 4 main workflows', () => {
    const content = readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('ideate');
    expect(content).toContain('plan');
    expect(content).toContain('build');
    expect(content).toContain('ship');
  });

  /**
   * @behavior Skill shows how to view workflow details
   * @acceptance-criteria Task 16: Can show specific workflow config
   */
  it('should show how to view specific workflow details', () => {
    const content = readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toMatch(/workflows\s+(ideate|plan|build|ship)/);
  });

  /**
   * @behavior Skill references API endpoint
   * @acceptance-criteria Task 16: Uses API to fetch config
   */
  it('should reference the workflows API endpoint', () => {
    const content = readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toContain('/api/v1/workflows');
  });

  /**
   * @behavior Skill shows customization status
   * @acceptance-criteria Task 16: Indicates if workflow is customized
   */
  it('should show customization status indication', () => {
    const content = readFileSync(SKILL_PATH, 'utf-8');
    expect(content).toMatch(/custom/i);
  });
});
