import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import type { Client } from "discord.js";
import { HealthServer } from "../src/health";
import {
  IcyDemuxer,
  extractMetadataTitle,
  parseIcyMetadata,
  readPath,
} from "../src/radio/RadioManager";
import type { RadioManager } from "../src/radio/RadioManager";

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("IcyDemuxer separa audio y metadata aunque los chunks esten fragmentados", async () => {
  const demuxer = new IcyDemuxer(4);
  const audio: Buffer[] = [];
  let metadata: Buffer | null = null;
  demuxer.on("data", (chunk: Buffer) => audio.push(chunk));
  demuxer.on("metadata", (chunk: Buffer) => {
    metadata = chunk;
  });

  const metadataBlock = Buffer.alloc(32);
  metadataBlock.write("StreamTitle='Song';", "latin1");
  const input = Buffer.concat([
    Buffer.from("abcd"),
    Buffer.from([2]),
    metadataBlock,
    Buffer.from("efgh"),
  ]);
  demuxer.write(input.subarray(0, 3));
  demuxer.write(input.subarray(3, 9));
  demuxer.end(input.subarray(9));
  await once(demuxer, "end");

  assert.equal(Buffer.concat(audio).toString(), "abcdefgh");
  assert.equal(metadata?.subarray(0, 19).toString("latin1"), "StreamTitle='Song';");
});

test("extractMetadataTitle soporta payload AzuraCast y paths configurables", () => {
  const azura = {
    now_playing: { song: { artist: "Artist", title: "Track" } },
  };
  assert.equal(extractMetadataTitle(azura, null, null), "Artist — Track");

  const custom = { radio: { current: { performer: "Band", name: "Live" } } };
  assert.equal(
    extractMetadataTitle(custom, "radio.current.name", "radio.current.performer"),
    "Band — Live",
  );
  assert.equal(readPath(custom, "radio.current.name"), "Live");
});

test("extractMetadataTitle no duplica el artista si ya viene incluido", () => {
  const payload = { title: "Artist - Track", artist: "Artist" };
  assert.equal(extractMetadataTitle(payload, null, null), "Artist - Track");
});

test("parseIcyMetadata conserva apostrofes y elimina padding", () => {
  const metadata = Buffer.alloc(64);
  metadata.write("StreamTitle='Guns N' Roses - Patience';StreamUrl='';", "latin1");
  assert.equal(parseIcyMetadata(metadata), "Guns N' Roses - Patience");
});

test("HealthServer expone health JSON y metricas Prometheus", async () => {
  const client = {
    isReady: () => true,
    ws: { ping: 42 },
  } as unknown as Client;
  const radio = {
    getMetrics: () => ({
      sessions: 1,
      playingSessions: 1,
      reconnectingSessions: 0,
      streamFailures: 2,
      totalRetries: 3,
      metadataUpdates: 4,
      commands: { play: 5 },
    }),
  } as unknown as RadioManager;
  const port = await availablePort();
  const health = new HealthServer(client, radio, "127.0.0.1", port);
  await health.start();
  try {
    const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json() as { discordReady: boolean }).discordReady, true);

    const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`);
    const metrics = await metricsResponse.text();
    assert.match(metrics, /monkey_bot_playing_sessions 1/);
    assert.match(metrics, /monkey_bot_commands_total\{command="play"\} 5/);
  } finally {
    await health.stop();
  }
});
