-- ============================================================
-- ClassPulse AI — real-time plumbing
-- 1) read-only role for the NL→SQL assistant
-- 2) academic_events triggers + pg_notify for live dashboards
-- Safe to run multiple times (uses IF NOT EXISTS / OR REPLACE).
-- ============================================================

-- ---------- 1. Read-only role for the NL query assistant ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'classpulse_reader') THEN
    CREATE ROLE classpulse_reader LOGIN PASSWORD 'reader_only_pass';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE classpulse TO classpulse_reader;
GRANT USAGE ON SCHEMA public TO classpulse_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO classpulse_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO classpulse_reader;

-- ---------- 2. Trigger plumbing ----------
CREATE OR REPLACE FUNCTION classpulse_log_event()
RETURNS TRIGGER AS $$
DECLARE
  old_json JSONB;
  new_json JSONB;
  ts_val TIMESTAMPTZ;
  payload TEXT;
  ts_json JSONB;
  v_subject_id INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_json := to_jsonb(OLD);
    new_json := NULL;
  ELSE
    new_json := to_jsonb(NEW);
    IF TG_OP = 'UPDATE' THEN old_json := to_jsonb(OLD); ELSE old_json := NULL; END IF;
  END IF;

  -- created_at / predicted_at for a human-readable ts inside new_value
  ts_val := COALESCE(
    new_json->>'created_at',
    new_json->>'predicted_at',
    new_json->>'updated_at'
  )::TIMESTAMPTZ;

  ts_json := jsonb_build_object('iso', COALESCE(ts_val, NOW()));

  v_subject_id := NULLIF(COALESCE(new_json->>'subject_id', old_json->>'subject_id'), '')::INTEGER;
  IF v_subject_id IS NULL AND COALESCE(new_json->>'assessment_id', old_json->>'assessment_id') IS NOT NULL THEN
    SELECT subject_id INTO v_subject_id FROM assessments
    WHERE assessment_id = COALESCE(new_json->>'assessment_id', old_json->>'assessment_id')::INTEGER;
  END IF;

  INSERT INTO academic_events
    (event_type, student_id, subject_id, performed_by, old_value, new_value, processing_status)
  VALUES
    (TG_ARGV[0] || '_' || TG_OP,
     NULLIF(COALESCE(new_json->>'student_id', old_json->>'student_id'), '')::INTEGER,
     v_subject_id,
     NULLIF(COALESCE(new_json->>'recorded_by', new_json->>'entered_by', new_json->>'performed_by'), '')::INTEGER,
     old_json, new_json || ts_json, 'Pending');

  payload := json_build_object(
    'type',    TG_ARGV[0] || '_' || TG_OP,
    'student', COALESCE(new_json->>'student_id', old_json->>'student_id'),
    'subject', v_subject_id
  )::TEXT;

  PERFORM pg_notify('classpulse_events', payload);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Generic trigger attach helper
DROP TRIGGER IF EXISTS trg_attendance_event ON attendance_records;
CREATE TRIGGER trg_attendance_event
AFTER INSERT OR UPDATE OR DELETE ON attendance_records
FOR EACH ROW EXECUTE FUNCTION classpulse_log_event('ATTENDANCE');

DROP TRIGGER IF EXISTS trg_marks_event ON marks;
CREATE TRIGGER trg_marks_event
AFTER INSERT OR UPDATE OR DELETE ON marks
FOR EACH ROW EXECUTE FUNCTION classpulse_log_event('MARKS');

DROP TRIGGER IF EXISTS trg_submissions_event ON assignment_submissions;
CREATE TRIGGER trg_submissions_event
AFTER INSERT OR UPDATE OR DELETE ON assignment_submissions
FOR EACH ROW EXECUTE FUNCTION classpulse_log_event('ASSIGNMENT');

DROP TRIGGER IF EXISTS trg_prediction_event ON predictions;
CREATE TRIGGER trg_prediction_event
AFTER INSERT OR UPDATE ON predictions
FOR EACH ROW EXECUTE FUNCTION classpulse_log_event('PREDICTION');

DROP TRIGGER IF EXISTS trg_intervention_event ON interventions;
CREATE TRIGGER trg_intervention_event
AFTER INSERT OR UPDATE OR DELETE ON interventions
FOR EACH ROW EXECUTE FUNCTION classpulse_log_event('INTERVENTION');

DROP TRIGGER IF EXISTS trg_notification_event ON notifications;
CREATE TRIGGER trg_notification_event
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION classpulse_log_event('NOTIFICATION');

-- ---------- 2b. Indexes for hot analytics paths ----------
-- v_latest_predictions does DISTINCT ON (student_id, subject_id, predicted_at DESC);
-- the earlier (student_id, predicted_at) index left it with a seq scan + sort.
CREATE INDEX IF NOT EXISTS idx_predictions_student_subject_time
  ON predictions (student_id, subject_id, predicted_at DESC);
-- /api/events + dashboard recency queries ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS idx_events_created
  ON academic_events (created_at DESC);

-- ---------- 3. Lightweight analytics views used by API ----------
CREATE OR REPLACE VIEW v_latest_predictions AS
SELECT DISTINCT ON (p.student_id, p.subject_id)
  p.prediction_id, p.student_id, p.subject_id,
  p.predicted_score, p.pass_probability, p.risk_level,
  p.model_name, p.model_version, p.explanation, p.predicted_at
FROM predictions p
ORDER BY p.student_id, p.subject_id, p.predicted_at DESC;

CREATE OR REPLACE VIEW v_student_attendance AS
SELECT s.student_id, sub.subject_id,
  ROUND(100.0 * SUM(CASE WHEN a.present THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS attendance_pct,
  COUNT(*) AS total_classes, SUM(CASE WHEN a.present THEN 1 ELSE 0 END) AS present_classes
FROM students s
CROSS JOIN subjects sub
JOIN enrollments e ON e.student_id = s.student_id AND e.subject_id = sub.subject_id
LEFT JOIN attendance_records a
  ON a.student_id = s.student_id AND a.subject_id = sub.subject_id
GROUP BY s.student_id, sub.subject_id;
