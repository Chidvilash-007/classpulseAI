// Natural-language → SQL assistant.
// Pipeline: entity extraction → intent detection → SQL generation →
// safety validation → read-only execution (classpulse_reader role).
// Trained against a broad battery of academic questions: risk lists,
// counts, per-subject stats, attendance, marks, GPA, trends, top/bottom N,
// interventions, notifications, events, comparisons and schema questions.

import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: "classpulse_reader",
  password: "reader_only_pass",
  database: process.env.PGDATABASE || "classpulse",
  max: 4,
});

const DANGEROUS = /\b(drop|delete|truncate|alter|update|insert|grant|revoke|create|copy|vacuum)\b/i;

function validateSafety(sql) {
  const problems = [];
  const trimmed = sql.trim();
  if (DANGEROUS.test(trimmed)) problems.push("Contains a write/DDL keyword");
  if (/;/.test(trimmed.replace(/;\s*$/, ""))) problems.push("Multiple statements are not allowed");
  if (!/^select|^with/i.test(trimmed)) problems.push("Only SELECT queries are allowed");
  return { ok: problems.length === 0, problems };
}

/* ================= entity extraction ================= */

const SUBJECT_ALIASES = [
  [/\bdbms\b|\bdatabase/i, "CS402", "Database Management Systems"],
  [/\bnetworks?\b|\bcn\b|\bcomputer network/i, "CS318", "Computer Networks"],
  [/\bos\b|\boperating systems?\b/i, "CS224", "Operating Systems"],
  [/\bdsa\b|\bdata structures?\b/i, "CS201", "Data Structures"],
];

export function findSubject(q) {
  const s = q.toLowerCase();
  for (const [re, code, name] of SUBJECT_ALIASES) {
    if (re.test(s)) return { code, name };
  }
  return null;
}

function extractLimit(q) {
  const m = q.match(/\b(top|bottom|first|last|highest|lowest|worst|best)\s+(\d{1,3})\b/i);
  if (m) return { n: Math.min(Number(m[2]), 200), word: m[1].toLowerCase() };
  return null;
}

function extractPercent(q) {
  const m = q.match(/(\d{1,3})\s*%/);
  if (m) {
    const v = Number(m[1]);
    if (v >= 0 && v <= 100) return v;
  }
  return null;
}

const STOP = new Set([
  "why","is","are","the","at","risk","in","of","and","or","to","show","list","me","all","who","which",
  "what","how","many","much","do","does","did","students","student","subjects","subject","give","tell",
  "about","their","there","with","have","has","need","needs","attention","please","can","you","for",
  "a","an","on","below","above","under","over","than","less","more","from","this","that","these","those",
  "was","were","been","be","being","should","would","could","i","want","know","find","get","any","some",
  // command/entity words that must never be treated as a student name
  "show","details","detail","profile","status","overview","summary","info","history","trend","trajectory",
  "interventions","intervention","notifications","alerts","events","attendance","marks","quiz","quizzes",
  "internal","internals","assignment","assignments","average","avg","top","bottom","worst","best","gpa",
  "section","class","recent","latest","last","due","week","compare","priority","pass","rate","score",
  "scores","predicted","prediction","predictions","critical","high","moderate","track","failing","risk",
  "risky","struggling","improved","worsened","declining","changes","changed","cse","dbms","networks",
]);

const NAME_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;

