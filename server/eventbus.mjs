// Real-time event bus: PostgreSQL LISTEN/NOTIFY → Server-Sent Events to browsers.
// Any INSERT/UPDATE/DELETE on attendance, marks, submissions, predictions,
// interventions or notifications fires a DB trigger → pg_notify → SSE.
import pg from "pg";
import { EventEmitter } from "events";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const listener = new pg.Client({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "classpulse",
});

export async function startEventBus() {
  await listener.connect();
  await listener.query("LISTEN classpulse_events");
  listener.on("notification", (msg) => {
    try {
      const payload = JSON.parse(msg.payload || "{}");
      bus.emit("academic_event", payload);
    } catch {
      /* ignore malformed payloads */
    }
  });
  console.log("✓ event bus listening on channel classpulse_events");
}
