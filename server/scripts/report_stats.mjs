import pg from "pg";
const pool = new pg.Pool({ host: "127.0.0.1", port: 5432, user: "postgres", password: "postgres", database: "classpulse", max: 5 });

const q = async (sql, params) => (await pool.query(sql, params)).rows;

const out = {};

out.tables = await q(`
  SELECT 'students' AS t, count(*) AS n FROM students
  UNION ALL SELECT 'enrollments', count(*) FROM enrollments
  UNION ALL SELECT 'subjects', count(*) FROM subjects
  UNION ALL SELECT 'attendance_records', count(*) FROM attendance_records
  UNION ALL SELECT 'assessments', count(*) FROM assessments
  UNION ALL SELECT 'marks', count(*) FROM marks
  UNION ALL SELECT 'assignment_submissions', count(*) FROM assignment_submissions
  UNION ALL SELECT 'predictions', count(*) FROM predictions
  UNION ALL SELECT 'interventions', count(*) FROM interventions
  UNION ALL SELECT 'intervention_results', count(*) FROM intervention_results
  UNION ALL SELECT 'notifications', count(*) FROM notifications
  UNION ALL SELECT 'academic_events', count(*) FROM academic_events
  UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
  UNION ALL SELECT 'users', count(*) FROM users
  UNION ALL SELECT 'faculty_subjects', count(*) FROM faculty_subjects
  ORDER BY n DESC`);

out.ranges = await q(`
  SELECT 'attendance' AS tbl, min(attendance_date)::text AS mn, max(attendance_date)::text AS mx, count(distinct attendance_date) AS days FROM attendance_records
  UNION ALL SELECT 'predictions', min(predicted_at)::text, max(predicted_at)::text, NULL::int FROM predictions
  UNION ALL SELECT 'assessment_dates', min(assessment_date)::text, max(assessment_date)::text, count(distinct assessment_date)::int FROM assessments
  UNION ALL SELECT 'academic_events', min(created_at)::text, max(created_at)::text, NULL::int FROM academic_events`);

out.departments = await q(`SELECT d.department_name AS dept, count(*) AS students FROM students s JOIN departments d USING (department_id) GROUP BY d.department_name ORDER BY students DESC`);
out.sections = await q(`SELECT section, count(*) AS students FROM students GROUP BY section ORDER BY students`);
out.subjects = await q(`SELECT subject_code, subject_name FROM subjects ORDER BY subject_code`);
out.gpa = await q(`SELECT min(current_gpa)::numeric(4,2) AS mn, round(avg(current_gpa)::numeric(4,2),2) AS avg, max(current_gpa)::numeric(4,2) AS mx FROM students`);
out.risk_dist = await q(`SELECT risk_level, count(*) AS n FROM v_latest_predictions GROUP BY risk_level ORDER BY n DESC`);
out.events_types = await q(`SELECT event_type, count(*) AS n FROM academic_events GROUP BY event_type ORDER BY n DESC LIMIT 12`);
out.marks_stats = await q(`SELECT count(DISTINCT m.assessment_id) AS assessments_used, round(avg(m.marks_obtained::numeric/a.max_marks::numeric*100),1) AS avg_pct FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id`);

console.log(JSON.stringify(out, null, 1));
await pool.end();
