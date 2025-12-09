import type { CheckResult } from '../types.js';
import type { QueueManager } from '../queue/manager.js';
interface QueueCheckOptions {
    queueManager: QueueManager;
    statePath?: string;
}
export declare function checkQueue(options: QueueCheckOptions): Promise<CheckResult>;
export {};
//# sourceMappingURL=queue.d.ts.map