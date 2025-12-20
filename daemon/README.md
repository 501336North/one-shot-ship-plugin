# OSS Supervisor Daemon

A standalone process monitor for the OSS Dev Workflow that detects and kills hung processes, monitors system resources, and runs periodic health checks.

## Features

- **Process Monitoring** - Detects vitest, npm test, jest, and node processes
- **Hung Process Detection** - Identifies processes exceeding timeout thresholds
- **Automatic Termination** - Graceful SIGTERM then SIGKILL with logging
- **Resource Monitoring** - Tracks system memory and CPU usage
- **Health Check Scheduling** - Runs health checks on configurable intervals
- **launchd Integration** - Native macOS service management
- **CLI Interface** - start/stop/status/install/uninstall commands

## Installation

```bash
# Build the daemon
npm run build

# Install as launchd service
./bin/oss-daemon.js install

# Or manually load the service
launchctl load ~/Library/LaunchAgents/com.oneshotship.daemon.plist
```

## Usage

```bash
# Check daemon status
oss-daemon status

# Start the daemon
oss-daemon start

# Stop the daemon
oss-daemon stop

# Install as launchd service
oss-daemon install

# Remove launchd service
oss-daemon uninstall

# Show help
oss-daemon --help
```

## Configuration

The daemon uses `~/.oss/` as its working directory:

- `daemon.pid` - PID file for duplicate prevention
- `daemon.log` - Activity log with timestamps
- `daemon.error.log` - Error output
- `health-check.log` - Health check results

### Default Timeouts

| Process Type | Timeout |
|--------------|---------|
| vitest | 5 minutes |
| npm-test | 10 minutes |
| jest | 10 minutes |
| node | 15 minutes |
| unknown | 30 minutes |

## Components

### OssDaemon

Core daemon class with PID file management and graceful shutdown.

```typescript
import { OssDaemon } from 'oss-daemon';

const daemon = new OssDaemon({
  ossDir: '~/.oss',
  checkIntervalMs: 60000,
  processTimeoutMs: 5 * 60 * 1000
});

await daemon.start();
```

### ProcessMonitor

Detects processes using `ps aux` output parsing.

```typescript
import { ProcessMonitor } from 'oss-daemon';

const monitor = new ProcessMonitor();
const processes = await monitor.findProcesses('vitest');
```

### HungProcessKiller

Kills processes that exceed timeout thresholds.

```typescript
import { HungProcessKiller } from 'oss-daemon';

const killer = new HungProcessKiller({
  logFile: '~/.oss/kills.log',
  timeouts: { vitest: 5 * 60 * 1000 }
});

if (killer.shouldKillProcess(process, 'vitest')) {
  await killer.killProcess(process.pid);
}
```

### ResourceMonitor

Tracks system memory and CPU usage.

```typescript
import { ResourceMonitor } from 'oss-daemon';

const monitor = new ResourceMonitor();
const memory = monitor.getMemoryUsage();
const cpu = await monitor.getCpuUsage(1000);
```

### HealthCheckScheduler

Runs health checks on a configurable schedule.

```typescript
import { HealthCheckScheduler } from 'oss-daemon';

const scheduler = new HealthCheckScheduler({
  ossDir: '~/.oss',
  intervalMs: 5 * 60 * 1000,
  healthCheckCommand: 'npm test -- --run'
});

scheduler.start();
```

### LaunchdService

Manages daemon lifecycle on macOS via launchd.

```typescript
import { LaunchdService } from 'oss-daemon';

const launchd = new LaunchdService({
  ossDir: '~/.oss',
  label: 'com.oneshotship.daemon'
});

await launchd.writePlist();
await launchd.load();
```

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Build
npm run build
```

## Test Coverage

69 tests covering:
- Daemon core functionality (8 tests)
- Process monitoring (9 tests)
- Hung process detection (9 tests)
- Resource monitoring (7 tests)
- launchd integration (11 tests)
- Health check scheduling (13 tests)
- CLI interface (12 tests)

## License

MIT
