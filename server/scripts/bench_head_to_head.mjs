// Head-to-head benchmark: naive per-pair calls vs set-based engine.
// Usage: node server/scripts/bench_head_to_head.mjs [sampleSize]
// Read-only except classpulse_predict(), which upserts the same values it
// would produce anyway (idempotent), followed by one recompute_all().
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: "classpulse",
});

const sample = Math.min(Number(process.argv[2]) || 100, 992);

async function timed(label, fn) {
  const t0 = performance.now();
  const out = await fn();
  console.log(`${label}: ${(performance.now() - t0).toFixed(1)} ms`);
  return out;
}

try {
  const { rows: pairs } = await pool.query(
    "SELECT student_id, subject_id FROM enrollments ORDER BY student_id, subject_id LIMIT $1",
    [sample],
  );

  // Baseline A: per-pair feature computation (what a naive implementation does)
  await timed(`naive per-pair compute_features x${sample}`, async () => {
    for (const p of pairs)
      await pool.query("SELECT classpulse_compute_features($1,$2)", [
        p.student_id,
        p.subject_id,
      ]);
  });

  // Baseline B: per-pair full predict() (score + sigmoid + INSERT each)
  await timed(`naive per-pair predict x${sample}`, async () => {
    for (const p of pairs)
      await pool.query("SELECT classpulse_predict($1,$2)", [
        p.student_id,
        p.subject_id,
      ]);
  });

  // ClassPulse way: one set-based call for all 992 pairs
  await timed("set-based classpulse_recompute_all() x992", async () => {
    await pool.query("SELECT classpulse_recompute_all()");
  });

  const totalPairs = (
    await pool.query("SELECT count(*)::int AS n FROM enrollments")
  ).rows[0].n;
  console.log(
    JSON.stringify({
      sample,
      totalPairs,
      extrapolatedFullPredictMs: null, // reader: sample_ms * totalPairs / sample
    }),
  );
} finally {
  await pool.end();
}
