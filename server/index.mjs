import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.mjs";
import { bus, startEventBus } from "./eventbus.mjs";
import { recomputeAll } from "./services/predictor.mjs";
import { startEventProcessor } from "./services/eventProcessor.mjs";
import { answerQuestion } from "./services/nlq.mjs";
import { hashPassword, verifyPassword, signToken, verifyToken, requireAuth, ensureSeedPasswords, findUserByLogin } from "./services/auth.mjs";
import dotenv from "dotenv";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// ---------- helpers ----------

async function latestPredictions(where = "", params = [], limit = null) {
  const q = `
    SELECT p.student_id, s.registration_number, s.full_name,
           s.section, s.semester, s.current_gpa, s.email,
           d.department_code, d.department_name,
           sub.subject_id, sub.subject_code, sub.subject_name,
           p.predicted_score, p.pass_probability, p.risk_level,
           p.explanation, p.predicted_at, p.model_name, p.model_version,
           ROUND(f.attendance_pct, 0)::int AS attendance
    FROM v_latest_predictions p
    JOIN students s    ON s.student_id = p.student_id
    JOIN departments d ON d.department_id = s.department_id
    JOIN subjects sub  ON sub.subject_id = p.subject_id
    LEFT JOIN v_student_attendance f
           ON f.student_id = p.student_id AND f.subject_id = p.subject_id
    ${where}
    ORDER BY CASE p.risk_level
      WHEN 'Critical' THEN 0 WHEN 'High' THEN 1
      WHEN 'Moderate' THEN 2 ELSE 3 END,
      p.predicted_score ASC
    ${limit ? `LIMIT ${limit}` : ""}`;
  const { rows } = await pool.query(q, params);
  return rows;
}

function initialsOf(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function shapeStudentRow(r) {
  const delta = (() => {
    // deterministic presentation delta derived from risk + score (as in demo)
    const base = { Critical: -12, High: -7, Moderate: -3, "On track": 6 }[r.risk_level] ?? 0;
    const jitter = (r.student_id % 5) - 2;
    const v = base + (r.risk_level === "On track" ? jitter : 0);
    return (v >= 0 ? "+" : "−") + Math.abs(v) + "%";
  })();
  return {
    id: r.registration_number,
    studentId: r.student_id,
    subjectId: r.subject_id,
    name: r.full_name,
    initials: initialsOf(r.full_name),
    department: `CSE · 3rd year`,
    section: `Section ${r.section}`,
    gpa: String(r.current_gpa ?? "—"),
    attendance: r.attendance ?? 0,
    risk: r.risk_level,
    prediction: Math.round(Number(r.predicted_score)),
    passProbability: Number(r.pass_probability),
    subject: r.subject_name,
    subjectCode: r.subject_code,
    delta,
    factors: (r.explanation || []).slice(0, 3),
    updatedAt: r.predicted_at,
  };
}

// ---------- auth (faculty sign-in) ----------
const FACULTY_ROLES = ["faculty", "admin", "hod"];

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await findUserByLogin(email);
    if (!user || !user.is_active || !verifyPassword(password || "", user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = signToken(user);
    res.json({ ok: true, token, user: { userId: user.user_id, fullName: user.full_name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/me", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const data = verifyToken(token);
  if (!data) return res.status(401).json({ error: "Not signed in" });
  res.json({ user: { userId: data.uid, fullName: data.name, email: data.email, role: data.role } });
});

// ---------- REST API ----------
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "connected" });
  } catch (e) {
    res.status(500).json({ ok: false, db: e.message });
  }
});

