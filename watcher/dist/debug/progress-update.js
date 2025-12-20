/**
 * Progress Update
 * Updates PROGRESS.md with fix tasks
 */
/**
 * Append fix tasks to existing PROGRESS.md content
 */
export function appendFixTasks(existingContent, tasks) {
    const lines = existingContent.split('\n');
    const tasksIndex = lines.findIndex((line) => line === '## Tasks');
    if (tasksIndex === -1) {
        return existingContent;
    }
    // Find existing tasks
    const existingTasks = [];
    let maxTaskId = 0;
    for (let i = tasksIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('## '))
            break;
        const match = line.match(/^- \[[x ]\] Task (\d+):/);
        if (match) {
            existingTasks.push(line);
            maxTaskId = Math.max(maxTaskId, parseInt(match[1], 10));
        }
    }
    // Add new tasks
    const newTasks = tasks.map((task, index) => {
        const taskId = maxTaskId + index + 1;
        return `- [ ] Task ${taskId}: ${task.description}`;
    });
    // Reconstruct content
    const beforeTasks = lines.slice(0, tasksIndex + 1);
    const afterTasks = lines.slice(tasksIndex + 1).filter((line) => {
        return !line.match(/^- \[[x ]\] Task \d+:/) && line.trim() !== '';
    });
    return [...beforeTasks, ...existingTasks, ...newTasks, '', ...afterTasks].join('\n');
}
/**
 * Create new PROGRESS.md content
 */
export function createProgressContent(tasks, featureName) {
    const timestamp = new Date().toISOString().split('T')[0];
    let content = `# Progress: ${featureName}\n\n`;
    content += `## Current Phase: debug\n\n`;
    content += `## Tasks\n`;
    tasks.forEach((task) => {
        content += `- [ ] Task ${task.id}: ${task.description}\n`;
    });
    content += `\n## Blockers\n`;
    content += `- None\n\n`;
    content += `## Last Updated: ${timestamp}\n`;
    return content;
}
//# sourceMappingURL=progress-update.js.map