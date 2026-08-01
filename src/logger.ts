export type LogContext = Record<string, unknown>;

function write(level: "info" | "warn" | "error", event: string, context: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, context: LogContext = {}) => write("info", event, context),
  warn: (event: string, context: LogContext = {}) => write("warn", event, context),
  error: (event: string, context: LogContext = {}) => write("error", event, context),
};
