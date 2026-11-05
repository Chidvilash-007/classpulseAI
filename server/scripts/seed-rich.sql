-- ============================================================
-- ClassPulse AI — rich seed
-- Expands the base seed to a realistic cohort whose aggregate
-- numbers land close to the demo (248 monitored, 17 need
-- attention, 76.8 avg predicted score, 9 active interventions).
-- Attendance / assessments / marks / submissions are generated
-- so the prediction engine has real features to work with.
-- Safe to re-run: truncates and rebuilds the generated data.
-- ============================================================

BEGIN;

-- Reset generated data (keep departments/programs/users/subjects base rows)
TRUNCATE academic_events, audit_logs, notifications, intervention_results,
         interventions, predictions, marks, assignment_submissions,
         assessments, attendance_records, enrollments, faculty_subjects RESTART IDENTITY CASCADE;

-- ---------- faculty_subjects ----------
INSERT INTO faculty_subjects (faculty_id, subject_id, semester_label)
SELECT u.user_id, s.subject_id, 'Sem 5'
FROM users u
CROSS JOIN subjects s
WHERE u.email = 'meera.faculty@classpulse.local'
  AND s.subject_code IN ('CS402','CS318','CS224','CS201')
ON CONFLICT DO NOTHING;

-- ---------- Enrollments + students ----------
-- 5 named demo students + 243 generated = 248 total
INSERT INTO students (registration_number, full_name, email, department_id, program_id, semester, section, current_gpa, status)
SELECT
  'ST-' || (9000 + g),
  'Student ' || g,
  'student' || g || '@student.local',
  d.department_id,
  p.program_id,
  5,
  CASE WHEN g % 2 = 0 THEN 'A' ELSE 'B' END,
  ROUND((6 + ((g * 37) % 30) / 10.0)::numeric, 2),
  'Active'
FROM generate_series(1, 243) g
CROSS JOIN departments d
JOIN programs p ON p.department_id = d.department_id
WHERE d.department_code = 'CSE'
ON CONFLICT (registration_number) DO NOTHING;

-- Enroll every student in all 4 subjects
INSERT INTO enrollments (student_id, subject_id, academic_year, semester_label, enrollment_status)
SELECT st.student_id, sub.subject_id, '2025-26', 'Sem 5', 'Enrolled'
FROM students st
CROSS JOIN subjects sub
JOIN departments d ON d.department_id = st.department_id AND d.department_code = 'CSE'
ON CONFLICT DO NOTHING;

-- ---------- Attendance (last 45 days, deterministic pattern) ----------
INSERT INTO attendance_records (student_id, subject_id, attendance_date, present, recorded_by)
SELECT
  st.student_id,
  sub.subject_id,
  CURRENT_DATE - g,
  -- deterministic pseudo-random presence tuned so demo students hit target %s
  ( (st.student_id * 7 + sub.subject_id * 13 + g * 3) % 100 ) <
    CASE
      WHEN st.registration_number = 'ST-2048' THEN 60   -- Aarav  ≈ 60-66% (demo: below 70%)
      WHEN st.registration_number = 'ST-2117' THEN 72   -- Diya   ≈ 72-76%
      WHEN st.registration_number = 'ST-1983' THEN 80   -- Rohan  ≈ 80-81%
      WHEN st.registration_number = 'ST-2204' THEN 93   -- Meera  ≈ 93-94%
      WHEN st.registration_number = 'ST-2076' THEN 70   -- Kabir  ≈ 70-73%
      ELSE 78 + ((st.student_id + g) % 15)              -- cohort 78-93%
    END,
  (SELECT user_id FROM users WHERE email = 'meera.faculty@classpulse.local')
FROM students st
CROSS JOIN subjects sub
CROSS JOIN generate_series(0, 44) g
JOIN departments d ON d.department_id = st.department_id AND d.department_code = 'CSE'
ON CONFLICT DO NOTHING;

-- ---------- Assessments per subject ----------
INSERT INTO assessments (subject_id, assessment_name, assessment_type, max_marks, assessment_date)
SELECT sub.subject_id, x.name, x.atype, x.maxm, CURRENT_DATE - (x.weeks * 7)
FROM subjects sub
CROSS JOIN (VALUES
  ('Quiz 1',        'Quiz',       10, 6),
  ('Quiz 2',        'Quiz',       10, 4),
  ('Quiz 3',        'Quiz',       10, 2),
  ('Internal 1',    'Internal',  30, 5),
  ('Assignment 1',  'Assignment', 20, 7),
  ('Assignment 2',  'Assignment', 20, 3)
) AS x(name, atype, maxm, weeks)
JOIN departments d ON d.department_id = sub.department_id AND d.department_code = 'CSE';

-- ---------- Marks ----------
INSERT INTO marks (student_id, assessment_id, marks_obtained, entered_by)
SELECT
  st.student_id,
  a.assessment_id,
  -- student ability 0..1 derived from GPA + risk profile of demo students
  ROUND(
    (CASE
      WHEN st.registration_number = 'ST-2048' THEN 0.42 + ((a.assessment_id * 5 + st.student_id) % 12) / 100.0
      WHEN st.registration_number = 'ST-2117' THEN 0.50 + ((a.assessment_id * 5 + st.student_id) % 12) / 100.0
      WHEN st.registration_number = 'ST-1983' THEN 0.62 + ((a.assessment_id * 5 + st.student_id) % 12) / 100.0
      WHEN st.registration_number = 'ST-2204' THEN 0.86 + ((a.assessment_id * 5 + st.student_id) % 10) / 100.0
      WHEN st.registration_number = 'ST-2076' THEN 0.66 + ((a.assessment_id * 5 + st.student_id) % 10) / 100.0
      WHEN (st.student_id % 47) < 1 THEN 0.44 + ((st.student_id * 7 + a.assessment_id * 11) % 18) / 100.0  -- struggling tail
      ELSE 0.70 + ((st.student_id * 7 + a.assessment_id * 11) % 20) / 100.0
    END
    * a.max_marks)::numeric, 1),
  (SELECT user_id FROM users WHERE email = 'meera.faculty@classpulse.local')
