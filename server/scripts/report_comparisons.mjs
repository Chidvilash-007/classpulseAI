import pg from "pg";
const pool = new pg.Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "classpulse", max: 5 });
const q = async (label, sql) => {
  const t0 = performance.now();
  const rows = (await pool.query(sql)).rows;
  console.log(`\n===== ${label} (${Math.round(performance.now() - t0)} ms, ${rows.length} rows) =====`);
  console.log(JSON.stringify(rows, null, 1));
  return rows;
};

// ---------- Q1: classic rule-based EWS vs ClassPulse model ----------
const RULE_SQL = `
WITH intern AS (
  SELECT m.student_id, a.subject_id,
         100.0 * SUM(m.marks_obtained) / NULLIF(SUM(a.max_marks), 0) AS pct
  FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id
  WHERE a.assessment_type = 'Internal'
  GROUP BY m.student_id, a.subject_id
),
rule AS (
  SELECT e.student_id, e.subject_id,
    CASE WHEN va.attendance_pct < 75 OR COALESCE(i.pct, 0) < 50
         THEN 'Flagged' ELSE 'Safe' END AS rule_verdict
  FROM enrollments e
  JOIN v_student_attendance va ON va.student_id = e.student_id AND va.subject_id = e.subject_id
  LEFT JOIN intern i ON i.student_id = e.student_id AND i.subject_id = e.subject_id
),
model AS (
  SELECT student_id, subject_id, risk_level, predicted_score, explanation, predicted_score::numeric AS s
  FROM v_latest_predictions
)
SELECT
  rule.rule_verdict,
  CASE WHEN m.risk_level IN ('High','Critical') THEN 'model: at-risk' ELSE 'model: OK' END AS model_verdict,
  count(*) AS pairs,
  round(100.0 * count(*) / SUM(count(*)) OVER (), 1) AS pct_of_pairs
FROM rule JOIN model m USING (student_id, subject_id)
GROUP BY 1, 2 ORDER BY 1, 2`;

const RULE_DISAGREE = `
WITH intern AS (
  SELECT m.student_id, a.subject_id,
         100.0 * SUM(m.marks_obtained) / NULLIF(SUM(a.max_marks), 0) AS pct
  FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id
  WHERE a.assessment_type = 'Internal'
  GROUP BY m.student_id, a.subject_id
),
rule AS (
  SELECT e.student_id, e.subject_id,
    CASE WHEN va.attendance_pct < 75 OR COALESCE(i.pct, 0) < 50
         THEN 'Flagged' ELSE 'Safe' END AS rule_verdict
  FROM enrollments e
  JOIN v_student_attendance va ON va.student_id = e.student_id AND va.subject_id = e.subject_id
  LEFT JOIN intern i ON i.student_id = e.student_id AND i.subject_id = e.subject_id
),
model AS (
  SELECT student_id, subject_id, risk_level, predicted_score, explanation::text AS explanation
  FROM v_latest_predictions
)
SELECT s.registration_number, sub.subject_code,
       va.attendance_pct, round(i.pct, 1) AS internal_pct,
       m.predicted_score, m.risk_level, m.explanation
FROM rule JOIN model m USING (student_id, subject_id)
JOIN v_student_attendance va ON va.student_id = rule.student_id AND va.subject_id = rule.subject_id
LEFT JOIN intern i ON i.student_id = rule.student_id AND i.subject_id = rule.subject_id
JOIN students s ON s.student_id = rule.student_id
JOIN subjects sub ON sub.subject_id = rule.subject_id
WHERE rule.rule_verdict = 'Safe' AND m.risk_level IN ('High','Critical')
LIMIT 6`;

const q1 = await q("Q1a rules vs model cross-tab", RULE_SQL);
const agree = q1.find(r => (r.rule_verdict === 'Flagged') === r.model_verdict.includes('at-risk'));
const agreePairs = Number(q1.find(r => r.rule_verdict === 'Flagged' && r.model_verdict.includes('at-risk'))?.pairs || 0)
                 + Number(q1.find(r => r.rule_verdict === 'Safe' && !r.model_verdict.includes('at-risk'))?.pairs || 0);
console.log(`AGREEMENT: ${agreePairs} / 992 = ${(100 * agreePairs / 992).toFixed(1)}%`);
await q("Q1b 'Safe' per rules but at-risk per model (hidden risk the rule missed)", RULE_DISAGREE);

