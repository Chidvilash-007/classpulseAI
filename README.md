# ClassPulse AI — Real-Time Academic Intelligence

A full-stack, **real-time** rebuild of the ClassPulse AI dashboard. Every number on
screen comes from a live **PostgreSQL** database — no mock data anywhere. Data
changes (attendance, marks, submissions) flow through DB triggers →
`academic_events` → `pg_notify` → **Server-Sent Events** → the dashboard, with
the explainable prediction engine re-scoring affected students automatically.

## What's inside

| Layer | Tech | Notes |
|---|---|---|
| Database | PostgreSQL 18 | Your original `classpulse` schema + triggers + SQL prediction engine |
| API | Node 24 + Express | REST + SSE at `/api/stream` |
| Real-time core | triggers → `pg_notify` → SSE | Any INSERT/UPDATE on academic tables reaches browsers in <1 s |
| Prediction | `classpulse_predict()` (plpgsql) | Transparent weighted model: attendance 20%, internals 27%, quizzes 18%, assignments 15%, GPA 10%, trend 10% |
| NL assistant | intent router + read-only role | 25+ question types — risk lists/counts, attendance, marks, GPA, trends, interventions, events, comparisons, per-student explanations. `npm run test:nlq` runs the 69-question battery |
| UI | React 18 + TypeScript + Vite | Faithful rebuild of the deployed demo, but every value is live |

## Quick start

Prereqs: PostgreSQL running locally, Node ≥ 20.

```bash
# 1. configure DB creds (if not already set)
#    server/.env → PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE

# 2. one-time setup: schema + triggers + engine + seed (248 students)
npm install
npm run db:init            # add --reseed to rebuild generated data

# 3. run backend + frontend together
npm run dev
#    API  → http://localhost:4000  (SSE at /api/stream)
#    UI   → http://localhost:5173
```

The server reads `PORT` defensively (a stray `PORT=0` in the shell env will not
break it — it falls back to 4000).

## The real-time pipeline

```
attendance/marks/submissions INSERT/UPDATE
        ↓  (row-level triggers in setup.sql)
academic_events  (audit trail, Pending → Processed)
        ↓  pg_notify('classpulse_events')
Node event bus  (LISTEN)
        ↓  SSE fan-out (/api/stream)
Dashboard  (React Query invalidation → instant refetch)
        ↘ event processor → classpulse_predict() → new prediction row
          → risk escalation? → notifications + PREDICTION_INSERT event
```

Watch it work: press **Simulate event** on the dashboard (or POST to
`/api/simulate`) and see the "updated Xs ago" ticker, event feed, and risk
numbers move without a reload.

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/overview` | KPI cards, subject pulse, risk distribution |
| `GET /api/students` | At-risk list (`?risk=&search=&limit=`) |
| `GET /api/students/:regNo` | Detail: trajectory, history, interventions |
| `GET/POST /api/interventions` | Queue + create (fires live events) |
| `GET /api/notifications` | Escalation feed |
| `POST /api/attendance`, `/api/marks` | Data entry → triggers the pipeline |
| `POST /api/simulate` | One random live academic event (demo button) |
| `POST /api/ask` | NL question → SQL → rows (read-only, validated) |
| `POST /api/recompute` | Bulk re-score (992 predictions in ~2 s) |
| `GET /api/events` | Recent `academic_events` audit rows |
| `GET /api/stream` | SSE: `academic_event` frames |

## Scripts

```bash
npm run db:init        # schema + triggers + engine + seed (idempotent-ish)
npm run db:seed        # full reseed: truncates generated data, rebuilds
npm run dev            # server + vite together
npm run build          # production bundle → dist/
npm start              # serve API + built UI from :4000 (NODE_ENV=production)
npm run test:nlq       # 69-question battery for the NL assistant
```

## Ask-the-data coverage

The assistant understands entity extraction (subjects by alias — DBMS/CN/OS/DSA,
student names in any case, registration numbers, sections, assessment types,
percent thresholds, top-N) and ~25 intents including:

- Risk: lists, counts (by subject/section/level), changes over time, pass rates
- Attendance: below X%, averages, per-subject summaries
- Marks: class averages per assessment, per-student marks, quiz/internal filters
- Rankings: top/bottom performers by GPA or prediction, per-subject
- Actions: interventions (all/per-student/due), notifications, recent events
- Meta: `help` (capabilities), "how does the prediction work" (model + pipeline)

It is strictly read-only: write/DDL questions are refused, multi-statement and
non-SELECT SQL is rejected by the validator, execution runs as
`classpulse_reader`, and unrecognizable questions get a helpful hint instead of
a meaningless data dump.

## Data story (calibrated to the original demo)

- 248 students monitored, 18 need attention (~7%), avg predicted ≈ 78
- Aarav Sharma (ST-2048): Critical across subjects — the flagship case
  (attendance ~47-71%, missed assignment, declining quizzes)
- Meera Iyer (ST-2204): On track — the contrast case
- 8 active interventions with real assignees and review dates
