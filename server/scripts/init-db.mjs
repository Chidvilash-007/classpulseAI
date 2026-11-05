import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "classpulse",
});

async function run(sql) {
  await pool.query(sql);
}

async function main() {
  const reseed = process.argv.includes("--reseed");
  console.log("→ Applying ClassPulse schema + triggers to", process.env.PGDATABASE || "classpulse");

  // 1. Base schema (provided by the user)
  const schemaSql = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "classpulse_postgresql_schema.sql"),
    "utf-8"
  );
  await run(schemaSql);
  console.log("  ✓ base schema + seed data");

  // 2. Extensions, roles, triggers, notification plumbing
  const setupSql = fs.readFileSync(path.join(__dirname, "setup.sql"), "utf-8");
  await run(setupSql);
  console.log("  ✓ triggers + pg_notify plumbing + read-only role");

  // 2b. Prediction engine functions
  const engineSql = fs.readFileSync(path.join(__dirname, "engine.sql"), "utf-8");
  await run(engineSql);
  console.log("  ✓ prediction engine (features + explainable model)");

  if (reseed) {
    const seedSql = fs.readFileSync(path.join(__dirname, "seed-rich.sql"), "utf-8");
    await run(seedSql);
    console.log("  ✓ rich seed data (calibrated to demo numbers)");
    // Generate the full prediction history from the seeded features
    await run("SELECT classpulse_recompute_all()");
    console.log("  ✓ baseline predictions computed for every enrollment");
    // The seed fires tens of thousands of change events; they are already
    // reflected in the bulk recompute above, so settle them as Processed.
    await run(
      "UPDATE academic_events SET processing_status='Processed', processed_at=COALESCE(processed_at, NOW()) WHERE processing_status='Pending'"
    );
    console.log("  ✓ seed event backlog settled");
  }

  // sanity check
  const { rows } = await pool.query(`SELECT count(*)::int AS students FROM students`);
  console.log(`  ✓ DB ready — students: ${rows[0].students}`);
  await pool.end();
}

main().catch((err) => {
  console.error("DB init failed:", err.message);
  process.exit(1);
});