// ---------- Q2: forecasting-holdout comparison of strategies ----------
const HOLDOUT_SQL = `
WITH series AS (
  SELECT m.student_id, a.subject_id,
         row_number() OVER (PARTITION BY m.student_id, a.subject_id ORDER BY a.assessment_date, a.assessment_id) AS rn,
         count(*) OVER (PARTITION BY m.student_id, a.subject_id) AS n,
         m.marks_obtained::numeric / NULLIF(a.max_marks, 0) * 100 AS pct,
         a.assessment_date AS d, EXTRACT(EPOCH FROM a.assessment_date) AS t
  FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id
  WHERE a.assessment_type = 'Quiz'
),
hist AS (SELECT * FROM series WHERE rn < n),
lastq AS (SELECT student_id, subject_id, pct AS truth FROM series WHERE rn = n),
hist_agg AS (
  SELECT student_id, subject_id,
         avg(pct) AS avg_prev,
         max(pct) FILTER (WHERE rn = n - 1) AS last_pct,
         CASE WHEN count(*) >= 2 THEN regr_slope(pct, t) ELSE NULL END AS slope_per_sec
  FROM hist GROUP BY student_id, subject_id
),
att AS (
  SELECT student_id, subject_id,
         100.0 * SUM(CASE WHEN present THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS att_pct
  FROM attendance_records GROUP BY student_id, subject_id
),
intr AS (
  SELECT m.student_id, a.subject_id,
         100.0 * SUM(m.marks_obtained) / NULLIF(SUM(a.max_marks), 0) AS int_pct
  FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id
  WHERE a.assessment_type = 'Internal'
  GROUP BY m.student_id, a.subject_id
),
assign AS (
  SELECT student_id, subject_id,
         100.0 * SUM(CASE WHEN status <> 'Missing' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS assign_pct
  FROM assignment_submissions GROUP BY student_id, subject_id
),
pairs AS (
  SELECT l.student_id, l.subject_id, l.truth,
         h.avg_prev, h.last_pct, h.slope_per_sec,
         COALESCE(a.att_pct, 0) AS att_pct,
         COALESCE(i.int_pct, 0) AS int_pct,
         COALESCE(g.assign_pct, 0) AS assign_pct,
         COALESCE(s.current_gpa, 7.0) AS gpa,
         GREATEST(0, LEAST(100, (h.last_pct + COALESCE(h.slope_per_sec, 0) * 7 * 86400)::numeric)) AS pred_linear,
         round((0.20 * COALESCE(a.att_pct, 0) + 0.27 * COALESCE(i.int_pct, 0) + 0.18 * h.avg_prev + 0.15 * COALESCE(g.assign_pct, 0) + 0.10 * COALESCE(s.current_gpa, 7.0) * 10
               + 0.10 * GREATEST(0, LEAST(100, 50 + COALESCE(h.slope_per_sec, 0) * 604800 * 100)))::numeric, 1) AS pred_cp
  FROM lastq l
  JOIN hist_agg h USING (student_id, subject_id)
  LEFT JOIN att a USING (student_id, subject_id)
  LEFT JOIN intr i USING (student_id, subject_id)
  LEFT JOIN assign g USING (student_id, subject_id)
  JOIN students s ON s.student_id = l.student_id
  WHERE h.last_pct IS NOT NULL
)
SELECT
  count(*) AS student_subject_pairs,
  round(avg(truth), 1) AS avg_truth,
  round(avg(abs(truth - last_pct)), 1) AS mae_naive_last,          -- Strategy 1: persistence (last observed quiz)
  round(avg(abs(truth - avg_prev)), 1) AS mae_simple_mean,        -- Strategy 2: simple mean of previous quizzes
  round(avg(abs(truth - pred_linear)), 1) AS mae_linear_regr,     -- Strategy 3: linear regression, 1-week horizon
  round(avg(abs(truth - pred_cp)), 1) AS mae_classpulse           -- Strategy 4: ClassPulse weighted ensemble
FROM pairs`;

await q("Q2 forecasting hold-out quiz comparison", HOLDOUT_SQL);

// ---------- Q3: EXPLAIN ANALYZE hot view, indices off vs on ----------
const c0 = await pool.connect();
await c0.query("SET enable_indexscan = off; SET enable_bitmapscan = off; SET enable_indexonlyscan = off");
console.log("\n===== Q3a hot view WITHOUT usable indexes (simulated pre-fix scan path) =====");
console.log((await c0.query("EXPLAIN (ANALYZE, COSTS OFF) SELECT count(*) FROM v_latest_predictions")).rows.map(x => x["QUERY PLAN"]).join("\n"));
await c0.release();
const c3 = await pool.connect();
await c3.query("RESET ALL");
console.log("\n===== Q3b hot view WITH idx_predictions_student_subject_time =====");
console.log((await c3.query("EXPLAIN (ANALYZE, COSTS OFF) SELECT count(*) FROM v_latest_predictions")).rows.map(x => x["QUERY PLAN"]).join("\n"));
await c3.release();

// ---------- Q4: no-op guard (write amplification fix) ----------
const WORST = (await pool.query(`SELECT student_id, subject_id, risk_level FROM v_latest_predictions WHERE risk_level = 'Critical' LIMIT 1`)).rows[0];
const countsFor = (r) => pool.query(`SELECT
   (SELECT count(*) FROM predictions WHERE student_id = $1 AND subject_id = $2) AS preds_for_pair,
   (SELECT count(*) FROM predictions) AS preds_total,
   (SELECT count(*) FROM academic_events WHERE event_type = 'PREDICTION_INSERT') AS events_prediction_insert`, [WORST.student_id, WORST.subject_id]);
const beforeCounts = (await countsFor()).rows[0];
for (let i = 0; i < 3; i++) await pool.query(`SELECT classpulse_predict($1, $2)`, [WORST.student_id, WORST.subject_id]);
const afterCounts = (await countsFor()).rows[0];
console.log(`\n===== Q4 no-op guard (pair ${WORST.student_id}/${WORST.subject_id}, risk ${WORST.risk_level}) =====`);
console.log("before 3 re-computes:", JSON.stringify(beforeCounts));
console.log("after  3 re-computes:", JSON.stringify(afterCounts));
console.log("rows added by 3 identical re-computes:", afterCounts.preds_total - beforeCounts.preds_total, "(old engine would add 3 + 3 events)");

await pool.end();
