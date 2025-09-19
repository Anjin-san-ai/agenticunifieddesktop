// Simple logging utility that respects --DEBUG flag or DEBUG env var
const DEBUG_FLAG = process.argv.includes('--DEBUG') || process.env.DEBUG === '1' || process.env.DEBUG === 'true' || process.env.DEBUG === 'yes';

const ts = () => new Date().toISOString();

export const isDebug = DEBUG_FLAG;

export function debug(...args) {
  if (!DEBUG_FLAG) return;
  // Use console.debug so tools can filter it, but prefix for readability
  console.debug(`[DEBUG] ${ts()} -`, ...args);
}

export function info(...args) {
  console.log(`[INFO] ${ts()} -`, ...args);
}

export function warn(...args) {
  console.warn(`[WARN] ${ts()} -`, ...args);
}

export function error(...args) {
  console.error(`[ERROR] ${ts()} -`, ...args);
}

export default { isDebug, debug, info, warn, error };
