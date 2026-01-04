/**
 * Analytics Formatter Service
 *
 * Formats metrics for human-readable terminal display.
 * Provides dashboard view, compact summaries, and colored output.
 */

interface DashboardData {
  sessionCount: number;
  totalCommands: number;
  successRate: number;
  averageSessionDuration: number;
}

interface TopCommand {
  command: string;
  count: number;
}

interface TddMetricsData {
  redPhaseTime: number;
  greenPhaseTime: number;
  refactorPhaseTime: number;
  cycleCount: number;
}

interface CompactSummaryData {
  commandCount: number;
  successRate: number;
  duration: number;
}

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

export class AnalyticsFormatter {
  /**
   * Format duration in milliseconds to human-readable string
   */
  formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      if (remainingMinutes > 0) {
        return `${hours}h ${remainingMinutes}m`;
      }
      return `${hours}h`;
    }

    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      if (remainingSeconds > 0) {
        return `${minutes}m ${remainingSeconds}s`;
      }
      return `${minutes}m`;
    }

    return `${seconds}s`;
  }

  /**
   * Format success rate with color based on value
   */
  formatSuccessRate(rate: number): string {
    const percentage = Math.round(rate * 100);
    let color: string;

    if (rate >= 0.9) {
      color = COLORS.green;
    } else if (rate >= 0.7) {
      color = COLORS.yellow;
    } else {
      color = COLORS.red;
    }

    return `${color}${percentage}%${COLORS.reset}`;
  }

  /**
   * Format full dashboard view
   */
  formatDashboard(data: DashboardData): string {
    const lines = [
      `${COLORS.bold}📊 OSS Analytics Dashboard${COLORS.reset}`,
      '─'.repeat(40),
      '',
      `${COLORS.blue}Sessions:${COLORS.reset} ${data.sessionCount}`,
      `${COLORS.blue}Commands:${COLORS.reset} ${data.totalCommands}`,
      `${COLORS.blue}Success Rate:${COLORS.reset} ${this.formatSuccessRate(data.successRate)}`,
      `${COLORS.blue}Avg Session:${COLORS.reset} ${this.formatDuration(data.averageSessionDuration)}`,
      '',
    ];

    return lines.join('\n');
  }

  /**
   * Format top commands list
   */
  formatTopCommands(commands: TopCommand[]): string {
    if (commands.length === 0) {
      return `${COLORS.dim}No commands recorded yet${COLORS.reset}`;
    }

    const lines = [
      `${COLORS.bold}🔝 Top Commands${COLORS.reset}`,
      '─'.repeat(30),
    ];

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const rank = i + 1;
      lines.push(`  ${rank}. ${cmd.command} (${cmd.count})`);
    }

    return lines.join('\n');
  }

  /**
   * Format TDD metrics
   */
  formatTddMetrics(data: TddMetricsData): string {
    const total = data.redPhaseTime + data.greenPhaseTime + data.refactorPhaseTime;
    const redPercent = total > 0 ? Math.round((data.redPhaseTime / total) * 100) : 0;
    const greenPercent = total > 0 ? Math.round((data.greenPhaseTime / total) * 100) : 0;
    const refactorPercent = total > 0 ? Math.round((data.refactorPhaseTime / total) * 100) : 0;

    const lines = [
      `${COLORS.bold}🔴🟢🔵 TDD Metrics${COLORS.reset}`,
      '─'.repeat(30),
      `  ${COLORS.red}RED${COLORS.reset}:      ${this.formatDuration(data.redPhaseTime)} (${redPercent}%)`,
      `  ${COLORS.green}GREEN${COLORS.reset}:    ${this.formatDuration(data.greenPhaseTime)} (${greenPercent}%)`,
      `  ${COLORS.blue}REFACTOR${COLORS.reset}: ${this.formatDuration(data.refactorPhaseTime)} (${refactorPercent}%)`,
      `  Cycles: ${data.cycleCount}`,
    ];

    return lines.join('\n');
  }

  /**
   * Format compact one-line summary for status line
   */
  formatCompactSummary(data: CompactSummaryData): string {
    const percentage = Math.round(data.successRate * 100);
    return `${data.commandCount} cmds | ${percentage}% | ${this.formatDuration(data.duration)}`;
  }

  /**
   * Format a progress bar
   */
  formatProgressBar(current: number, total: number, width: number = 20): string {
    const percentage = total > 0 ? current / total : 0;
    const filled = Math.round(percentage * width);
    const empty = width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const percentText = Math.round(percentage * 100);

    return `[${bar}] ${percentText}%`;
  }

  /**
   * Format a metric change (up/down arrow with color)
   */
  formatChange(change: number): string {
    if (change > 0) {
      return `${COLORS.green}↑ ${change}%${COLORS.reset}`;
    } else if (change < 0) {
      return `${COLORS.red}↓ ${Math.abs(change)}%${COLORS.reset}`;
    }
    return `${COLORS.dim}→ 0%${COLORS.reset}`;
  }
}
