import { pool } from "../db.mjs";
import { recomputePrediction } from "./predictor.mjs";
import { bus } from "../eventbus.mjs";

// Drains Pending academic_events → recalculates predictions → marks Processed.
// Primary trigger: pg_notify (event arrives → drain within ~100 ms).
// Safety net: 5 s timer catches anything the notify fan-out missed.
//
// Efficiency guards:
//  - notify bursts are coalesced into ONE pending drain instead of one timer
//    per event (bulk attendance used to fire hundreds of overlapping drains)
//  - academic_events is retained for EVENT_RETENTION_DAYS (default 14): the
//    audit log used to grow unboundedly (~53k rows in under two weeks) and
//    every /api/events + dashboard query had to scan past its history.
const RETENTION_DAYS = (() => {
  const d = Number(process.env.EVENT_RETENTION_DAYS);
  return Number.isFinite(d) && d > 0 ? d : 14;
})();

export function startEventProcessor() {
  let lastPrune = 0;

  const tick = async () => {
    try {
      // Hourly housekeeping: prune old audit rows (index-backed, bounded work).
      if (Date.now() - lastPrune > 60 * 60 * 1000) {
        lastPrune = Date.now();
        await pool.query(
          `DELETE FROM academic_events WHERE created_at < NOW() - ($1 || ' days')::interval`,
          [RETENTION_DAYS]
        );
      }

      // Events that need recompute work (data changes):
      const { rows } = await pool.query(
        `SELECT event_id, event_type, student_id, subject_id
         FROM academic_events
         WHERE processing_status = 'Pending'
           AND event_type NOT LIKE 'PREDICTION%'   -- avoid recursion
           AND event_type NOT LIKE 'NOTIFICATION%'
         ORDER BY created_at ASC
         LIMIT 50`
      );
      for (const ev of rows) {
        if (ev.student_id && ev.subject_id) {
          await recomputePrediction(ev.student_id, ev.subject_id);
        }
        await pool.query(
          `UPDATE academic_events SET processing_status='Processed', processed_at=NOW()
           WHERE event_id = $1`,
          [ev.event_id]
        );
      }
      // Self-originated events (predictions/notifications) need no recompute:
      // once the notification fan-out had a moment to land, mark them Processed.
      await pool.query(
        `UPDATE academic_events
         SET processing_status='Processed', processed_at=NOW()
         WHERE processing_status='Pending'
           AND (event_type LIKE 'PREDICTION%' OR event_type LIKE 'NOTIFICATION%')
           AND created_at < NOW() - INTERVAL '2 seconds'`
      );
    } catch (err) {
      console.error("event processor error:", err.message);
    }
  };

  // instant drain on notify — coalesced: many pg_notify events in a burst
  // schedule a single future drain instead of one timer each.
  let pending = null;
  const onNotify = () => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; tick(); }, 50);
  };
  bus.on("academic_event", onNotify);
  const timer = setInterval(tick, 5000);
  return {
    stop: () => {
      clearInterval(timer);
      if (pending) clearTimeout(pending);
      bus.off("academic_event", onNotify);
    },
  };
}
