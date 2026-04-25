// ============================================================
//  AM4 GOD BOT — Logger Utility
//  Colored console logging + in-memory log buffer for dashboard
// ============================================================

const LOG_COLORS = {
  info:    '\x1b[36m',   // cyan
  success: '\x1b[32m',   // green
  warn:    '\x1b[33m',   // yellow
  error:   '\x1b[31m',   // red
  action:  '\x1b[35m',   // magenta
  money:   '\x1b[33m',   // yellow
  fuel:    '\x1b[34m',   // blue
  depart:  '\x1b[96m',   // bright cyan
  reset:   '\x1b[0m',
};

// In-memory log buffer (last 500 entries)
const MAX_LOGS = 500;
const logBuffer = [];

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(level, module, message) {
  const ts = getTimestamp();
  const color = LOG_COLORS[level] || LOG_COLORS.info;
  const prefix = `[${ts}] [${module.toUpperCase().padEnd(10)}]`;

  // Console output
  console.log(`${color}${prefix} ${message}${LOG_COLORS.reset}`);

  // Buffer for dashboard
  logBuffer.push({ ts, level, module, message });
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
}

function getLogs(count = 100) {
  return logBuffer.slice(-count);
}

function clearLogs() {
  logBuffer.length = 0;
}

module.exports = { log, getLogs, clearLogs };
