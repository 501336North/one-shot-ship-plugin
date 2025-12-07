#!/usr/bin/env node
/**
 * CLI entry point for notification copy service
 *
 * Usage:
 *   node get-copy.js session <event> '<context-json>'
 *   node get-copy.js workflow <command> <event> '<context-json>'
 *   node get-copy.js issue <type> '<context-json>'
 *
 * Output:
 *   JSON: { "title": "...", "message": "..." }
 */
import { NotificationCopyService, } from '../services/notification-copy.js';
const service = new NotificationCopyService();
function parseJson(str) {
    try {
        return JSON.parse(str);
    }
    catch {
        return {};
    }
}
function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: get-copy <type> <event> [context]');
        process.exit(1);
    }
    const type = args[0];
    let copy;
    switch (type) {
        case 'session': {
            const event = args[1];
            const context = parseJson(args[2] || '{}');
            copy = service.getSessionCopy(event, context);
            break;
        }
        case 'workflow': {
            const command = args[1];
            const event = args[2];
            const context = parseJson(args[3] || '{}');
            copy = service.getWorkflowCopy(command, event, context);
            break;
        }
        case 'issue': {
            const issueType = args[1];
            const context = parseJson(args[2] || '{}');
            copy = service.getIssueCopy(issueType, context);
            break;
        }
        default:
            console.error(`Unknown type: ${type}`);
            process.exit(1);
    }
    console.log(JSON.stringify(copy));
}
main();
//# sourceMappingURL=get-copy.js.map