async function extractStudent(q) {
  // registration number first (ST-2048 / st2048 / 2048)
  const reg = q.match(/\bST-?(\d{3,4})\b/i);
  if (reg) {
    const { rows } = await pool.query(
      `SELECT student_id, full_name, registration_number FROM students
       WHERE registration_number ILIKE $1 LIMIT 1`,
      [`ST-${reg[1]}`]
    );
    if (rows.length) return rows[0];
  }
  // name candidates (case-insensitive) → verify against DB (exact, first-word, or last-word match)
  const words = q.replace(/[^a-zA-Z\s'-]/g, " ").split(/\s+/).filter(Boolean);
  const candidates = new Set();
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (STOP.has(w) || w.length < 3) continue;
    candidates.add(w);
    // two-word name: "aarav sharma"
    if (i + 1 < words.length && !STOP.has(words[i + 1].toLowerCase()) && words[i + 1].length >= 3) {
      candidates.add(w + " " + words[i + 1].toLowerCase());
    }
  }
  for (const cand of candidates) {
    const cap = cand.replace(/\b\w/g, c => c.toUpperCase());
    const { rows } = await pool.query(
      `SELECT student_id, full_name, registration_number FROM students
       WHERE full_name ILIKE $1 OR full_name ILIKE $2 OR full_name ILIKE $3
       ORDER BY CASE WHEN full_name ILIKE $1 THEN 0 WHEN full_name ILIKE $2 THEN 1 ELSE 2 END,
                LENGTH(full_name) ASC
       LIMIT 1`,
      [cap, cap + " %", "% " + cap.split(" ").pop()]
    );
    if (rows.length) return rows[0];
  }
  return null;
}

function extractRiskLevels(q) {
  const s = q.toLowerCase();
  const out = [];
  if (/\bcritical\b/.test(s)) out.push("Critical");
  if (/\bhigh\b/.test(s)) out.push("High");
  if (/\bmoderate\b/.test(s)) out.push("Moderate");
  if (/\bon track\b|\bdoing well\b|\bsafe\b|\bhealthy\b/.test(s)) out.push("On track");
  if (/\bfailing\b|\bworst\b/.test(s) && out.length === 0) out.push("Critical");
  if (/\bat risk\b|\brisky\b|\battention\b|\bstruggl/.test(s) && out.length === 0) return ["High", "Critical"];
  return out;
}

function extractSection(q) {
  const m = q.match(/\bsection\s+([a-z0-9]+)\b/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (["is", "are", "was", "a", "the", "doing", "performs", "performing"].includes(w)) return null;
  return m[1].toUpperCase();
}

function extractAssessmentType(q) {
  const s = q.toLowerCase();
  if (/\bquiz(zes)?\b/.test(s)) return "Quiz";
  if (/\binternal(s)?\b/.test(s)) return "Internal";
  if (/\bassignment(s)?\b/.test(s)) return "Assignment";
  if (/\blab(s)?\b/.test(s)) return "Lab";
  if (/\bfinals?\b|\bfinal exam\b/.test(s)) return "Final";
  return null;
}

/* ================= intents ================= */

export function detectIntent(q) {
  const s = q.toLowerCase();

  // write intent → refuse up front (read-only assistant)
  if (/\b(delete|drop|truncate|insert|update|grant|revoke|alter)\b/.test(s)) return "blocked_write";

  // meta / help — model/pipeline questions first, then generic capability help
  if (/\b(how (does|do).*(work|predict)|what.*(model|engine)|which (table|tables|schema)|explain (the )?(system|pipeline|architecture|prediction))\b/.test(s)) return "schema_help";
  if (/^(help|what can (i|you) do|what can i ask|examples?|commands?|capabilities)\b/.test(s) || /what can you (do|answer)/.test(s)) return "help";

  // counts: how many students ...
  if (/\bhow many\b|\bcount\b|\bnumber of\b/.test(s)) {
    if (/\bmissed|missing (assignment|submission)s?\b/.test(s)) return "count_missing";
    if (/\bintervention/.test(s)) return "count_interventions";
    if (/\bnotification|alert/.test(s)) return "count_notifications";
    if (/\bactive\b/.test(s) && /intervention/.test(s)) return "count_interventions";
    return "count_risk";
  }

  // student-specific
  if (/\b(trajectory|history|progress|improv|declin|wors|trend)/.test(s) && /\b(show|history|prediction|progress)\b/.test(s)) return "student_trend";
  if (/\bwhy\b.*\b(risk|failing|struggl)/.test(s)) return "explain_student";
  if (/\b(details?|profiles?|status|overview|summary|info)\b.*\b(for|of|about)\b/.test(s)) return "explain_student";
  // "ST-1983 details" / "What about Rohan?" — reg-number mention
  if (/\bST-?\d{3,4}\b/i.test(q)) return "explain_student";

  // subject rankings — before the intervention keyword so
  // "which subject needs the most intervention" ranks subjects
  if (/\bwhich subject|priority subject|subject.*(most|needs)\b/.test(s)) return "priority_subject";

  // interventions: "Show all interventions", "Interventions due this week",
  // "Interventions for Aarav Sharma" (after subject-ranking so priority questions win)
  if (/\bintervention/.test(s)) {
    if (/\bdue\b|\bthis week\b|\boverdue\b|\bupcoming\b|\burgent\b/.test(s)) return "interventions_due";
    return "interventions";
  }

  if (/\b(notifications?|alerts?)\b/.test(s)) return "notifications";

  // events
  if (/(\b(recent|latest|last|recently)\b.*\bevents?\b)|(\bevents?\b.*\b(recent|latest|last|recently)\b)/.test(s) || /\bevent (log|feed|stream)\b/.test(s)) return "recent_events";

  // attendance
  if (/\battendance\b/.test(s)) {
    if (/\bbelow|under|less than|fell|dropped?\b/.test(s) || extractPercent(q) !== null) return "attendance_below";
    if (/\baverage|avg\b/.test(s)) return "attendance_avg";
    return "attendance_overview";
  }

  // marks / assessments
  if (/\b(marks?|score|scores|grade|grades)\b/.test(s) && !/\bpredict/.test(s)) {
    if (/\bclass average|class avg\b/.test(s)) return "class_average";
    if (/\b(top|best|highest)\b/.test(s)) return "top_performers";
    if (/\b(bottom|worst|lowest|weakest)\b/.test(s)) return "bottom_performers";
    return "marks_overview";
  }
  // "class average for quiz 1 in dbms" / "average quiz marks"
  if (/\b(average|avg)\b/.test(s) && !/\bpredict/.test(s) && (extractAssessmentType(q) || findSubject(q) || /\bclass\b/.test(s))) return "class_average";

  // GPA
  if (/\bgpa\b/.test(s)) {
    if (/\b(top|best|highest)\b/.test(s)) return "top_performers";
    if (/\b(bottom|worst|lowest|weakest)\b/.test(s)) return "bottom_performers";
    if (/\bbelow|under|less than\b/.test(s)) return "gpa_below";
    return "gpa_top";
  }

  // subject rankings
  if (/\bwhich subject|priority subject|subject.*(most|needs)\b/.test(s)) return "priority_subject";
  if (/\b(top|best|highest)\b.*\b(perform|student|scorer)/.test(s)) return "top_performers";
  if (/\b(bottom|worst|lowest|weakest)\b.*\b(perform|student|scorer)/.test(s)) return "bottom_performers";
  if (/\b(improv|declin|wors|recover|trend|chang|moved?|fell|dropp)\w*\b/.test(s) && /\b(risk|prediction|student|score)\b/.test(s)) return "risk_changes";
  if (/\bpass (rate|probability|chance)/.test(s)) return "pass_rate";
  if (/\bcompare|comparison|versus|\bvs\b/.test(s)) return "compare_subjects";
  if (/\b(average|avg|overall)\b.*\b(score|prediction)/.test(s) || /\bcohort\b/.test(s)) return "avg_score";
  if (/\bsection\b/.test(s)) return "section_risk";
  if (/\b(at risk|risky|attention|struggl|failing)/.test(s) || extractRiskLevels(q).length) return "risk_list";
  if (/\b(risk|prediction|enrolled|monitor)/.test(s)) return "risk_list";

  return "fallback";
}

/* ================= SQL builders ================= */

function riskListSql(subject, risks, limit, order) {
  const params = [];
  const where = [];
  if (subject) { params.push(subject.code); where.push(`sub.subject_code = $${params.length}`); }
  if (risks.length) {
    params.push(risks);
    where.push(`p.risk_level = ANY($${params.length}::text[])`);
  }
  const q = `SELECT s.registration_number, s.full_name, d.department_code,
           sub.subject_code, sub.subject_name,
           p.predicted_score::numeric(5,1) AS predicted_score,
           p.pass_probability::numeric(5,1) AS pass_probability,
           p.risk_level,
           ROUND(a.attendance_pct) AS attendance_pct,
           s.section
         FROM v_latest_predictions p
         JOIN students s ON s.student_id = p.student_id
         JOIN departments d ON d.department_id = s.department_id
         JOIN subjects sub ON sub.subject_id = p.subject_id
         LEFT JOIN v_student_attendance a ON a.student_id = p.student_id AND a.subject_id = p.subject_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY ${order || `CASE p.risk_level WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END, p.predicted_score ASC`}
         ${limit ? `LIMIT ${limit}` : ""}`;
  return { sql: q, params };
}

export async function answerQuestion(question) {
  const started = Date.now();
  const q = String(question || "").trim();
  const intent = detectIntent(q);
  let sql = "";
  let explanation = "";
  const params = [];
  const understood = [];

  try {
    switch (intent) {
      case "blocked_write": {
        return {
          question: q, intent, sql: "-- refused: this assistant is strictly read-only",
          safety: { ok: false, problems: ["Write/DDL operations are not permitted — the assistant runs as a read-only role"] },
          explanation: "I'm a read-only assistant. I can answer questions about students, attendance, marks, predictions, interventions and events — but I never modify data.",
          rows: [], rowCount: 0, durationMs: 0, error: "Refused: write operation requested",
        };
      }

      case "help": {
        return {
          question: q, intent, sql: "-- meta query, no SQL executed",
          safety: { ok: true, problems: [] },
          explanation: "I can answer questions about: at-risk students (list/count, per subject or section), attendance (below X%, averages), marks & class averages, GPA rankings, top/bottom performers, prediction trends & risk changes, pass rates, interventions (all / due), notifications, recent events, subject comparisons, and per-student explanations. Try: 'Why is Aarav at risk?', 'How many students are critical in DBMS?', 'Top 5 by GPA', 'Show interventions due this week'.",
          rows: [
            { capability: "Risk lists", example: "Show at-risk students in Computer Networks" },
            { capability: "Counts", example: "How many students are critical?" },
            { capability: "Attendance", example: "Attendance below 75%" },
            { capability: "Top performers", example: "Top 5 by GPA" },
            { capability: "Trends", example: "Which students' risk improved this week?" },
            { capability: "Interventions", example: "Interventions due this week" },
            { capability: "Explanations", example: "Why is Diya at risk?" },
            { capability: "Comparisons", example: "Compare subjects by average score" },
          ], rowCount: 8, durationMs: 0, error: null,
        };
      }

      case "schema_help": {
        return {
          question: q, intent, sql: "-- meta query, no SQL executed",
          safety: { ok: true, problems: [] },
          explanation: "Predictions come from classpulse_predict(), a transparent weighted SQL model: attendance 20% + internals 27% + quizzes 18% + assignments 15% + GPA 10% + trend 10%. Every write to attendance/marks/submissions fires a trigger → academic_events → pg_notify → SSE, then the engine re-scores affected students. Tables: students, subjects, enrollments, attendance_records, assessments, marks, assignment_submissions, predictions, interventions, notifications, academic_events.",
          rows: [
            { layer: "Capture", detail: "attendance_records, marks, assignment_submissions (trigger-enabled)" },
            { layer: "Audit", detail: "academic_events (Pending → Processed)" },
            { layer: "Intelligence", detail: "classpulse_predict() → predictions (explainable JSONB)" },
            { layer: "Action", detail: "interventions + intervention_results" },
            { layer: "Delivery", detail: "notifications + pg_notify → SSE dashboard" },
          ], rowCount: 5, durationMs: 0, error: null,
        };
      }

      case "explain_student": {
        const st = await extractStudent(q);
        if (!st) {
          return {
            question: q, intent, sql: "-- no matching student found",
            safety: { ok: true, problems: [] },
            explanation: "I couldn't match that to a student. Try a full name (e.g. 'Why is Aarav Sharma at risk?') or a registration number (ST-2048).",
            rows: [], rowCount: 0, durationMs: 0, error: null,
          };
        }
        understood.push(`student ${st.full_name} (${st.registration_number})`);
        sql = `SELECT sub.subject_code, sub.subject_name,
               p.risk_level, p.predicted_score::numeric(5,1), p.pass_probability::numeric(5,1),
               p.explanation,
               ROUND(a.attendance_pct) AS attendance_pct
             FROM v_latest_predictions p
             JOIN subjects sub ON sub.subject_id = p.subject_id
             LEFT JOIN v_student_attendance a ON a.student_id = p.student_id AND a.subject_id = p.subject_id
             WHERE p.student_id = $1
             ORDER BY CASE p.risk_level WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END`;
        params.push(st.student_id);
        explanation = `Per-subject predictions with explanation factors for ${st.full_name} (${st.registration_number}).`;
        break;
      }

      case "student_trend": {
        const st = await extractStudent(q);
        if (!st) {
          return {
            question: q, intent, sql: "-- no matching student found",
            safety: { ok: true, problems: [] },
            explanation: "I couldn't match that to a student. Include a name or registration number, e.g. 'Show Aarav Sharma's prediction history'.",
            rows: [], rowCount: 0, durationMs: 0, error: null,
          };
        }
        understood.push(`student ${st.full_name} (${st.registration_number})`);
        sql = `SELECT sub.subject_code, p.risk_level,
               p.predicted_score::numeric(5,1) AS predicted_score,
               p.predicted_at
             FROM predictions p
             JOIN subjects sub ON sub.subject_id = p.subject_id
             WHERE p.student_id = $1
             ORDER BY p.predicted_at DESC LIMIT 40`;
        params.push(st.student_id);
        explanation = `Prediction history for ${st.full_name} — each re-score over time, newest first.`;
        break;
      }

      case "count_risk": {
        const subject = findSubject(q);
        const risks = extractRiskLevels(q);
        const section = extractSection(q);
        const params2 = [];
        const where = [];
        if (subject) { params2.push(subject.code); where.push(`sub.subject_code = $${params2.length}`); }
        if (risks.length) { params2.push(risks); where.push(`p.risk_level = ANY($${params2.length}::text[])`); }
        if (section) { params2.push(section); where.push(`s.section = $${params2.length}`); }
        sql = `SELECT sub.subject_code, sub.subject_name${section ? ", s.section" : ""},
               COUNT(DISTINCT (s.student_id, sub.subject_id)) AS student_count
             FROM v_latest_predictions p
             JOIN students s ON s.student_id = p.student_id
             JOIN subjects sub ON sub.subject_id = p.subject_id
             ${where.length ? "WHERE " + where.join(" AND ") : ""}
             GROUP BY sub.subject_code, sub.subject_name${section ? ", s.section" : ""}
             ORDER BY student_count DESC`;
        params.push(...params2);
        explanation = `Count of student-subject predictions${subject ? " in " + subject.name : ""}${risks.length ? " at risk level: " + risks.join("/") : ""}${section ? " in section " + section : ""}.`;
        break;
      }

      case "count_missing": {
        sql = `SELECT sub.subject_code, COUNT(*) AS missing_submissions
             FROM assignment_submissions m
             JOIN subjects sub ON sub.subject_id = m.subject_id
             WHERE m.status = 'Missing'
             GROUP BY sub.subject_code ORDER BY missing_submissions DESC`;
        explanation = "Assignments with status 'Missing', grouped by subject.";
        break;
      }

      case "count_interventions": {
        sql = `SELECT status, COUNT(*) AS n FROM interventions GROUP BY status ORDER BY n DESC`;
        explanation = "Interventions grouped by status.";
        break;
      }

      case "count_notifications": {
        sql = `SELECT severity, COUNT(*) AS n, COUNT(*) FILTER (WHERE NOT is_read) AS unread
             FROM notifications GROUP BY severity`;
        explanation = "Notifications grouped by severity with unread counts.";
        break;
      }

      case "attendance_below": {
        const pct = extractPercent(q) ?? 75;
        const subject = findSubject(q);
        const params2 = [pct];
        let where = `f.attendance_pct < $1`;
        if (subject) { params2.push(subject.code); where += ` AND sub.subject_code = $2`; }
        sql = `SELECT s.registration_number, s.full_name, s.section,
               sub.subject_code, sub.subject_name,
               ROUND(f.attendance_pct::numeric, 1) AS attendance_pct
             FROM v_student_attendance f
             JOIN students s ON s.student_id = f.student_id
             JOIN subjects sub ON sub.subject_id = f.subject_id
             WHERE ${where}
             ORDER BY f.attendance_pct ASC LIMIT 100`;
        params.push(...params2);
        explanation = `Student-subject pairs with live attendance below ${pct}%${subject ? " in " + subject.name : ""} (computed from attendance_records).`;
        break;
      }

      case "attendance_avg": {
        const subject = findSubject(q);
        const params2 = [];
        let where = "TRUE";
        if (subject) { params2.push(subject.code); where = `sub.subject_code = $1`; }
        sql = `SELECT sub.subject_code, sub.subject_name,
               ROUND(AVG(f.attendance_pct)::numeric, 1) AS avg_attendance,
               MIN(ROUND(f.attendance_pct)) AS lowest, MAX(ROUND(f.attendance_pct)) AS highest
             FROM v_student_attendance f
             JOIN subjects sub ON sub.subject_id = f.subject_id
             WHERE ${where}
             GROUP BY sub.subject_code, sub.subject_name ORDER BY sub.subject_code`;
        params.push(...params2);
        explanation = `Average attendance per subject${subject ? " (" + subject.name + ")" : ""}.`;
        break;
      }

      case "attendance_overview": {
        sql = `SELECT sub.subject_code, sub.subject_name,
               ROUND(AVG(f.attendance_pct)::numeric, 1) AS avg_attendance,
               COUNT(*) FILTER (WHERE f.attendance_pct < 75) AS below_75
             FROM v_student_attendance f
             JOIN subjects sub ON sub.subject_id = f.subject_id
             GROUP BY sub.subject_code, sub.subject_name ORDER BY sub.subject_code`;
        explanation = "Attendance summary per subject: average and count of students below 75%.";
        break;
      }

      case "class_average": {
        const subject = findSubject(q);
        const atype = extractAssessmentType(q);
        const params2 = [];
        const where = ["TRUE"];
        if (subject) { params2.push(subject.code); where.push(`sub.subject_code = $${params2.length}`); }
        if (atype) { params2.push(atype); where.push(`a.assessment_type = $${params2.length}`); }
        sql = `SELECT sub.subject_code, a.assessment_name, a.assessment_type, a.max_marks,
               ROUND(AVG(100.0 * m.marks_obtained / a.max_marks)::numeric, 1) AS class_avg_pct
             FROM marks m
             JOIN assessments a ON a.assessment_id = m.assessment_id
             JOIN subjects sub ON sub.subject_id = a.subject_id
             WHERE ${where.join(" AND ")}
             GROUP BY sub.subject_code, a.assessment_name, a.assessment_type, a.max_marks, a.assessment_date
             ORDER BY sub.subject_code, a.assessment_date`;
        params.push(...params2);
        explanation = `Class average per assessment${atype ? " (" + atype + "s)" : ""}${subject ? " in " + subject.name : ""}, as a percentage of max marks.`;
        break;
      }

      case "marks_overview": {
        const st = await extractStudent(q);
        const atype = extractAssessmentType(q);
        const params2 = [];
        const where = ["TRUE"];
        if (st) { params2.push(st.student_id); where.push(`m.student_id = $${params2.length}`); understood.push(`student ${st.full_name}`); }
        if (atype) { params2.push(atype); where.push(`a.assessment_type = $${params2.length}`); }
        sql = `SELECT s.registration_number, s.full_name, sub.subject_code,
               a.assessment_name, a.assessment_type, a.max_marks,
               m.marks_obtained::numeric(6,2),
               ROUND(100.0 * m.marks_obtained / a.max_marks) AS pct
             FROM marks m
             JOIN assessments a ON a.assessment_id = m.assessment_id
             JOIN subjects sub ON sub.subject_id = a.subject_id
             JOIN students s ON s.student_id = m.student_id
             WHERE ${where.join(" AND ")}
             ORDER BY s.registration_number, sub.subject_code, a.assessment_date
             LIMIT 100`;
        params.push(...params2);
        explanation = `Raw marks${st ? " for " + st.full_name : ""}${atype ? " (" + atype + "s only)" : ""} with percentage of max.`;
        break;
      }

      case "top_performers": {
        const wantsWorst = /\b(worst|lowest|weakest|bottom)\b/i.test(q);
        const subj = findSubject(q);
        const subjJoin = subj ? `
             JOIN subjects sub2 ON sub2.subject_id = p.subject_id AND sub2.subject_code = '${subj.code}'` : "";
        sql = `SELECT s.registration_number, s.full_name, s.section, s.current_gpa,
               ROUND(AVG(p.predicted_score)::numeric, 1) AS avg_prediction,
               COUNT(*) FILTER (WHERE p.risk_level = 'On track') AS subjects_on_track,
               COUNT(*) AS subjects
             FROM students s
             JOIN v_latest_predictions p ON p.student_id = s.student_id${subjJoin}
             GROUP BY s.student_id, s.registration_number, s.full_name, s.section, s.current_gpa
             ORDER BY ${/\bgpa\b/i.test(q) ? (wantsWorst ? "s.current_gpa ASC" : "s.current_gpa DESC") : wantsWorst ? "avg_prediction ASC" : "avg_prediction DESC"}
             LIMIT ${extractLimit(q)?.n || 10}`;
        explanation = `${wantsWorst ? "Weakest" : "Top"} students ranked ${/\bgpa\b/i.test(q) ? "by GPA" : "by average prediction"}${subj ? " for " + subj.name : ""}.`;
        break;
      }

      case "bottom_performers": {
        sql = `SELECT s.registration_number, s.full_name, s.section, s.current_gpa,
               ROUND(AVG(p.predicted_score)::numeric, 1) AS avg_prediction,
               COUNT(*) FILTER (WHERE p.risk_level IN ('High','Critical')) AS at_risk_subjects
             FROM students s
             JOIN v_latest_predictions p ON p.student_id = s.student_id
             GROUP BY s.student_id, s.registration_number, s.full_name, s.section, s.current_gpa
             ORDER BY ${/\bgpa\b/i.test(q) ? "s.current_gpa ASC" : "avg_prediction ASC"}
             LIMIT ${extractLimit(q)?.n || 10}`;
        explanation = "Students ranked " + (/\bgpa\b/i.test(q) ? "by lowest GPA" : "by lowest average prediction") + " — those needing the most support.";
        break;
      }

      case "gpa_below": {
        const v = extractPercent(q) ?? 70;
        const scale = v > 10 ? v / 10 : v; // accept % or 10-scale
        sql = `SELECT s.registration_number, s.full_name, s.section, s.current_gpa,
               COUNT(*) FILTER (WHERE p.risk_level IN ('High','Critical')) AS at_risk_subjects
             FROM students s
             LEFT JOIN v_latest_predictions p ON p.student_id = s.student_id
             WHERE s.current_gpa < $1
             GROUP BY s.student_id, s.registration_number, s.full_name, s.section, s.current_gpa
             ORDER BY s.current_gpa ASC LIMIT 50`;
        params.push(scale);
        explanation = `Students with GPA below ${scale} (out of 10) and their at-risk subject counts.`;
        break;
      }

      case "gpa_top": {
        sql = `SELECT s.registration_number, s.full_name, s.section, s.current_gpa
             FROM students s ORDER BY s.current_gpa DESC LIMIT 10`;
        explanation = "Top 10 students by current GPA.";
        break;
      }

      case "priority_subject": {
        sql = `SELECT sub.subject_code, sub.subject_name,
               COUNT(*) FILTER (WHERE p.risk_level IN ('High','Critical')) AS at_risk,
               COUNT(*) AS total, ROUND(AVG(p.predicted_score)::numeric, 1) AS avg_score
             FROM v_latest_predictions p
             JOIN subjects sub ON sub.subject_id = p.subject_id
             GROUP BY sub.subject_code, sub.subject_name
             ORDER BY at_risk DESC, avg_score ASC`;
        explanation = "Subjects ranked by number of High/Critical students — where intervention matters most.";
        break;
      }

      case "risk_changes": {
        const s = q.toLowerCase();
        const dir = /\bimprov|better|recover|up\b/.test(s) ? "improved" : /\bdeclin|worse|dropp|down|fell\b/.test(s) ? "worsened" : "any";
        sql = `WITH ranked AS (
               SELECT p.student_id, p.subject_id, p.risk_level, p.predicted_at,
                      ROW_NUMBER() OVER (PARTITION BY p.student_id, p.subject_id ORDER BY p.predicted_at DESC) AS rn
               FROM predictions p
             )
             SELECT s.full_name, s.registration_number, sub.subject_code,
                    cur.risk_level AS now_risk, prev.risk_level AS previous_risk,
                    cur.predicted_at
             FROM ranked cur
             JOIN ranked prev ON prev.student_id = cur.student_id AND prev.subject_id = cur.subject_id AND prev.rn = 2
             JOIN students s ON s.student_id = cur.student_id
             JOIN subjects sub ON sub.subject_id = cur.subject_id
             WHERE cur.risk_level <> prev.risk_level
               ${dir === "improved" ? `AND (CASE cur.risk_level WHEN 'On track' THEN 0 WHEN 'Moderate' THEN 1 WHEN 'High' THEN 2 ELSE 3 END)
                                        < (CASE prev.risk_level WHEN 'On track' THEN 0 WHEN 'Moderate' THEN 1 WHEN 'High' THEN 2 ELSE 3 END)` : ""}
               ${dir === "worsened" ? `AND (CASE cur.risk_level WHEN 'On track' THEN 0 WHEN 'Moderate' THEN 1 WHEN 'High' THEN 2 ELSE 3 END)
                                        > (CASE prev.risk_level WHEN 'On track' THEN 0 WHEN 'Moderate' THEN 1 WHEN 'High' THEN 2 ELSE 3 END)` : ""}
             ORDER BY cur.predicted_at DESC LIMIT 50`;
        explanation = `Students whose risk level ${dir === "any" ? "changed" : dir} between their two most recent predictions.`;
        break;
      }

      case "pass_rate": {
        const subject = findSubject(q);
        const params2 = [];
        let where = "TRUE";
        if (subject) { params2.push(subject.code); where = `sub.subject_code = $1`; }
        sql = `SELECT sub.subject_code, sub.subject_name,
               ROUND(100.0 * COUNT(*) FILTER (WHERE p.pass_probability >= 50) / COUNT(*)) AS pass_rate_pct,
               ROUND(AVG(p.pass_probability)::numeric, 1) AS avg_pass_probability
             FROM v_latest_predictions p
             JOIN subjects sub ON sub.subject_id = p.subject_id
             WHERE ${where}
             GROUP BY sub.subject_code, sub.subject_name ORDER BY sub.subject_code`;
        params.push(...params2);
        explanation = "Share of predictions with pass probability ≥ 50%, per subject.";
        break;
      }

      case "compare_subjects": {
        sql = `SELECT sub.subject_code, sub.subject_name,
               ROUND(AVG(p.predicted_score)::numeric, 1) AS avg_score,
               ROUND(AVG(p.pass_probability)::numeric, 1) AS avg_pass_probability,
               COUNT(*) FILTER (WHERE p.risk_level = 'Critical') AS critical,
               COUNT(*) FILTER (WHERE p.risk_level = 'High') AS high,
               COUNT(*) FILTER (WHERE p.risk_level = 'Moderate') AS moderate,
               COUNT(*) FILTER (WHERE p.risk_level = 'On track') AS on_track,
               ROUND(AVG(f.attendance_pct)::numeric, 1) AS avg_attendance
             FROM v_latest_predictions p
             JOIN subjects sub ON sub.subject_id = p.subject_id
             LEFT JOIN v_student_attendance f ON f.student_id = p.student_id AND f.subject_id = p.subject_id
             GROUP BY sub.subject_code, sub.subject_name
             ORDER BY avg_score DESC`;
        explanation = "Side-by-side comparison of all subjects: scores, pass probability, risk mix and attendance.";
        break;
      }

      case "section_risk": {
        const section = extractSection(q);
        const params2 = [];
        let where = "TRUE";
        if (section) { params2.push(section); where = `s.section = $1`; }
        sql = `SELECT s.section,
               COUNT(*) FILTER (WHERE p.risk_level = 'Critical') AS critical,
               COUNT(*) FILTER (WHERE p.risk_level = 'High') AS high,
               COUNT(*) FILTER (WHERE p.risk_level = 'Moderate') AS moderate,
               COUNT(*) FILTER (WHERE p.risk_level = 'On track') AS on_track,
               ROUND(AVG(p.predicted_score)::numeric, 1) AS avg_score
             FROM v_latest_predictions p
             JOIN students s ON s.student_id = p.student_id
             WHERE ${where}
             GROUP BY s.section ORDER BY s.section`;
        params.push(...params2);
        explanation = `Risk mix per section${section ? " " + section : " (all sections)"}.`;
        break;
      }

      case "interventions": {
        const st = await extractStudent(q);
        const subject = findSubject(q);
        const params2 = [];
        const conds = [];
        if (st) { params2.push(st.student_id); conds.push(`i.student_id = $${params2.length}`); understood.push(`student ${st.full_name}`); }
        if (subject) { params2.push(subject.code); conds.push(`sub.subject_code = $${params2.length}`); }
        const where = conds.length ? conds.join(" AND ") : "TRUE";
        sql = `SELECT i.intervention_type, s.full_name, s.registration_number,
               sub.subject_code, i.status, i.review_date, u.full_name AS assigned_to
             FROM interventions i
             JOIN students s ON s.student_id = i.student_id
             LEFT JOIN subjects sub ON sub.subject_id = i.subject_id
             LEFT JOIN users u ON u.user_id = i.assigned_to
             WHERE ${where}
             ORDER BY CASE i.status WHEN 'Active' THEN 0 WHEN 'Planned' THEN 1 ELSE 2 END, i.review_date NULLS LAST
             LIMIT 50`;
        params.push(...params2);
        explanation = `Interventions${st ? " for " + st.full_name : ""}${subject ? " in " + subject.name : ""} ordered by urgency.`;
        break;
      }

      case "interventions_due": {
        sql = `SELECT i.intervention_type, s.full_name, s.registration_number,
               sub.subject_code, i.status, i.review_date, u.full_name AS assigned_to,
               i.review_date - CURRENT_DATE AS days_until_review
             FROM interventions i
             JOIN students s ON s.student_id = i.student_id
             LEFT JOIN subjects sub ON sub.subject_id = i.subject_id
             LEFT JOIN users u ON u.user_id = i.assigned_to
             WHERE i.status IN ('Active','Planned')
               AND i.review_date IS NOT NULL
               AND i.review_date <= CURRENT_DATE + INTERVAL '7 days'
             ORDER BY i.review_date ASC LIMIT 50`;
        explanation = "Active/planned interventions with a review due within 7 days.";
        break;
      }

      case "notifications": {
        sql = `SELECT n.severity, n.message, n.is_read, n.created_at, s.full_name AS student_name
             FROM notifications n
             LEFT JOIN students s ON s.student_id = n.student_id
             ORDER BY n.created_at DESC LIMIT 30`;
        explanation = "Latest notifications, newest first.";
        break;
      }

      case "recent_events": {
        sql = `SELECT e.event_type, e.processing_status, e.created_at,
               s.registration_number, sub.subject_code
             FROM academic_events e
             LEFT JOIN students s ON s.student_id = e.student_id
             LEFT JOIN subjects sub ON sub.subject_id = e.subject_id
             ORDER BY e.created_at DESC LIMIT 25`;
        explanation = "The 25 most recent rows from academic_events — the real-time audit trail.";
        break;
      }

      case "avg_score": {
        sql = `SELECT sub.subject_code, sub.subject_name,
               ROUND(AVG(p.predicted_score)::numeric, 1) AS avg_predicted_score,
               ROUND(AVG(p.pass_probability)::numeric, 1) AS avg_pass_probability,
               ROUND(AVG(f.attendance_pct)::numeric, 1) AS avg_attendance
             FROM v_latest_predictions p
             JOIN subjects sub ON sub.subject_id = p.subject_id
             LEFT JOIN v_student_attendance f ON f.student_id = p.student_id AND f.subject_id = p.subject_id
             GROUP BY sub.subject_code, sub.subject_name ORDER BY avg_predicted_score DESC`;
        explanation = "Cohort averages (predicted score, pass probability, attendance) per subject.";
        break;
      }

      case "risk_list":
      case "fallback": {
        // fallback with no recognizable entity → explain rather than dump data
        const subject0 = findSubject(q);
        const risks0 = extractRiskLevels(q);
        const st0 = intent === "fallback" ? await extractStudent(q) : null;
        if (intent === "fallback" && !subject0 && !risks0.length && !st0 && !/\b(at risk|attention|struggl|failing|risk)/.test(q.toLowerCase())) {
          return {
            question: q, intent, sql: "-- could not map question to a known query",
            safety: { ok: true, problems: [] },
            explanation: "I didn't understand that. I can answer questions like: 'Show at-risk students in DBMS', 'How many students are critical?', 'Attendance below 75%', 'Top 5 by GPA', 'Why is Aarav at risk?', 'Interventions due this week', or 'Compare subjects'. Type 'help' for the full list.",
            rows: [], rowCount: 0, durationMs: 0, error: null,
          };
        }
        // fallback that mentions a student → treat as profile question
        if (intent === "fallback" && st0 && !subject0 && !risks0.length) {
          sql = `SELECT sub.subject_code, sub.subject_name,
                 p.risk_level, p.predicted_score::numeric(5,1), p.pass_probability::numeric(5,1),
                 p.explanation, ROUND(a.attendance_pct) AS attendance_pct
               FROM v_latest_predictions p
               JOIN subjects sub ON sub.subject_id = p.subject_id
               LEFT JOIN v_student_attendance a ON a.student_id = p.student_id AND a.subject_id = p.subject_id
               WHERE p.student_id = $1
               ORDER BY CASE p.risk_level WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END`;
          params.push(st0.student_id);
          explanation = `Per-subject predictions with explanations for ${st0.full_name} (${st0.registration_number}).`;
          break;
        }
        const subject = subject0;
        const risks = risks0;
        const lim = extractLimit(q);
        const order = lim && ["bottom", "lowest", "worst", "last"].includes(lim.word)
          ? `p.predicted_score DESC` : undefined;
        const built = riskListSql(subject, risks.length ? risks : (intent === "risk_list" ? [] : ["High", "Critical"]), lim?.n || 50, order);
        sql = built.sql; params.push(...built.params);
        explanation = `Live predictions${subject ? " in " + subject.name : ""}${risks.length ? " filtered to " + risks.join("/") : " sorted by risk severity"}${lim ? ` (top ${lim.n})` : ""}.`;
        break;
      }
    }
  } catch (buildErr) {
    return { question: q, intent, sql, safety: { ok: false, problems: [String(buildErr.message)] }, explanation: "Failed to build query.", rows: [], rowCount: 0, error: String(buildErr.message) };
  }

  const safety = validateSafety(sql);
  if (!safety.ok) {
    return { question: q, intent, sql, safety, explanation, rows: null, error: safety.problems.join("; ") };
  }

  let rows, durationMs, error = null;
  try {
    const t0 = Date.now();
    const res = await pool.query(sql, params);
    durationMs = Date.now() - t0;
    rows = res.rows;
  } catch (err) {
    error = err.message;
    rows = [];
  }

  return { question: q, intent, sql, safety, explanation, rows, rowCount: rows?.length ?? 0, durationMs, error };
}
