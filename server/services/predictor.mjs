import { pool } from "../db.mjs";

// Called whenever an academic event lands. Recomputes the prediction for the
// (student, subject) pair using the DB-side explainable model, records a new
// prediction row (history preserved), and raises a notification when the risk
// level crosses a threshold.
export async function recomputePrediction(studentId, subjectId) {
  if (!studentId || !subjectId) return;
  try {
    const before = await pool.query(
      `SELECT risk_level FROM v_latest_predictions
       WHERE student_id = $1 AND subject_id = $2`,
      [studentId, subjectId]
    );
    const prevRisk = before.rows[0]?.risk_level || null;

    await pool.query("SELECT classpulse_predict($1, $2)", [studentId, subjectId]);

    const after = await pool.query(
      `SELECT risk_level, predicted_score FROM v_latest_predictions
       WHERE student_id = $1 AND subject_id = $2`,
      [studentId, subjectId]
    );
    const now = after.rows[0];
    if (!now) return;

    const order = { "On track": 0, Moderate: 1, High: 2, Critical: 3 };
    const worsened = order[now.risk_level] > order[prevRisk ?? now.risk_level];

    if (worsened && ["High", "Critical"].includes(now.risk_level)) {
      // de-dupe: skip if an identical alert was raised in the last 5 minutes
      const recent = await pool.query(
        `SELECT 1 FROM notifications
         WHERE student_id = $1 AND notification_type = 'RISK_ESCALATED'
           AND message = $2 AND created_at > NOW() - INTERVAL '5 minutes' LIMIT 1`,
        [studentId, `${await studentName(studentId)} risk is now ${now.risk_level} (was ${prevRisk ?? "unknown"})`]
      );
      if (recent.rows.length) return;
      await pool.query(
        `INSERT INTO notifications (recipient_id, student_id, notification_type, severity, message)
         SELECT user_id, $1, 'RISK_ESCALATED', $3,
                $2 || ' risk is now ' || $4 || ' (was ' || COALESCE($5,'unknown') || ')'
         FROM users WHERE role IN ('mentor', 'faculty', 'counsellor')`,
        [
          studentId,
          (await studentName(studentId)),
          now.risk_level === "Critical" ? "Critical" : "Warning",
          now.risk_level,
          prevRisk,
        ]
      );
    }
  } catch (err) {
    console.error("prediction recompute failed:", err.message);
  }
}

async function studentName(studentId) {
  const { rows } = await pool.query(
    "SELECT full_name FROM students WHERE student_id = $1",
    [studentId]
  );
  return rows[0]?.full_name || `Student #${studentId}`;
}

// Batch: used at seed time and by the /api/recompute endpoint
export async function recomputeAll() {
  const { rows } = await pool.query("SELECT classpulse_recompute_all() AS n");
  return rows[0].n;
}
