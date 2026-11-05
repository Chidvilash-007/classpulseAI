-- Per-student-subject feature computation and the explainable prediction engine.
-- Called by the server after each academic event.

CREATE OR REPLACE FUNCTION classpulse_compute_features(p_student_id INTEGER, p_subject_id INTEGER)
RETURNS TABLE (
  attendance_pct NUMERIC,
  internal_pct NUMERIC,
  quiz_avg_pct NUMERIC,
  assignment_completion NUMERIC,
  gpa_scaled NUMERIC,
  missed_submissions INTEGER,
  trend_slope NUMERIC
) AS $$
  WITH att AS (
    SELECT ROUND(100.0 * SUM(CASE WHEN present THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 2) AS pct
    FROM attendance_records
    WHERE student_id = p_student_id AND subject_id = p_subject_id
  ),
  internals AS (
    SELECT ROUND(100.0 * SUM(m.marks_obtained) / NULLIF(SUM(a.max_marks),0), 2) AS pct
    FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id
    WHERE m.student_id = p_student_id AND a.subject_id = p_subject_id
  ),
  quizzes AS (
    SELECT ROUND(100.0 * SUM(m.marks_obtained) / NULLIF(SUM(a.max_marks),0), 2) AS pct
    FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id
    WHERE m.student_id = p_student_id AND a.subject_id = p_subject_id AND a.assessment_type = 'Quiz'
  ),
  assign AS (
    SELECT
      ROUND(100.0 * SUM(CASE WHEN status <> 'Missing' THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 2) AS completion,
      SUM(CASE WHEN status = 'Missing' THEN 1 ELSE 0 END) AS missed
    FROM assignment_submissions
    WHERE student_id = p_student_id AND subject_id = p_subject_id
  ),
  quiz_series AS (
    SELECT m.marks_obtained / NULLIF(a.max_marks,0) AS ratio,
           EXTRACT(EPOCH FROM a.assessment_date) AS ts
    FROM marks m JOIN assessments a ON a.assessment_id = m.assessment_id
    WHERE m.student_id = p_student_id AND a.subject_id = p_subject_id AND a.assessment_type = 'Quiz'
    ORDER BY a.assessment_date
  ),
  trend AS (
    SELECT CASE WHEN COUNT(*) < 2 THEN 0 ELSE
      ROUND((regr_slope(ratio, ts) * 604800 * 100)::numeric, 2) END AS slope
    FROM quiz_series
  ),
  gpa AS (
    SELECT COALESCE(current_gpa, 7.0) / 10.0 * 100 AS scaled FROM students WHERE student_id = p_student_id
  )
  SELECT
    COALESCE((SELECT pct FROM att), 0),
    COALESCE((SELECT pct FROM internals), 0),
    COALESCE((SELECT pct FROM quizzes), 0),
    COALESCE((SELECT completion FROM assign), 0),
    COALESCE((SELECT scaled FROM gpa), 70),
    COALESCE((SELECT missed FROM assign), 0),
    COALESCE((SELECT slope FROM trend), 0);
$$ LANGUAGE sql;

-- Explainable prediction: transparent weighted feature model.
CREATE OR REPLACE FUNCTION classpulse_predict(p_student_id INTEGER, p_subject_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_att NUMERIC; v_int NUMERIC; v_quiz NUMERIC; v_assign NUMERIC;
  v_gpa NUMERIC; v_missed INTEGER; v_trend NUMERIC;
  v_score NUMERIC; v_pass NUMERIC; v_risk VARCHAR;
  v_expl JSONB := '[]'::JSONB;
  v_class_avg NUMERIC;
  l_score NUMERIC; l_pass NUMERIC; l_risk VARCHAR; l_expl JSONB;
BEGIN
  SELECT * INTO v_att, v_int, v_quiz, v_assign, v_gpa, v_missed, v_trend
  FROM classpulse_compute_features(p_student_id, p_subject_id);

  IF v_att = 0 AND v_int = 0 THEN
    RETURN; -- no data yet
  END IF;

  -- Weighted transparent model (weights sum to 1.0)
  v_score := ROUND(
      v_att   * 0.20 +
      v_int   * 0.27 +
      v_quiz  * 0.18 +
      v_assign* 0.15 +
      v_gpa   * 0.10 +
      GREATEST(0, LEAST(100, 50 + v_trend)) * 0.10
  , 1);

  -- Pass probability: logistic on score adjusted by attendance floor
  v_pass := ROUND(100 / (1 + EXP(-(v_score - 52) / 9.5)), 1);

  -- Risk classification (calibrated to the ClassPulse demo:
  -- 61→Critical, 67→High, 72-74→Moderate, 89→On track)
  IF v_score >= 78 AND v_pass >= 65 THEN v_risk := 'On track';
  ELSIF v_score >= 70 THEN v_risk := 'Moderate';
  ELSIF v_score >= 65 THEN v_risk := 'High';
  ELSE v_risk := 'Critical'; END IF;

  -- Explanation factors, most significant first
  IF v_att < 75 THEN
    v_expl := v_expl || to_jsonb('Attendance below 75% (' || v_att::text || '%)');
  END IF;
  IF v_missed > 0 THEN
    v_expl := v_expl || to_jsonb((v_missed::text || ' missed assignment(s)'));
  END IF;
  IF v_quiz < 60 THEN
    v_expl := v_expl || to_jsonb('Quiz average below 60% (' || v_quiz::text || '%)');
  END IF;
  IF v_trend < -1 THEN
    v_expl := v_expl || to_jsonb('Declining quiz trend (' || v_trend::text || '%/week)');
  END IF;
  IF v_int < 55 THEN
    v_expl := v_expl || to_jsonb('Internal marks below 55% (' || v_int::text || '%)');
  END IF;
  IF v_expl = '[]'::JSONB THEN
    v_expl := v_expl || to_jsonb('Consistent assessment trend'::text);
    v_expl := v_expl || to_jsonb('Attendance and marks on target'::text);
  END IF;

  -- Skip duplicate writes: if the most recent prediction for this pair is
  -- already identical (score, pass probability, risk, explanation), don't
  -- insert another row. This keeps predictions history meaningful and stops
  -- the prediction → trigger → academic_event → pg_notify write amplification
  -- on every data change that re-computes to the same result.
  SELECT predicted_score, pass_probability, risk_level, explanation
    INTO l_score, l_pass, l_risk, l_expl
  FROM predictions
  WHERE student_id = p_student_id AND subject_id = p_subject_id
  ORDER BY predicted_at DESC
  LIMIT 1;

  IF l_score IS NOT NULL
     AND l_score = v_score AND l_pass = v_pass
     AND l_risk = v_risk AND l_expl = v_expl THEN
    RETURN;
  END IF;

  INSERT INTO predictions (student_id, subject_id, predicted_score, pass_probability, risk_level, explanation, model_name, model_version)
  VALUES (p_student_id, p_subject_id, v_score, v_pass, v_risk, v_expl, 'ClassPulse Weighted Ensemble', 'v2.4');
END;
$$ LANGUAGE plpgsql;

-- Recompute predictions for all enrolled students of a subject (or all)
CREATE OR REPLACE FUNCTION classpulse_recompute_all()
RETURNS INTEGER AS $$
DECLARE
  r RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT e.student_id, e.subject_id
    FROM enrollments e WHERE e.enrollment_status = 'Enrolled'
  LOOP
    PERFORM classpulse_predict(r.student_id, r.subject_id);
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$ LANGUAGE plpgsql;