app.get("/api/overview", async (_req, res) => {
  try {
    const [students, attention, avgScore, interventions, events, subjects, riskDist] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM students WHERE status='Active'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM (
                    SELECT DISTINCT student_id FROM v_latest_predictions
                    WHERE risk_level IN ('High','Critical')) t`),
      pool.query(`SELECT ROUND(AVG(predicted_score),1) AS avg FROM v_latest_predictions`),
      pool.query(`SELECT COUNT(*)::int AS n FROM interventions WHERE status IN ('Planned','Active')`),
      pool.query(`SELECT event_type, created_at, processing_status FROM academic_events
                  ORDER BY created_at DESC LIMIT 8`),
      pool.query(`SELECT sub.subject_code, sub.subject_name,
                         COUNT(*) FILTER (WHERE p.risk_level IN ('High','Critical'))::int AS at_risk,
                         COUNT(*)::int AS total,
                         ROUND(AVG(p.predicted_score),1) AS avg_score
                  FROM v_latest_predictions p JOIN subjects sub ON sub.subject_id=p.subject_id
                  GROUP BY sub.subject_code, sub.subject_name ORDER BY sub.subject_code`),
      pool.query(`SELECT risk_level, COUNT(*)::int AS n FROM v_latest_predictions GROUP BY risk_level`),
    ]);

    const subjectColors = { CS402: "#d77b55", CS318: "#d5a545", CS224: "#568d9b", CS201: "#55a47d" };
    const attentionCount = attention.rows[0].n;

    res.json({
      studentsMonitored: students.rows[0].n,
      needAttention: attentionCount,
      needAttentionPct: students.rows[0].n ? +((attentionCount / students.rows[0].n) * 100).toFixed(1) : 0,
      avgPredictedScore: Number(avgScore.rows[0].avg || 0),
      interventionsActive: interventions.rows[0].n,
      recentEvents: events.rows,
      subjects: subjects.rows.map(s => ({
        code: s.subject_code,
        name: s.subject_name,
        riskPct: s.total ? +(((s.at_risk / s.total) * 100).toFixed(1)) : 0,
        avgScore: Number(s.avg_score || 0),
        color: subjectColors[s.subject_code] || "#4b928d",
      })),
      riskDistribution: Object.fromEntries(riskDist.rows.map(r => [r.risk_level, r.n])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/students", async (req, res) => {
  try {
    const { risk, search, limit } = req.query;
    const conds = ["p.risk_level IN ('High','Critical','Moderate')"];
    const params = [];
    if (risk && risk !== "all") {
      conds.push(`p.risk_level = $${params.push(risk)}`);
    }
    if (search) {
      conds.push(`(s.full_name ILIKE $${params.push("%" + search + "%")}
                   OR s.registration_number ILIKE $${params.push("%" + search + "%")}
                   OR sub.subject_name ILIKE $${params.push("%" + search + "%")})`);
    }
    const rows = await latestPredictions(
      `WHERE ${conds.join(" AND ")}`,
      params,
      limit ? Number(limit) : null
    );
    res.json(rows.map(shapeStudentRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/students/:regNo", async (req, res) => {
  try {
    const rows = await latestPredictions(`WHERE s.registration_number = $1`, [req.params.regNo]);
    if (!rows.length) return res.status(404).json({ error: "Student not found" });
    // pick the worst-risk row as the headline, plus all subject rows
    const worst = rows.find(r => r.risk_level === "Critical")
      || rows.find(r => r.risk_level === "High")
      || rows[0];
    const marks = await pool.query(
      `SELECT a.assessment_name, a.assessment_type, a.max_marks, m.marks_obtained, a.assessment_date
       FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id
       WHERE m.student_id = $1 AND a.subject_id = $2
       ORDER BY a.assessment_date ASC`,
      [worst.student_id, worst.subject_id]
    );
    const history = await pool.query(
      `SELECT predicted_score, risk_level, predicted_at FROM predictions
       WHERE student_id = $1 AND subject_id = $2 ORDER BY predicted_at ASC`,
      [worst.student_id, worst.subject_id]
    );
    const interventions = await pool.query(
      `SELECT i.*, u.full_name AS assigned_to FROM interventions i
       LEFT JOIN users u ON u.user_id = i.assigned_to
       WHERE i.student_id = $1 ORDER BY i.created_at DESC`,
      [worst.student_id]
    );
    res.json({
      ...shapeStudentRow(worst),
      allSubjects: rows.map(r => ({
        subject: r.subject_name, subjectCode: r.subject_code,
        risk: r.risk_level, prediction: Math.round(Number(r.predicted_score)),
        attendance: r.attendance,
      })),
      trajectory: marks.rows.map(m => ({
        label: m.assessment_name,
        type: m.assessment_type,
        pct: Math.round((Number(m.marks_obtained) / Number(m.max_marks)) * 100),
        date: m.assessment_date,
      })),
      predictionHistory: history.rows,
      interventions: interventions.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/interventions", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.intervention_id, i.intervention_type, i.status, i.review_date, i.description,
              s.full_name, s.registration_number, sub.subject_code, sub.subject_name,
              u.full_name AS assigned_to
       FROM interventions i
       JOIN students s ON s.student_id = i.student_id
       LEFT JOIN subjects sub ON sub.subject_id = i.subject_id
       LEFT JOIN users u ON u.user_id = i.assigned_to
       ORDER BY CASE i.status WHEN 'Active' THEN 0 WHEN 'Planned' THEN 1 ELSE 2 END,
                i.review_date NULLS LAST`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/interventions", async (req, res) => {
  try {
    const { registrationNumber, subjectCode, interventionType, description, assignedToEmail, reviewDate } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO interventions (student_id, subject_id, assigned_to, intervention_type, description, review_date, status)
       SELECT s.student_id, sub.subject_id, u.user_id, $3, $4, $6::DATE, 'Active'
       FROM students s, subjects sub, users u
       WHERE s.registration_number = $1 AND sub.subject_code = $2 AND u.email = $5
       RETURNING intervention_id`,
      [registrationNumber, subjectCode || "CS402", interventionType, description, assignedToEmail || "meera.faculty@classpulse.local", reviewDate || null]
    );
    res.json({ ok: true, id: rows[0]?.intervention_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/interventions/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["Planned", "Active", "Completed", "Cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
    const { rows } = await pool.query(
      `UPDATE interventions SET status = $2 WHERE intervention_id = $1 RETURNING intervention_id, student_id, subject_id`,
      [req.params.id, status]
    );
    if (!rows.length) return res.status(404).json({ error: "Intervention not found" });
    // When completing an intervention, record the before/after outcome.
    if (status === "Completed") {
      const iv = rows[0];
      await pool.query(
        `INSERT INTO intervention_results (intervention_id, before_score, after_score, before_attendance, after_attendance, outcome, faculty_notes, reviewed_at)
         SELECT $1,
                (SELECT predicted_score FROM v_latest_predictions WHERE student_id=$2 AND subject_id=$3),
                (SELECT predicted_score FROM v_latest_predictions WHERE student_id=$2 AND subject_id=$3),
                (SELECT attendance_pct FROM v_student_attendance WHERE student_id=$2 AND subject_id=$3),
                (SELECT attendance_pct FROM v_student_attendance WHERE student_id=$2 AND subject_id=$3),
                'Pending', 'Marked completed from dashboard', NOW()
         ON CONFLICT (intervention_id) DO NOTHING`,
        [iv.intervention_id, iv.student_id, iv.subject_id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/notifications", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.notification_id, n.notification_type, n.severity, n.message, n.is_read, n.created_at,
              s.full_name AS student_name, s.registration_number
       FROM notifications n
       LEFT JOIN students s ON s.student_id = n.student_id
       ORDER BY n.created_at DESC LIMIT 20`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/notifications/read-all", async (_req, res) => {
  await pool.query("UPDATE notifications SET is_read = TRUE");
  res.json({ ok: true });
});

// ---------- faculty data entry (secured) ----------

// Class roster — who is enrolled in a subject, with live attendance + risk
app.get("/api/roster", async (req, res) => {
  try {
    const subjectCode = req.query.subjectCode || "CS402";
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT s.student_id, s.registration_number, s.full_name, s.section, s.semester,
              s.current_gpa, s.email,
              ROUND(f.attendance_pct, 1) AS attendance_pct,
              p.risk_level, p.predicted_score, p.pass_probability,
              (SELECT a.present FROM attendance_records a
               WHERE a.student_id = s.student_id AND a.subject_id = sub.subject_id
                 AND a.attendance_date = $2::DATE) AS today_present
      FROM enrollments e
      JOIN students s   ON s.student_id = e.student_id
      JOIN subjects sub ON sub.subject_id = e.subject_id
      LEFT JOIN v_student_attendance f ON f.student_id = s.student_id AND f.subject_id = sub.subject_id
      LEFT JOIN v_latest_predictions p  ON p.student_id = s.student_id AND p.subject_id = sub.subject_id
      WHERE sub.subject_code = $1 AND e.enrollment_status = 'Enrolled'
      ORDER BY s.full_name`,
      [subjectCode, date]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assessments of a subject (for the marks entry grid)
app.get("/api/assessments", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.assessment_id, a.assessment_name, a.assessment_type, a.max_marks,
              a.assessment_date, sub.subject_code, sub.subject_name,
              COUNT(m.mark_id)::int AS marks_entered
       FROM assessments a
       JOIN subjects sub ON sub.subject_id = a.subject_id
       LEFT JOIN marks m ON m.assessment_id = a.assessment_id
       WHERE sub.subject_code = $1
       GROUP BY a.assessment_id, sub.subject_code, sub.subject_name
       ORDER BY a.assessment_date NULLS LAST, a.assessment_id`,
      [req.query.subjectCode || "CS402"]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register a new student and enroll them in subjects (faculty only)
app.post("/api/students", requireAuth(...FACULTY_ROLES), async (req, res) => {
  try {
    const { fullName, registrationNumber, email, section = "A", semester = 5, gpa, subjectCodes } = req.body || {};
    if (!fullName || !String(fullName).trim()) return res.status(400).json({ error: "Student name is required" });

    let regNo = String(registrationNumber || "").trim().toUpperCase();
    if (!regNo) {
      const { rows } = await pool.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(registration_number, '\\D', '', 'g'), '')::bigint), 9000) + 1 AS next FROM students`
      );
      regNo = `ST-${rows[0].next}`;
    }

    const ins = await pool.query(
      `INSERT INTO students (registration_number, full_name, email, department_id, program_id, semester, section, current_gpa, status)
       SELECT $1, $2, $3, d.department_id, p.program_id, $4, $5, $6, 'Active'
       FROM departments d
       LEFT JOIN programs p ON p.department_id = d.department_id AND p.program_name = 'B.Tech Computer Science and Engineering'
       WHERE d.department_code = 'CSE'
       RETURNING student_id, registration_number, full_name, section, semester, current_gpa`,
      [regNo, String(fullName).trim(), email || null, Number(semester) || 5, String(section).trim() || "A", gpa ? Number(gpa) : null]
    );
    const student = ins.rows[0];

    const codes = (Array.isArray(subjectCodes) && subjectCodes.length) ? subjectCodes : ["CS402", "CS318", "CS224", "CS201"];
    await pool.query(
      `INSERT INTO enrollments (student_id, subject_id, academic_year, semester_label, enrollment_status)
       SELECT $1, sub.subject_id, '2025-26', 'Sem 5', 'Enrolled'
       FROM subjects sub WHERE sub.subject_code = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [student.student_id, codes]
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_data)
       VALUES ($1, 'CREATE', 'students', $2, $3::JSONB)`,
      [req.user.uid, student.student_id, JSON.stringify(student)]
    );
    res.json({ ok: true, student, enrolled: codes });
  } catch (err) {
    if (String(err.message).includes("duplicate key")) {
      return res.status(409).json({ error: "Registration number or email already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

// Bulk attendance for a class + date (faculty only). Triggers the real-time pipeline.
app.post("/api/attendance/bulk", requireAuth(...FACULTY_ROLES), async (req, res) => {
  try {
    const { subjectCode = "CS402", date, records } = req.body || {};
    if (!Array.isArray(records) || !records.length) return res.status(400).json({ error: "records[] is required" });
    const regs = records.map(r => String(r.registrationNumber));
    const present = records.map(r => !!r.present);
    const { rows } = await pool.query(
      `INSERT INTO attendance_records (student_id, subject_id, attendance_date, present, recorded_by)
       SELECT s.student_id, sub.subject_id, $2::DATE, t.present, $3
       FROM unnest($4::text[], $5::boolean[]) AS t(reg, present)
       JOIN students s  ON s.registration_number = t.reg
       CROSS JOIN (SELECT subject_id FROM subjects WHERE subject_code = $1) sub
       ON CONFLICT (student_id, subject_id, attendance_date)
       DO UPDATE SET present = EXCLUDED.present, recorded_by = EXCLUDED.recorded_by
       RETURNING attendance_id`,
      [subjectCode, date || new Date().toISOString().slice(0, 10), req.user.uid, regs, present]
    );
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_data)
       VALUES ($1, 'BULK_ATTENDANCE', 'attendance_records', NULL, $2::JSONB)`,
      [req.user.uid, JSON.stringify({ subjectCode, date: date || new Date().toISOString().slice(0, 10), count: rows.length })]
    );
    res.json({ ok: true, saved: rows.length, skipped: regs.length - rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk marks for an assessment (faculty only). Creates the assessment if needed.
app.post("/api/marks/bulk", requireAuth(...FACULTY_ROLES), async (req, res) => {
  try {
    const { subjectCode = "CS402", assessmentId, assessment, records } = req.body || {};
    if (!Array.isArray(records) || !records.length) return res.status(400).json({ error: "records[] is required" });

    let asm = null;
    if (assessmentId) {
      const found = await pool.query(
        `SELECT a.*, sub.subject_code FROM assessments a JOIN subjects sub ON sub.subject_id = a.subject_id WHERE a.assessment_id = $1`,
        [assessmentId]
      );
      asm = found.rows[0] || null;
      if (asm && asm.subject_code !== subjectCode) return res.status(400).json({ error: "Assessment belongs to a different subject" });
    } else if (assessment && assessment.name) {
      const types = ["Quiz", "Internal", "Assignment", "Lab", "Final"];
      if (!types.includes(assessment.type)) return res.status(400).json({ error: `Assessment type must be one of ${types.join(", ")}` });
      const max = Number(assessment.maxMarks);
      if (!Number.isFinite(max) || max <= 0) return res.status(400).json({ error: "Max marks must be a positive number" });
      const existing = await pool.query(
        `SELECT a.* FROM assessments a JOIN subjects sub ON sub.subject_id = a.subject_id
         WHERE sub.subject_code = $1 AND lower(a.assessment_name) = lower($2)`,
        [subjectCode, String(assessment.name).trim()]
      );
      if (existing.rows.length) {
        asm = existing.rows[0];
      } else {
        const created = await pool.query(
          `INSERT INTO assessments (subject_id, assessment_name, assessment_type, max_marks, assessment_date)
           SELECT subject_id, $2, $3, $4, $5::DATE FROM subjects WHERE subject_code = $1 RETURNING *`,
          [subjectCode, String(assessment.name).trim(), assessment.type, max, assessment.date || new Date().toISOString().slice(0, 10)]
        );
        asm = created.rows[0];
      }
    }
    if (!asm) return res.status(400).json({ error: "Pick an existing assessment or provide a new one (name, type, maxMarks)" });

    const valid = records.filter(r => {
      const v = Number(r.marksObtained);
      return Number.isFinite(v) && v >= 0 && v <= Number(asm.max_marks);
    });
    if (!valid.length) return res.status(400).json({ error: `Marks must be between 0 and ${asm.max_marks}` });
    const regs = valid.map(r => String(r.registrationNumber));
    const vals = valid.map(r => Number(r.marksObtained));

    const { rows } = await pool.query(
      `INSERT INTO marks (student_id, assessment_id, marks_obtained, entered_by)
       SELECT s.student_id, $1, t.mark, $2
       FROM unnest($3::text[], $4::numeric[]) AS t(reg, mark)
       JOIN students s ON s.registration_number = t.reg
       ON CONFLICT (student_id, assessment_id)
       DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, entered_by = EXCLUDED.entered_by, updated_at = NOW()
       RETURNING mark_id`,
      [asm.assessment_id, req.user.uid, regs, vals]
    );
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_data)
       VALUES ($1, 'BULK_MARKS', 'marks', $2, $3::JSONB)`,
      [req.user.uid, asm.assessment_id, JSON.stringify({ subjectCode, assessment: asm.assessment_name, count: rows.length })]
    );
    res.json({ ok: true, assessment: { id: asm.assessment_id, name: asm.assessment_name, maxMarks: Number(asm.max_marks) }, saved: rows.length, skipped: records.length - rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- CSV bulk import (faculty only) ----------
// Input type 3: file upload. Two schemas:
//   attendance → registration_number,date,present
//   marks      → registration_number,assessment_name,assessment_type,max_marks,marks_obtained[,assessment_date]
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some(f => f.trim() !== "")) rows.push(row); }
  return rows;
}

const TRUTHY = new Set(["true", "1", "p", "present", "y", "yes"]);

app.post("/api/import/csv", requireAuth(...FACULTY_ROLES), async (req, res) => {
  const { kind, subjectCode = "CS402", csv } = req.body || {};
  if (!csv || !String(csv).trim()) return res.status(400).json({ error: "CSV content is required" });
  if (!["attendance", "marks"].includes(kind)) return res.status(400).json({ error: "kind must be 'attendance' or 'marks'" });
  const rows = parseCsv(String(csv));
  if (rows.length < 2) return res.status(400).json({ error: "CSV needs a header row and at least one data row" });

  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const client = await pool.connect();
  const errors = [];
  let saved = 0, skipped = 0;
  try {
    await client.query("BEGIN");
    const sub = await client.query(`SELECT subject_id FROM subjects WHERE subject_code = $1`, [subjectCode]);
    if (!sub.rows.length) { await client.query("ROLLBACK"); return res.status(400).json({ error: `Unknown subject ${subjectCode}` }); }
    const subjectId = sub.rows[0].subject_id;

    if (kind === "attendance") {
      const iReg = idx("registration_number"), iDate = idx("date"), iPres = idx("present");
      if (iReg < 0 || iDate < 0 || iPres < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Attendance CSV header must be: registration_number,date,present" });
      }
      for (let r = 1; r < rows.length; r++) {
        const line = rows[r];
        const reg = (line[iReg] || "").trim();
        const date = (line[iDate] || "").trim();
        const rawP = (line[iPres] || "").trim().toLowerCase();
        if (!reg || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !rawP) {
          errors.push({ line: r + 1, error: "bad registration_number / date (YYYY-MM-DD) / present" }); skipped++; continue;
        }
        try {
          const up = await client.query(
            `INSERT INTO attendance_records (student_id, subject_id, attendance_date, present, recorded_by)
             SELECT s.student_id, $2, $3::DATE, $4, $5 FROM students s WHERE s.registration_number = $1
             ON CONFLICT (student_id, subject_id, attendance_date)
             DO UPDATE SET present = EXCLUDED.present, recorded_by = EXCLUDED.recorded_by
             RETURNING attendance_id`,
            [reg, subjectId, date, TRUTHY.has(rawP), req.user.uid]
          );
          if (up.rows.length) saved++; else { errors.push({ line: r + 1, error: `unknown student ${reg}` }); skipped++; }
        } catch (e) { errors.push({ line: r + 1, error: e.message }); skipped++; }
      }
    } else {
      const iReg = idx("registration_number"), iName = idx("assessment_name"), iType = idx("assessment_type"),
            iMax = idx("max_marks"), iMark = idx("marks_obtained"), iDate = idx("assessment_date");
      if (iReg < 0 || iName < 0 || iType < 0 || iMax < 0 || iMark < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Marks CSV header must be: registration_number,assessment_name,assessment_type,max_marks,marks_obtained,assessment_date(optional)" });
      }
      const types = ["Quiz", "Internal", "Assignment", "Lab", "Final"];
      const asmCache = new Map();
      for (let r = 1; r < rows.length; r++) {
        const line = rows[r];
        const reg = (line[iReg] || "").trim();
        const name = (line[iName] || "").trim();
        const type = (line[iType] || "").trim();
        const max = Number((line[iMax] || "").trim());
        const mark = Number((line[iMark] || "").trim());
        const date = iDate >= 0 ? (line[iDate] || "").trim() : new Date().toISOString().slice(0, 10);
        if (!reg || !name || !types.includes(type) || !Number.isFinite(max) || max <= 0 ||
            !Number.isFinite(mark) || mark < 0 || mark > max) {
          errors.push({ line: r + 1, error: "invalid row (type ∈ Quiz/Internal/Assignment/Lab/Final; 0 ≤ marks ≤ max)" }); skipped++; continue;
        }
        try {
          let asmId = asmCache.get(name.toLowerCase());
          if (!asmId) {
            const found = await client.query(
              `SELECT assessment_id FROM assessments WHERE subject_id = $1 AND lower(assessment_name) = lower($2)`,
              [subjectId, name]);
            if (found.rows.length) asmId = found.rows[0].assessment_id;
            else {
              const created = await client.query(
                `INSERT INTO assessments (subject_id, assessment_name, assessment_type, max_marks, assessment_date)
                 VALUES ($1, $2, $3, $4, $5::DATE) RETURNING assessment_id`,
                [subjectId, name, type, max, date]);
              asmId = created.rows[0].assessment_id;
            }
            asmCache.set(name.toLowerCase(), asmId);
          }
          const up = await client.query(
            `INSERT INTO marks (student_id, assessment_id, marks_obtained, entered_by)
             SELECT s.student_id, $2, $3, $4 FROM students s WHERE s.registration_number = $1
             ON CONFLICT (student_id, assessment_id)
             DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, entered_by = EXCLUDED.entered_by, updated_at = NOW()
             RETURNING mark_id`,
            [reg, asmId, mark, req.user.uid]
          );
          if (up.rows.length) saved++; else { errors.push({ line: r + 1, error: `unknown student ${reg}` }); skipped++; }
        } catch (e) { errors.push({ line: r + 1, error: e.message }); skipped++; }
      }
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, entity_id, new_data)
       VALUES ($1, 'CSV_IMPORT', $2, NULL, $3::JSONB)`,
      [req.user.uid, kind, JSON.stringify({ subjectCode, saved, skipped, errorCount: errors.length })]
    );
    await client.query("COMMIT");
    res.json({ ok: true, kind, subjectCode, saved, skipped, errors: errors.slice(0, 10) });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Single-record endpoints also require faculty sign-in now
app.post("/api/attendance", requireAuth(...FACULTY_ROLES), async (req, res) => {
  try {
    const { registrationNumber, subjectCode, date, present } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO attendance_records (student_id, subject_id, attendance_date, present, recorded_by)
       SELECT s.student_id, sub.subject_id, $3::DATE, $4, $5
       FROM students s, subjects sub
       WHERE s.registration_number = $1 AND sub.subject_code = $2
       ON CONFLICT (student_id, subject_id, attendance_date)
       DO UPDATE SET present = EXCLUDED.present, recorded_by = EXCLUDED.recorded_by
       RETURNING attendance_id`,
      [registrationNumber, subjectCode || "CS402", date || new Date().toISOString().slice(0, 10), !!present, req.user?.uid ?? null]
    );
    res.json({ ok: true, attendanceId: rows[0]?.attendance_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Marks entry (triggers the real-time pipeline)
app.post("/api/marks", requireAuth(...FACULTY_ROLES), async (req, res) => {
  try {
    const { registrationNumber, assessmentId, marksObtained } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO marks (student_id, assessment_id, marks_obtained, entered_by)
       SELECT s.student_id, $2, $3, $4
       FROM students s WHERE s.registration_number = $1
       ON CONFLICT (student_id, assessment_id)
       DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained,
                     entered_by = EXCLUDED.entered_by,
                     updated_at = NOW()
       RETURNING mark_id`,
      [registrationNumber, assessmentId, marksObtained, req.user?.uid ?? null]
    );
    res.json({ ok: true, markId: rows[0]?.mark_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simulate a burst of live academic activity (for demoing real-time updates)
app.post("/api/simulate", async (_req, res) => {
  try {
    // flip one attendance for a random at-risk demo student, or enter a fresh quiz mark
    const target = await pool.query(
      `SELECT s.registration_number, sub.subject_code FROM students s
       JOIN v_latest_predictions p ON p.student_id = s.student_id
       JOIN subjects sub ON sub.subject_id = p.subject_id
       WHERE s.registration_number IN ('ST-2048','ST-2117','ST-1983','ST-2076','ST-2204')
       ORDER BY RANDOM() LIMIT 1`
    );
    if (!target.rows.length) return res.json({ ok: false });
    const { registration_number, subject_code } = target.rows[0];
    const today = new Date().toISOString().slice(0, 10);
    const present = Math.random() > 0.5;
    await pool.query(
      `INSERT INTO attendance_records (student_id, subject_id, attendance_date, present, recorded_by)
       SELECT s.student_id, sub.subject_id, $3::DATE, $4,
              (SELECT user_id FROM users WHERE email='meera.faculty@classpulse.local')
       FROM students s, subjects sub
       WHERE s.registration_number = $1 AND sub.subject_code = $2
       ON CONFLICT (student_id, subject_id, attendance_date)
       DO UPDATE SET present = EXCLUDED.present`,
      [registration_number, subject_code, today, present]
    );
    res.json({ ok: true, student: registration_number, subject: subject_code, present });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/events", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT e.event_id, e.event_type, e.processing_status, e.created_at, e.processed_at,
            s.full_name AS student_name, s.registration_number, sub.subject_code
     FROM academic_events e
     LEFT JOIN students s ON s.student_id = e.student_id
     LEFT JOIN subjects sub ON sub.subject_id = e.subject_id
     ORDER BY e.created_at DESC LIMIT 30`
  );
  res.json(rows);
});

app.post("/api/recompute", async (_req, res) => {
  const n = await recomputeAll();
  res.json({ ok: true, predictions: n });
});

// NL assistant
app.post("/api/ask", async (req, res) => {
  try {
    const answer = await answerQuestion(req.body.question || "");
    res.json(answer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SSE ----------
let sseClients = [];

app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: hello\ndata: {"ok":true}\n\n`);
  sseClients.push(res);
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c !== res);
  });
});

bus.on("academic_event", (payload) => {
  for (const client of sseClients) {
    try {
      client.write(`event: academic_event\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch { /* client gone */ }
  }
});

// ---------- production static serving ----------
if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORT = (() => {
  const p = Number(process.env.PORT);
  return Number.isFinite(p) && p > 0 ? p : 4000;
})();

async function boot() {
  await ensureSeedPasswords();
  await startEventBus();
  startEventProcessor();
  app.listen(PORT, () => {
    console.log(`✓ ClassPulse API on http://localhost:${PORT} (SSE at /api/stream)`);
  });
}
boot().catch((err) => {
  console.error("server failed to boot:", err);
  process.exit(1);
});
