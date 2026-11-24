import { type Schema } from './validate.js';
export declare const PHASES: readonly ["ideate", "plan", "build", "ship"];
export type Phase = (typeof PHASES)[number];
export declare function loadPhaseSchema(phase: Phase, pluginRoot: string): Schema;
//# sourceMappingURL=schemas.d.ts.map