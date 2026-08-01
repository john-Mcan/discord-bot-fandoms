import type { Client } from "discord.js";
import { createServer, type Server } from "node:http";
import { logger } from "./logger";
import type { RadioManager } from "./radio/RadioManager";

export class HealthServer {
  private server?: Server;

  constructor(
    private readonly client: Client,
    private readonly radio: RadioManager,
    private readonly host: string,
    private readonly port: number,
  ) {}

  public async start(): Promise<void> {
    if (this.port === 0) {
      logger.info("health.disabled");
      return;
    }
    this.server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === "/healthz") {
        const healthy = this.client.isReady();
        response.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          status: healthy ? "ok" : "starting",
          discordReady: healthy,
          gatewayPingMs: this.client.ws.ping,
          ...this.radio.getMetrics(),
        }));
        return;
      }
      if (path === "/metrics") {
        response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        response.end(this.prometheusMetrics());
        return;
      }
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) return reject(new Error("No se pudo crear el servidor de healthcheck"));
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(this.port, this.host, () => {
        server.off("error", onError);
        resolve();
      });
    });
    logger.info("health.listening", { host: this.host, port: this.port });
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private prometheusMetrics(): string {
    const metrics = this.radio.getMetrics();
    const lines = [
      "# HELP monkey_bot_up Whether the Discord client is ready.",
      "# TYPE monkey_bot_up gauge",
      `monkey_bot_up ${this.client.isReady() ? 1 : 0}`,
      "# HELP monkey_bot_gateway_ping_ms Discord gateway ping in milliseconds.",
      "# TYPE monkey_bot_gateway_ping_ms gauge",
      `monkey_bot_gateway_ping_ms ${Math.max(0, this.client.ws.ping)}`,
      "# TYPE monkey_bot_sessions gauge",
      `monkey_bot_sessions ${metrics.sessions}`,
      "# TYPE monkey_bot_playing_sessions gauge",
      `monkey_bot_playing_sessions ${metrics.playingSessions}`,
      "# TYPE monkey_bot_reconnecting_sessions gauge",
      `monkey_bot_reconnecting_sessions ${metrics.reconnectingSessions}`,
      "# TYPE monkey_bot_stream_failures_total counter",
      `monkey_bot_stream_failures_total ${metrics.streamFailures}`,
      "# TYPE monkey_bot_stream_retries_total counter",
      `monkey_bot_stream_retries_total ${metrics.totalRetries}`,
      "# TYPE monkey_bot_metadata_updates_total counter",
      `monkey_bot_metadata_updates_total ${metrics.metadataUpdates}`,
    ];
    for (const [command, count] of Object.entries(metrics.commands)) {
      const safeCommand = command.replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`monkey_bot_commands_total{command="${safeCommand}"} ${count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
