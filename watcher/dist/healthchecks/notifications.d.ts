import type { CheckResult } from '../types.js';
interface NotificationCheckOptions {
    logPath: string;
    sessionActive?: boolean;
    testPing?: boolean;
}
export declare function checkNotifications(options: NotificationCheckOptions): Promise<CheckResult>;
export {};
//# sourceMappingURL=notifications.d.ts.map