FROM students st
CROSS JOIN assessments a
JOIN subjects sub ON sub.subject_id = a.subject_id
JOIN departments d ON d.department_id = st.department_id AND d.department_code = 'CSE';

-- ---------- Assignment submissions ----------
INSERT INTO assignment_submissions (student_id, subject_id, assignment_name, submitted_at, status, score)
SELECT
  st.student_id,
  sub.subject_id,
  x.name,
  CASE WHEN sub_status.status = 'Missing' THEN NULL
       ELSE NOW() - (sub_status.days_late || ' days')::interval END,
  sub_status.status,
  CASE WHEN sub_status.status = 'Missing' THEN NULL ELSE ROUND((12 + (st.student_id % 8))::numeric, 1) END
FROM students st
CROSS JOIN subjects sub
CROSS JOIN (VALUES ('Assignment 1', 0), ('Assignment 2', 1)) AS x(name, idx)
JOIN LATERAL (
  SELECT
    CASE
      WHEN st.registration_number = 'ST-2048' AND x.idx = 0 THEN 'Missing'
      WHEN st.registration_number = 'ST-2048' AND x.idx = 1 THEN 'Late'
      WHEN st.registration_number = 'ST-2117' THEN 'Late'
      WHEN (st.student_id + sub.subject_id + x.idx) % 9 = 0 THEN 'Missing'
      WHEN (st.student_id + sub.subject_id + x.idx) % 7 = 0 THEN 'Late'
      ELSE 'Submitted'
    END AS status,
    CASE
      WHEN st.registration_number = 'ST-2048' AND x.idx = 1 THEN 3
      WHEN st.registration_number = 'ST-2117' THEN 2
      ELSE 0
    END AS days_late
  ) AS sub_status ON TRUE
JOIN departments d ON d.department_id = st.department_id AND d.department_code = 'CSE';

-- ---------- Interventions (demo story: Aarav/CS402 is the flagship case) ----------
INSERT INTO interventions (student_id, subject_id, assigned_to, intervention_type, description, start_date, review_date, status)
SELECT s.student_id, sub.subject_id, u.user_id, x.itype, x.descr,
       CURRENT_DATE - x.started_days_ago, CURRENT_DATE + x.review_in_days, x.status
FROM (VALUES
  ('ST-2048','CS402','One-on-one mentoring','Weekly 30-min session with assigned mentor focusing on SQL fundamentals and query practice.',21,7,'Active'),
  ('ST-2048','CS402','Attendance recovery plan','Morning-slot timetable adjustment with weekly attendance review by class advisor.',14,5,'Active'),
  ('ST-2048','CS201','Assignment support','Guided lab hour after class plus resubmission window for the missed assignment.',7,10,'Active'),
  ('ST-2117','CS318','Peer study group','Paired with a high-performing peer for subnetting practice twice a week.',10,6,'Active'),
  ('ST-2117','CS318','Late-submission policy coaching','Counsellor check-in on time management and planner use.',12,4,'Active'),
  ('ST-1983','CS224','Quiz revision sessions','Targeted revision of scheduling and deadlock topics before next quiz.',6,9,'Planned'),
  ('ST-2076','CS201','Attendance nudges','Automated weekly attendance summary sent to student and parent.',30,8,'Active'),
  ('ST-2204','CS402','Advanced enrichment','Extension tasks and mini-project mentoring to sustain momentum.',15,20,'Active'),
  ('ST-2048','CS318','Counselling referral','Referral to academic counsellor for holistic progress review.',5,12,'Completed')
) AS x(reg_no, sub_code, itype, descr, started_days_ago, review_in_days, status)
JOIN students s ON s.registration_number = x.reg_no
JOIN subjects sub ON sub.subject_code = x.sub_code
JOIN users u ON u.email = 'aarav.mentor@classpulse.local'
WHERE NOT EXISTS (
  SELECT 1 FROM interventions i
  WHERE i.student_id = s.student_id AND i.subject_id = sub.subject_id
    AND i.intervention_type = x.itype
);

-- ---------- Intervention results for the completed case ----------
INSERT INTO intervention_results (intervention_id, before_score, after_score, before_attendance, after_attendance, outcome, faculty_notes, reviewed_at)
SELECT i.intervention_id, 54.0, 63.5, 61.0, 70.0, 'Improved',
       'Attendance improved after timetable change; scores trending up.', NOW() - INTERVAL '2 days'
FROM interventions i
JOIN students s ON s.student_id = i.student_id
WHERE s.registration_number = 'ST-2048' AND i.intervention_type = 'Counselling referral'
  AND NOT EXISTS (SELECT 1 FROM intervention_results r WHERE r.intervention_id = i.intervention_id);

COMMIT;
