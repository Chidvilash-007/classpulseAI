import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit, LayoutDashboard, MessageSquareText, CircleAlert, Target,
  ChartColumn, Users, GraduationCap, Search, Bell, CircleHelp, BookOpen,
  ShieldCheck, Settings2, ChevronRight, Ellipsis, Play, Database, Command,
  RefreshCw, Sparkles, Filter, ArrowDownRight, Clock3, Check, CalendarDays,
  X, FileText, UserPlus, Lock, LogOut, Save,
} from "lucide-react";
import { api, getToken, setToken, type StudentRow, type Overview, type StudentDetail, type Intervention, type Notification, type AskAnswer, type AuthUser, type RosterRow, type AssessmentRow } from "./api";
import { useLiveStream } from "./hooks/useLive";

/* ---------- small building blocks ---------- */

function RiskPill({ risk }: { risk: string }) {
  return (
    <span className={`risk-pill ${risk === "Critical" ? "risk-critical" : risk === "High" ? "risk-high" : risk === "Moderate" ? "risk-moderate" : "risk-track"}`}>
      <span className="risk-dot" />
      {risk}
    </span>
  );
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i / Math.max(points.length - 1, 1)) * 100},${28 - ((p - min) / Math.max(max - min, 1)) * 22}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-24">
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function Metric({ label, value, sub, trend, tone, icon: Icon }: {
  label: string; value: string | number; sub: string; trend: string; tone: string; icon: typeof Users;
}) {
  const points = tone === "coral" ? [18, 14, 16, 13, 9, 12, 7, 10]
    : tone === "amber" ? [8, 12, 10, 13, 15, 12, 17, 14]
    : tone === "teal" ? [12, 13, 12, 15, 16, 18, 17, 22]
    : [8, 10, 9, 14, 13, 16, 18, 19];
  const color = tone === "coral" ? "#d77b55" : tone === "amber" ? "#d5a545" : tone === "teal" ? "#568d9b" : "#55a47d";
  return (
    <div className="metric">
      <div className="flex items-start justify-between">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="metric-value">{value}</p>
        </div>
        <div className={`metric-icon ${tone}`}><Icon size={17} /></div>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <span className="metric-sub"><span className={`metric-trend ${tone}`}>{trend}</span> {sub}</span>
        <Sparkline points={points} color={color} />
      </div>
    </div>
  );
}

/* ---------- dropdown / dialog helpers ---------- */

function useOutsideClose(ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [ref, close]);
}

function Menu({ items, align = "right" }: { items: { label: string; icon?: typeof Users; onClick: () => void }[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button className="more-button" onClick={() => setOpen(o => !o)}><Ellipsis size={16} /></button>
      {open && (
        <div className={`menu-popover ${align === "right" ? "right-0" : "left-0"}`}>
          {items.map(it => (
            <button key={it.label} className="menu-item" onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon ? <it.icon size={13} /> : <Check size={13} className="opacity-0" />}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Dialog({ title, sub, onClose, children, width = "max-w-lg" }: {
  title: string; sub?: string; onClose: () => void; children: React.ReactNode; width?: string;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${width}`}>
        <div className="dialog-head">
          <div>
            <h3 className="font-display text-[15px] font-bold text-[#244b5b]">{title}</h3>
            {sub && <p className="mt-0.5 text-[10px] font-semibold text-[#829799]">{sub}</p>}
          </div>
          <button className="more-button" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-[#dce6e2] bg-white px-3 py-2 text-[11px] font-semibold text-[#315568] outline-none focus:border-[#4b928d]";

/* ---------- ask panel ---------- */

function AskPanel({ onNotice }: { onNotice: (m: string) => void }) {
  const [question, setQuestion] = useState("Which CSE students are at risk in DBMS?");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);

  const run = async (q?: string) => {
    const query = (q ?? question).trim();
    if (!query) { onNotice("Type a question first"); return; }
    if (q) setQuestion(q);
    setBusy(true);
    try {
      const ans = await api.ask(query);
      setAnswer(ans);
      onNotice(ans.error ? "Query blocked: " + ans.error : `Live query answered — ${ans.rowCount ?? 0} rows from PostgreSQL`);
    } catch (e) {
      onNotice("Query failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ask-panel mt-5">
      <div className="ask-top">
        <div className="flex items-center gap-3">
          <div className="ask-icon"><MessageSquareText size={17} /></div>
          <div>
            <p className="eyebrow">Ask your academic database</p>
            <h2 className="mt-1 font-display text-[15px] font-bold text-[#264a5a]">What would you like to understand?</h2>
          </div>
        </div>
        <div className="ask-meta"><Database size={13} /> student_performance · read-only <span className="pulse" /></div>
      </div>
      <div className="ask-input-row">
        <Command size={16} className="mt-1 text-[#70a49f]" />
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} />
        <button className="run-button" onClick={() => run()} disabled={busy}>
          {busy
            ? <><RefreshCw size={14} className="animate-spin" /> Thinking...</>
            : <><Sparkles size={14} /> Ask ClassPulse</>}
        </button>
      </div>
      <div className="ask-hints">
        <span>Try asking:</span>
        <button onClick={() => run("Why is Aarav at risk in Database Management Systems?")}>Why is Aarav at risk?</button>
        <button onClick={() => run("Show students whose attendance fell below 75% this week")}>Attendance below 75%</button>
        <button onClick={() => run("Which subject needs the most faculty intervention?")}>Priority subject</button>
        <button onClick={() => run("How many students are critical in DBMS?")}>Count critical</button>
        <button onClick={() => run("Top 5 by GPA")}>Top by GPA</button>
        <button onClick={() => run("Interventions due this week")}>Due this week</button>
        <button onClick={() => run("help")}>More…</button>
      </div>
      {answer && (
        <div className="ask-answer">
          <div className="ask-answer-head">
            <span className={`sql-badge ${answer.safety.ok ? "sql-ok" : "sql-blocked"}`}>
              {answer.safety.ok ? "✓ safety validated · read-only" : "✗ blocked"}
            </span>
            <span className="text-[10px] font-semibold text-[#829799]">
              intent: {answer.intent}{answer.durationMs != null ? ` · ${answer.durationMs} ms` : ""} · {answer.rowCount ?? 0} rows
            </span>
          </div>
          <p className="mb-2 text-[10px] font-semibold text-[#71988f]">{answer.explanation}</p>
          <pre className="sql-preview">{answer.sql}</pre>
          {answer.error && <p className="mb-2 text-[10px] font-bold text-[#c56b50]">{answer.error}</p>}
          {answer.rows && answer.rows.length > 0 && (
            <div className="ask-table-wrap">
              <table className="ask-table">
                <thead>
                  <tr>{Object.keys(answer.rows[0]).slice(0, 6).map(k => <th key={k}>{k.replace(/_/g, " ")}</th>)}</tr>
                </thead>
                <tbody>
                  {answer.rows.slice(0, 8).map((row, i) => (
                    <tr key={i}>{Object.keys(answer.rows![0]).slice(0, 6).map(k => (
                      <td key={k}>{String(row[k] ?? "—")}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- intervention dialog (shared) ---------- */

function InterventionDialog({ initialReg, onClose, onNotice, onCreated }: {
  initialReg: string; onClose: () => void; onNotice: (m: string) => void; onCreated?: () => void;
}) {
  const [form, setForm] = useState({
    registrationNumber: initialReg || "", subjectCode: "CS402",
    interventionType: "Remedial class", description: "",
    assignedToEmail: "aarav.mentor@classpulse.local", reviewDate: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const create = async () => {
    if (!form.registrationNumber.trim()) { setErr("Registration number is required"); return; }
    setBusy(true); setErr("");
    try {
      await api.createIntervention({ ...form, reviewDate: form.reviewDate || null });
      onNotice(`Intervention created for ${form.registrationNumber} — live in the queue`);
      onCreated?.();
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Plan intervention" sub="Writes to the interventions table & fires a real-time event" onClose={onClose}>
      <div className="space-y-3">
        <div><p className="eyebrow mb-1">Student (registration number)</p>
          <input className={inputCls} value={form.registrationNumber} onChange={e => setForm({ ...form, registrationNumber: e.target.value })} placeholder="ST-2048" /></div>
        <div><p className="eyebrow mb-1">Subject code</p>
          <select className={inputCls} value={form.subjectCode} onChange={e => setForm({ ...form, subjectCode: e.target.value })}>
            {["CS402", "CS318", "CS224", "CS201"].map(c => <option key={c}>{c}</option>)}
          </select></div>
        <div><p className="eyebrow mb-1">Intervention type</p>
          <select className={inputCls} value={form.interventionType} onChange={e => setForm({ ...form, interventionType: e.target.value })}>
            {["Remedial class", "Counselling session", "Peer mentoring", "Attendance improvement plan", "Assignment support", "Follow-up review"].map(t => <option key={t}>{t}</option>)}
          </select></div>
        <div><p className="eyebrow mb-1">Description</p>
          <textarea className={inputCls} rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="eyebrow mb-1">Assign to</p>
            <select className={inputCls} value={form.assignedToEmail} onChange={e => setForm({ ...form, assignedToEmail: e.target.value })}>
              <option value="aarav.mentor@classpulse.local">Aarav Rao (mentor)</option>
              <option value="meera.faculty@classpulse.local">Dr. Meera Menon (faculty)</option>
              <option value="kavya.counsellor@classpulse.local">Dr. Kavya Iyer (counsellor)</option>
            </select></div>
          <div><p className="eyebrow mb-1">Review date</p>
            <input type="date" className={inputCls} value={form.reviewDate} onChange={e => setForm({ ...form, reviewDate: e.target.value })} /></div>
        </div>
        {err && <p className="text-[10px] font-bold text-[#c56b50]">{err}</p>}
        <button className="primary-button w-full" onClick={create} disabled={busy}>
          {busy ? "Saving..." : <><Target size={13} /> Create intervention</>}
        </button>
      </div>
    </Dialog>
  );
}

/* ---------- student detail dialog (full profile) ---------- */

function StudentDetailDialog({ regNo, onClose, onNotice, onIntervene }: {
  regNo: string; onClose: () => void; onNotice: (m: string) => void; onIntervene: (reg: string) => void;
}) {
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"trajectory" | "timeline" | "factors">("trajectory");
  useEffect(() => {
    api.student(regNo).then(setDetail).catch(e => setErr((e as Error).message));
  }, [regNo]);

  const line = detail?.trajectory.length
    ? detail.trajectory.map(t => t.pct)
    : null;

  return (
    <Dialog title={detail ? `${detail.name} — ${detail.id}` : "Loading student…"} sub={detail ? `${detail.department} · ${detail.section} · GPA ${detail.gpa}` : undefined} onClose={onClose} width="max-w-2xl">
      {err && <p className="text-[11px] font-bold text-[#c56b50]">Failed to load: {err}</p>}
      {!detail && !err && <p className="p-4 text-[11px] text-[#8a9da2]">Loading from PostgreSQL…</p>}
      {detail && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="profile-avatar">{detail.initials}</div>
            <div className="flex-1">
              <RiskPill risk={detail.risk} />
              <p className="mt-1.5 text-[11px] font-semibold text-[#718b92]">
                Latest prediction <b className="text-[#315568]">{detail.prediction}/100</b> · pass probability <b className="text-[#315568]">{detail.passProbability}%</b> · attendance <b className={detail.attendance < 75 ? "text-[#cd7859]" : "text-[#315568]"}>{detail.attendance}%</b>
              </p>
            </div>
            <button className="primary-button" onClick={() => onIntervene(detail.id)}><Target size={13} /> Intervene</button>
          </div>

          <div className="mb-3 flex gap-1.5">
            {(["trajectory", "timeline", "factors"] as const).map(t => (
              <button key={t} className={`filter-button ${tab === t ? "!bg-[#e4f0ed] !text-[#2e696a]" : ""}`} onClick={() => setTab(t)}>
                {t === "trajectory" ? "Performance" : t === "timeline" ? "Prediction history" : "Why this prediction"}
              </button>
            ))}
          </div>

          {tab === "trajectory" && (
            <div>
              {line && line.length > 1 ? (
                <>
                  <div className="chart-bars h-28">
                    {line.map((p, i) => (
                      <div key={i} className="bar-wrap">
                        <div className={`chart-bar ${i > line.length - 3 && detail.risk === "Critical" ? "bar-risk" : ""}`} style={{ height: `${Math.max(12, p - 10)}%` }} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.trajectory.map((t, i) => (
                      <span key={i} className="rounded-md bg-[#f0f5f2] px-2 py-1 text-[9px] font-bold text-[#52717c]">{t.label}: {t.pct}%</span>
                    ))}
                  </div>
                </>
              ) : <p className="p-2 text-[11px] text-[#8a9da2]">Not enough assessment history yet.</p>}
              <div className="mt-4">
                <p className="eyebrow mb-2">All subjects</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.allSubjects.map(s => (
                    <div key={s.subjectCode} className="flex items-center justify-between rounded-lg border border-[#edf1ef] px-3 py-2">
                      <div>
                        <p className="text-[10px] font-bold text-[#3b5a66]">{s.subject}</p>
                        <p className="text-[9px] text-[#8a9da2]">attendance {s.attendance}%</p>
                      </div>
                      <div className="text-right">
                        <RiskPill risk={s.risk} />
                        <p className="mt-1 text-[10px] font-bold text-[#315568]">{s.prediction}/100</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "timeline" && (
            <div className="space-y-2">
              {detail.predictionHistory.length === 0 && <p className="text-[11px] text-[#8a9da2]">No prediction history yet.</p>}
              {detail.predictionHistory.slice().reverse().slice(0, 12).map((h, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-[#edf1ef] px-3 py-2">
                  <Clock3 size={13} className="text-[#4b928d]" />
                  <span className="text-[10px] font-bold text-[#315568]">{Math.round(Number(h.predicted_score))}/100</span>
                  <RiskPill risk={h.risk_level} />
                  <span className="ml-auto text-[9px] text-[#8a9da2]">{new Date(h.predicted_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "factors" && (
            <div className="space-y-2">
              {detail.factors.map((f, i) => (
                <div key={i} className="factor"><span>{i + 1}</span><p>{f}</p><ArrowDownRight size={13} className="ml-auto text-[#d77b55]" /></div>
              ))}
              {detail.factors.length === 0 && <p className="text-[11px] text-[#8a9da2]">All indicators on target.</p>}
              <p className="pt-2 text-[9px] text-[#a1b0b0]">
                Factors are recomputed by the SQL engine (classpulse_predict) every time attendance, marks or submissions change.
              </p>
            </div>
          )}

          {detail.interventions.length > 0 && (
            <div className="mt-4">
              <p className="eyebrow mb-2">Interventions</p>
              {detail.interventions.map((iv: any) => (
                <div key={iv.intervention_id} className="mb-2 flex items-center justify-between rounded-lg border border-[#edf1ef] px-3 py-2">
                  <div>
                    <p className="text-[10px] font-bold text-[#3b5a66]">{iv.intervention_type}</p>
                    <p className="text-[9px] text-[#8a9da2]">{iv.assigned_to ?? "staff"}{iv.review_date ? ` · review ${new Date(iv.review_date).toLocaleDateString()}` : ""}</p>
                  </div>
                  <RiskPill risk={iv.status === "Active" ? "Critical" : iv.status === "Planned" ? "High" : "On track"} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/* ---------- panels ---------- */

function StudentDetailPanel({ student, onNotice, onOpenFull, onIntervene }: {
  student: StudentDetail | null; onNotice: (m: string) => void; onOpenFull: (reg: string) => void; onIntervene: (reg: string) => void;
}) {
  if (!student) return (
    <section className="panel">
      <div className="panel-head"><p className="panel-sub px-4">Select a student to see their live prediction, trajectory and risk factors.</p></div>
    </section>
  );
  const critical = student.risk === "Critical";
  const line = student.trajectory.length > 1
    ? student.trajectory.map(t => t.pct)
    : (critical ? [86, 79, 80, 72, 69, 67, 64, 61] : [61, 65, 64, 70, 71, 72, 75, 78]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Selected student</p>
          <h2 className="mt-1 font-display text-[17px] font-bold text-[#244b5b]">{student.name}</h2>
          <p className="panel-sub">{student.id} · {student.department} · {student.section}</p>
        </div>
        <Menu items={[
          { label: "Open full profile", icon: FileText, onClick: () => onOpenFull(student.id) },
          { label: "Plan intervention", icon: UserPlus, onClick: () => onIntervene(student.id) },
          { label: "Refresh from PostgreSQL", icon: RefreshCw, onClick: () => onNotice("Profile re-fetched from PostgreSQL") },
        ]} />
      </div>
      <div className="student-profile">
        <div className="flex items-center gap-3">
          <div className="profile-avatar">{student.initials}</div>
          <div>
            <RiskPill risk={student.risk} />
            <p className="mt-2 text-[11px] font-semibold text-[#718b92]">
              Current overall prediction: <b className="text-[#315568]">{student.prediction}/100</b>
            </p>
          </div>
        </div>
        <div className="profile-stats">
          <div><span>Current GPA</span><b>{student.gpa}</b></div>
          <div><span>Attendance</span><b className={student.attendance < 75 ? "text-[#cd7859]" : ""}>{student.attendance}%</b></div>
          <div><span>Trend</span><b className={student.delta.startsWith("+") ? "text-[#4c9a7c]" : "text-[#cd7859]"}>{student.delta}</b></div>
        </div>
        <div className="mini-chart">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Performance trajectory</p>
              <p className="mt-1 text-[11px] font-bold text-[#52717c]">Last {Math.max(line.length, 4)} assessments</p>
            </div>
            <Sparkline points={line} color={critical ? "#d77b55" : "#4b928d"} />
          </div>
          <div className="chart-bars">
            {line.map((p, i) => (
              <div key={i} className="bar-wrap">
                <div className={`chart-bar ${i > line.length - 3 && critical ? "bar-risk" : ""}`} style={{ height: `${Math.max(25, p - 20)}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="risk-reasons">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Why this prediction?</p>
            <button onClick={() => onOpenFull(student.id)} className="text-[10px] font-bold text-[#4b928d]">Explain <ChevronRight size={11} className="inline" /></button>
          </div>
          {student.factors.map((f, i) => (
            <div key={i} className="factor"><span>{i + 1}</span><p>{f}</p><ArrowDownRight size={13} className="ml-auto text-[#d77b55]" /></div>
          ))}
          {student.factors.length === 0 && <p className="text-[11px] text-[#8a9da2]">All indicators on target.</p>}
        </div>
        <div className="profile-actions">
          <button className="secondary-button flex-1" onClick={() => onOpenFull(student.id)}><Clock3 size={13} /> View timeline</button>
          <button className="primary-button flex-1" onClick={() => onIntervene(student.id)}><Target size={13} /> Intervene</button>
        </div>
      </div>
    </section>
  );
}

/* ---------- views ---------- */

function OverviewView({ students, selected, setSelected, search, overview, onNotice, onOpenFull, onIntervene, riskFilter, setRiskFilter, clearSearch }: {
  students: StudentRow[];
  selected: StudentDetail | null;
  setSelected: (s: string) => void;
  search: string;
  overview: Overview | null;
  onNotice: (m: string) => void;
  onOpenFull: (reg: string) => void;
  onIntervene: (reg: string) => void;
  riskFilter: string;
  setRiskFilter: (r: string) => void;
  clearSearch: () => void;
}) {
  const filtered = useMemo(() =>
    students.filter(s =>
      (riskFilter === "all" || s.risk === riskFilter) &&
      `${s.name} ${s.id} ${s.subject}`.toLowerCase().includes(search.toLowerCase())),
    [students, search, riskFilter]);

  return (
    <>
      <section className="metrics-grid">
        <Metric label="Students monitored" value={overview?.studentsMonitored ?? "—"} sub="across 4 subjects" trend="↑ live" tone="teal" icon={Users} />
        <Metric label="Need attention" value={overview?.needAttention ?? "—"} sub={`${overview?.needAttentionPct ?? 0}% of cohort`} trend="↑ live" tone="coral" icon={CircleAlert} />
        <Metric label="Avg predicted score" value={overview?.avgPredictedScore ?? "—"} sub="this semester" trend="live" tone="green" icon={GraduationCap} />
        <Metric label="Interventions active" value={String(overview?.interventionsActive ?? "—").padStart(2, "0")} sub="from PostgreSQL" trend="live" tone="amber" icon={Target} />
      </section>

      <AskPanel onNotice={onNotice} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.42fr)_minmax(350px,.86fr)]">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="panel-title">Students needing attention</h2>
                <span className="count-badge">{filtered.length} live</span>
              </div>
              <p className="panel-sub">Prioritized by subject-level risk and recent change</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  className={`filter-button ${riskFilter !== "all" ? "!bg-[#e4f0ed] !text-[#2e696a]" : ""}`}
                  onClick={() => setRiskFilter(riskFilter === "all" ? "Critical" : riskFilter === "Critical" ? "High" : riskFilter === "High" ? "Moderate" : "all")}>
                  <Filter size={13} /> {riskFilter === "all" ? "Filter" : riskFilter}
                </button>
              </div>
              <Menu items={[
                { label: "All risks", onClick: () => setRiskFilter("all") },
                { label: "Critical only", onClick: () => setRiskFilter("Critical") },
                { label: "High only", onClick: () => setRiskFilter("High") },
                { label: "Moderate only", onClick: () => setRiskFilter("Moderate") },
                { label: "Open at-risk view", onClick: () => { setRiskFilter("all"); onNotice("Opened at-risk roster"); window.dispatchEvent(new CustomEvent("cp:navigate", { detail: "At-risk students" })); } },
              ]} />
            </div>
          </div>
          <div className="student-table">
            <div className="student-grid student-grid-head">
              <span>Student</span><span>Risk signal</span><span>Prediction</span><span>Last update</span>
            </div>
            {filtered.map(s => (
              <button key={s.id + s.subjectCode} className={`student-grid student-row ${selected?.id === s.id ? "student-selected" : ""}`} onClick={() => setSelected(s.id)}>
                <div className="student-cell">
                  <div className={`student-avatar ${s.risk === "Critical" ? "avatar-coral" : s.risk === "High" ? "avatar-amber" : "avatar-teal"}`}>{s.initials}</div>
                  <div className="min-w-0 text-left">
                    <p className="truncate text-xs font-bold text-[#315568]">{s.name}</p>
                    <p className="mt-1 text-[10px] text-[#8a9da2]">{s.id} · {s.department}</p>
                  </div>
                </div>
                <div className="text-left">
                  <RiskPill risk={s.risk} />
                  <p className="mt-1 truncate text-[10px] text-[#81959a]">{s.subject}</p>
                </div>
                <div className="text-left">
                  <p className="font-display text-sm font-bold text-[#315568]">{s.prediction}<span className="text-[10px] text-[#8ca0a3]">/100</span></p>
                  <p className={`mt-1 text-[10px] font-bold ${s.delta.startsWith("+") ? "text-[#4c9a7c]" : "text-[#cd7859]"}`}>{s.delta} vs expected</p>
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-[#8c9fa3]">
                  <span>{new Date(s.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <ChevronRight size={14} />
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="p-5 text-center">
                <p className="text-[11px] text-[#8a9da2]">{search ? <>No students match “{search}”. <button className="font-bold text-[#4b928d] underline" onClick={clearSearch}>Clear search</button></> : "No students in this category."}</p>
              </div>
            )}
          </div>
          <div className="panel-foot">
            <span>Showing {filtered.length} students requiring attention</span>
            <button onClick={() => { setRiskFilter("all"); window.dispatchEvent(new CustomEvent("cp:navigate", { detail: "At-risk students" })); }}>
              Open full roster <ChevronRight size={13} />
            </button>
          </div>
        </section>

        <StudentDetailPanel student={selected} onNotice={onNotice} onOpenFull={onOpenFull} onIntervene={onIntervene} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SubjectPulsePanel overview={overview} onNotice={onNotice} />
        <InterventionsPanel compact onNotice={onNotice} onChanged={() => { /* refresh handled by polling */ }} />
      </div>
    </>
  );
}

function SubjectPulsePanel({ overview, onNotice }: { overview: Overview | null; onNotice: (m: string) => void }) {
  const [compare, setCompare] = useState(false);
  const subjects = overview?.subjects ?? [];
  const best = subjects.length ? subjects.reduce((a, b) => (b.avgScore > a.avgScore ? b : a)) : null;
  const worst = subjects.length ? subjects.reduce((a, b) => (b.riskPct > a.riskPct ? b : a)) : null;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Subject pulse</h2>
          <p className="panel-sub">Live risk distribution by subject</p>
        </div>
        <button className={`filter-button ${compare ? "!bg-[#e4f0ed] !text-[#2e696a]" : ""}`} onClick={() => { setCompare(c => !c); onNotice(compare ? "Comparison hidden" : "Comparison mode on"); }}>
          <ChartColumn size={13} /> Compare
        </button>
      </div>
      <div className="subject-list">
        {subjects.map(s => (
          <div key={s.code} className="subject-row">
            <div className="subject-color" style={{ background: s.color }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="truncate text-xs font-bold text-[#3c5c68]">{s.name}</p>
                <span className="font-mono text-[10px] text-[#8a9da2]">{s.code}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eaf0ee]">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, s.riskPct * 3.8)}%`, background: s.color }} />
              </div>
            </div>
            <div className="ml-4 text-right">
              <p className="font-display text-sm font-bold text-[#315568]">{s.avgScore.toFixed(1)}</p>
              <p className="text-[9px] text-[#91a1a4]">avg score</p>
            </div>
            <span className="ml-4 w-12 text-right text-[10px] font-bold text-[#cd7859]">{s.riskPct}% risk</span>
          </div>
        ))}
      </div>
      {compare && subjects.length > 0 && (
        <div className="border-t border-[#edf1ef] px-5 py-4">
          <p className="eyebrow mb-2">Comparison</p>
          <div className="grid gap-2 text-[10px] font-semibold text-[#52717c] sm:grid-cols-2">
            <div className="rounded-lg border border-[#edf1ef] px-3 py-2">
              <span className="text-[#4c9a7c]">▲ Strongest:</span> {best?.name} — avg {best?.avgScore.toFixed(1)}
            </div>
            <div className="rounded-lg border border-[#edf1ef] px-3 py-2">
              <span className="text-[#cd7859]">▼ Needs attention:</span> {worst?.name} — {worst?.riskPct}% at risk
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function InterventionsPanel({ compact, onNotice, onChanged }: { compact?: boolean; onNotice: (m: string) => void; onChanged?: () => void }) {
  const [items, setItems] = useState<Intervention[]>([]);
  const [scope, setScope] = useState<"all" | "week">("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const load = () => api.interventions().then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const weekEnd = now + 7 * 864e5;
  const shown = (compact ? items.slice(0, 3) : items).filter(i => {
    if (scope !== "week") return true;
    if (!i.review_date) return false;
    const d = new Date(i.review_date).getTime();
    return d >= now - 864e5 && d <= weekEnd;
  });
  const active = items.filter(i => i.status === "Active" || i.status === "Planned").length;

  const setStatus = async (id: number, status: string) => {
    setBusyId(id);
    try {
      await api.updateIntervention(id, { status });
      onNotice(`Intervention #${id} marked ${status} — event fired`);
      await load(); onChanged?.();
    } catch (e) { onNotice("Failed: " + (e as Error).message); }
    finally { setBusyId(null); }
  };

  return (
    <section className="panel intervention-panel">
      <div className="panel-head">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="panel-title">Live intervention queue</h2>
            <span className="count-badge green">{String(active).padStart(2, "0")} active</span>
          </div>
          <p className="panel-sub">Actions that need a follow-up</p>
        </div>
        <button className={`filter-button ${scope === "week" ? "!bg-[#e4f0ed] !text-[#2e696a]" : ""}`}
          onClick={() => { setScope(s => s === "week" ? "all" : "week"); onNotice(scope === "week" ? "Showing all interventions" : "Filtered to reviews due this week"); }}>
          <CalendarDays size={13} /> This week
        </button>
      </div>
      <div className="intervention-list">
        {shown.map(i => {
          const urgent = i.review_date && new Date(i.review_date) < new Date(Date.now() + 4 * 864e5);
          return (
            <div key={i.intervention_id} className="intervention-row">
              <div className={`intervention-icon ${urgent ? "coral" : i.status === "Active" ? "teal" : "amber"}`}>
                {i.status === "Active" ? <Users size={15} /> : <BookOpen size={15} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-[#3b5a66]">{i.intervention_type} · {i.full_name}</p>
                <p className="mt-1 text-[10px] text-[#8a9da1]">Assigned to {i.assigned_to ?? "staff"}{i.review_date ? ` · review ${new Date(i.review_date).toLocaleDateString()}` : ""}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {i.status !== "Completed" && (
                  <button
                    className="rounded-md border border-[#dce6e2] bg-white px-2 py-1 text-[9px] font-bold text-[#2e696a] hover:bg-[#e4f0ed] disabled:opacity-50"
                    disabled={busyId === i.intervention_id}
                    onClick={() => setStatus(i.intervention_id, "Completed")}>
                    ✓ Done
                  </button>
                )}
                <span className={`queue-status ${urgent ? "urgent" : ""}`}>{urgent ? "Due soon" : i.status === "Active" ? "On track" : "Review"}</span>
              </div>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="p-4 text-[11px] text-[#8a9da2]">
            {scope === "week" ? "No reviews due within 7 days." : "No interventions yet — plan one from a student profile."}
          </p>
        )}
      </div>
    </section>
  );
}

function AskView({ onNotice }: { onNotice: (m: string) => void }) {
  return (
    <div className="mt-2">
      <AskPanel onNotice={onNotice} />
      <section className="panel mt-5">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">How the assistant works</h2>
            <p className="panel-sub">Natural-language questions are mapped to safe, read-only SQL</p>
          </div>
        </div>
        <div className="grid gap-3 p-5 text-[10px] font-semibold text-[#52717c] sm:grid-cols-3">
          <div className="rounded-lg border border-[#edf1ef] p-3"><b className="text-[#315568]">1 · Intent</b><p className="mt-1">Your question is classified (risk, attendance, subject, explain…).</p></div>
          <div className="rounded-lg border border-[#edf1ef] p-3"><b className="text-[#315568]">2 · Guardrails</b><p className="mt-1">Only SELECTs on whitelisted views/tables pass the validator.</p></div>
          <div className="rounded-lg border border-[#edf1ef] p-3"><b className="text-[#315568]">3 · Execute</b><p className="mt-1">Runs as the read-only classpulse_reader role against live data.</p></div>
        </div>
      </section>
    </div>
  );
}

function AtRiskView({ students, setSelected, search, onOpenFull, riskFilter, setRiskFilter, clearSearch }: {
  students: StudentRow[]; setSelected: (s: string) => void; search: string;
  onOpenFull: (reg: string) => void; riskFilter: string; setRiskFilter: (r: string) => void; clearSearch: () => void;
}) {
  const byRisk = useMemo(() => {
    const counts: Record<string, number> = { Critical: 0, High: 0, Moderate: 0 };
    students.forEach(s => { counts[s.risk] = (counts[s.risk] || 0) + 1; });
    return counts;
  }, [students]);
  const filtered = useMemo(() =>
    students.filter(s =>
      (riskFilter === "all" || s.risk === riskFilter) &&
      `${s.name} ${s.id} ${s.subject}`.toLowerCase().includes(search.toLowerCase())),
    [students, search, riskFilter]);

  return (
    <div className="mt-2 space-y-5">
      <section className="metrics-grid">
        <Metric label="Critical risk" value={byRisk.Critical ?? 0} sub="immediate action" trend="live" tone="coral" icon={CircleAlert} />
        <Metric label="High risk" value={byRisk.High ?? 0} sub="targeted support" trend="live" tone="amber" icon={CircleAlert} />
        <Metric label="Moderate" value={byRisk.Moderate ?? 0} sub="monitor closely" trend="live" tone="teal" icon={Users} />
        <Metric label="Total tracked" value={students.length} sub="with live predictions" trend="live" tone="green" icon={GraduationCap} />
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Full at-risk roster</h2>
            <p className="panel-sub">Every student with a live prediction — click a row for the full profile</p>
          </div>
          <div className="flex gap-2">
            {["all", "Critical", "High", "Moderate"].map(r => (
              <button key={r} className={`filter-button ${riskFilter === r ? "!bg-[#e4f0ed] !text-[#2e696a]" : ""}`} onClick={() => setRiskFilter(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div className="student-table">
          <div className="student-grid student-grid-head">
            <span>Student</span><span>Risk signal</span><span>Prediction</span><span>Subject</span>
          </div>
          {filtered.map(s => (
            <button key={s.id + s.subjectCode} className="student-grid student-row" onClick={() => setSelected(s.id)}>
              <div className="student-cell">
                <div className={`student-avatar ${s.risk === "Critical" ? "avatar-coral" : s.risk === "High" ? "avatar-amber" : "avatar-teal"}`}>{s.initials}</div>
                <div className="min-w-0 text-left">
                  <p className="truncate text-xs font-bold text-[#315568]">{s.name}</p>
                  <p className="mt-1 text-[10px] text-[#8a9da2]">{s.id} · GPA {s.gpa}</p>
                </div>
              </div>
              <div className="text-left"><RiskPill risk={s.risk} /></div>
              <div className="text-left">
                <p className="font-display text-sm font-bold text-[#315568]">{s.prediction}<span className="text-[10px] text-[#8ca0a3]">/100</span></p>
                <p className="mt-1 text-[10px] text-[#8c9fa3]">pass {s.passProbability}%</p>
              </div>
              <div className="flex items-center justify-between gap-2 text-left">
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-bold text-[#52717c]">{s.subject}</p>
                  <p className="text-[10px] text-[#8c9fa3]">att. {s.attendance}%</p>
                </div>
                <span
                  className="ml-2 shrink-0 rounded-md border border-[#dce6e2] bg-white px-2 py-1 text-[9px] font-bold text-[#2e696a] hover:bg-[#e4f0ed]"
                  onClick={(e) => { e.stopPropagation(); onOpenFull(s.id); }}>
                  Profile
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="p-5 text-[11px] text-[#8a9da2]">
              {search ? <>No students match “{search}”. <button className="font-bold text-[#4b928d] underline" onClick={clearSearch}>Clear search</button></> : "No students in this category."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function InterventionsView({ onNotice, onChanged }: { onNotice: (m: string) => void; onChanged?: () => void }) {
  const [prefill, setPrefill] = useState<string | null>(null);
  return (
    <div className="mt-2 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="panel">
        <div className="panel-head"><div><h2 className="panel-title">Plan intervention</h2><p className="panel-sub">Writes to the interventions table & fires a real-time event</p></div></div>
        <div className="space-y-3 p-5">
          <p className="text-[11px] font-semibold text-[#52717c]">
            Use <b>New intervention</b> to open the planning form — it validates the student and subject against PostgreSQL and appears in the live queue instantly.
          </p>
          <button className="primary-button w-full" onClick={() => setPrefill("ST-2048")}><Target size={13} /> New intervention</button>
          <p className="text-[10px] text-[#8a9da2]">Tip: you can also open the form from any student profile via <b>Intervene</b>.</p>
        </div>
      </section>
      <InterventionsPanel onNotice={onNotice} onChanged={onChanged} />
      {prefill && <InterventionDialog initialReg={prefill} onClose={() => setPrefill(null)} onNotice={onNotice} onCreated={onChanged} />}
    </div>
  );
}

function ReportsView({ overview, students }: { overview: Overview | null; students: StudentRow[] }) {
  const [exporting, setExporting] = useState(false);
  const dist = overview?.riskDistribution ?? {};
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
  const events = overview?.recentEvents ?? [];

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = [
        "registration_number,name,subject_code,subject,risk,prediction,pass_probability,attendance",
        ...students.map(s => [s.id, s.name, s.subjectCode, `"${s.subject}"`, s.risk, s.prediction, s.passProbability, s.attendance].join(",")),
      ].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = `classpulse-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  return (
    <div className="mt-2 space-y-5">
      <section className="metrics-grid">
        <Metric label="On track" value={dist["On track"] ?? 0} sub="students" trend="live" tone="green" icon={GraduationCap} />
        <Metric label="Moderate" value={dist["Moderate"] ?? 0} sub="students" trend="live" tone="teal" icon={Users} />
        <Metric label="High" value={dist["High"] ?? 0} sub="students" trend="live" tone="amber" icon={CircleAlert} />
        <Metric label="Critical" value={dist["Critical"] ?? 0} sub="students" trend="live" tone="coral" icon={CircleAlert} />
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="panel">
          <div className="panel-head">
            <div><h2 className="panel-title">Risk distribution</h2><p className="panel-sub">Latest prediction per student-subject pair</p></div>
            <button className="filter-button" onClick={exportCsv} disabled={exporting}>
              <FileText size={13} /> {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
          <div className="p-5">
            {Object.entries(dist).map(([level, n]) => (
              <div key={level} className="mb-3">
                <div className="mb-1 flex justify-between text-[10px] font-bold text-[#52717c]"><span>{level}</span><span>{n} ({Math.round((n / total) * 100)}%)</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-[#eaf0ee]">
                  <div className={`h-full rounded-full ${level === "Critical" ? "bg-[#d77b55]" : level === "High" ? "bg-[#d5a545]" : level === "Moderate" ? "bg-[#568d9b]" : "bg-[#55a47d]"}`}
                    style={{ width: `${(n / total) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><div><h2 className="panel-title">Live academic events</h2><p className="panel-sub">academic_events table — the real-time backbone</p></div></div>
          <div className="max-h-72 overflow-auto p-4">
            {events.map((e, i) => (
              <div key={i} className="mb-2 flex items-center justify-between rounded-lg border border-[#edf1ef] px-3 py-2">
                <div>
                  <p className="text-[10px] font-bold text-[#3b5a66]">{e.event_type}</p>
                  <p className="text-[9px] text-[#8a9da2]">{new Date(e.created_at).toLocaleTimeString()}</p>
                </div>
                <span className={`risk-pill ${e.processing_status === "Processed" ? "risk-track" : "risk-high"}`}><span className="risk-dot" />{e.processing_status}</span>
              </div>
            ))}
            {events.length === 0 && <p className="text-[11px] text-[#8a9da2]">No events yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function SubjectsView({ overview }: { overview: Overview | null }) {
  const subjects = overview?.subjects ?? [];
  return (
    <div className="mt-2 space-y-5">
      <section className="metrics-grid">
        <Metric label="Subjects" value={subjects.length} sub="this semester" trend="live" tone="teal" icon={BookOpen} />
        <Metric label="Avg score (all)" value={subjects.length ? (subjects.reduce((a, s) => a + s.avgScore, 0) / subjects.length).toFixed(1) : "—"} sub="predicted" trend="live" tone="green" icon={GraduationCap} />
        <Metric label="Highest risk" value={subjects.length ? Math.max(...subjects.map(s => s.riskPct)) + "%" : "—"} sub="subject-level" trend="live" tone="coral" icon={CircleAlert} />
        <Metric label="Credits" value={subjects.length * 3 + 1} sub="total this sem" trend="live" tone="amber" icon={BookOpen} />
      </section>
      <div className="grid gap-5 md:grid-cols-2">
        {subjects.map(s => (
          <section key={s.code} className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">{s.name}</h2>
                <p className="panel-sub">{s.code} · live from PostgreSQL</p>
              </div>
              <span className="count-badge" style={{ background: s.color + "22", color: s.color }}>{s.avgScore.toFixed(1)} avg</span>
            </div>
            <div className="p-5">
              <div className="mb-2 flex justify-between text-[10px] font-bold text-[#52717c]"><span>At-risk students</span><span>{s.riskPct}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-[#eaf0ee]">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, s.riskPct * 3.8)}%`, background: s.color }} />
              </div>
              <div className="mt-3 flex justify-between text-[9px] text-[#8a9da2]">
                <span>avg predicted {s.avgScore.toFixed(1)}/100</span>
                <span>{s.riskPct}% need attention</span>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

const CP_FACULTY_ROLES = ["faculty", "admin", "hod"];
const CP_SUBJECTS = [
  { code: "CS402", name: "Database Management Systems" },
  { code: "CS318", name: "Computer Networks" },
  { code: "CS224", name: "Operating Systems" },
  { code: "CS201", name: "Data Structures" },
];

function FacultyView({ onNotice, user, setUser, onOpenStudent }: {
  onNotice: (m: string) => void;
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  onOpenStudent: (reg: string) => void;
}) {
  const [email, setEmail] = useState("meera.faculty@classpulse.local");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const isFaculty = !!user && CP_FACULTY_ROLES.includes(user.role);

  const signIn = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api.login(email.trim(), password);
      setToken(r.token);
      setUser(r.user);
      onNotice(`Signed in as ${r.user.fullName} (${r.user.role})`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const signOut = () => { setToken(""); setUser(null); onNotice("Signed out — faculty entry locked"); };

  const faculty = [
    { name: "Aarav Rao", email: "aarav.mentor@classpulse.local", role: "Mentor", duty: "Weekly mentoring for flagged students" },
    { name: "Dr. Meera Menon", email: "meera.faculty@classpulse.local", role: "Faculty", duty: "Records attendance & marks, reviews predictions" },
    { name: "Dr. Kavya Iyer", email: "kavya.counsellor@classpulse.local", role: "Counsellor", duty: "Handles escalations and wellbeing referrals" },
  ];

  return (
    <div className="mt-2 space-y-5">
      {!user ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Faculty sign-in</h2>
              <p className="panel-sub">Marks, attendance and student registration are locked behind this login</p>
            </div>
            <span className="count-badge flex items-center gap-1"><Lock size={11} /> SECURED</span>
          </div>
          <div className="p-5">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="block">
                <span className="eyebrow">Faculty email</span>
                <input className={`mt-1 ${inputCls}`} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@classpulse.local" />
              </label>
              <label className="block">
                <span className="eyebrow">Password</span>
                <input className={`mt-1 ${inputCls}`} type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" onKeyDown={e => { if (e.key === "Enter") signIn(); }} />
              </label>
              <button className="primary-button h-[38px]" onClick={signIn} disabled={busy || !password}>
                {busy ? "Checking…" : <><ShieldCheck size={14} />Sign in</>}
              </button>
            </div>
            {err && <p className="mt-3 rounded-lg bg-[#f9e7e1] px-3 py-2 text-[11px] font-bold text-[#bd654b]">✗ {err}</p>}
            <p className="mt-4 text-[10px] leading-5 text-[#8a9da2]">
              Demo credentials — <b>meera.faculty@classpulse.local</b> / <b>faculty123</b>. Passwords are scrypt-hashed in the
              users table and every data-entry API route rejects requests without a valid signed token — try it with curl.
            </p>
          </div>
        </section>
      ) : isFaculty ? (
        <ClassManager user={user} onSignOut={signOut} onNotice={onNotice} onOpenStudent={onOpenStudent} />
      ) : (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">Access restricted</h2>
              <p className="panel-sub">Signed in as {user.fullName} · role “{user.role}”</p>
            </div>
            <span className="count-badge flex items-center gap-1"><Lock size={11} /> FACULTY ONLY</span>
          </div>
          <div className="p-5">
            <p className="text-xs font-semibold leading-6 text-[#667f86]">
              The class manager — marks, attendance and student registration — is restricted to faculty accounts.
              Mentors and counsellors can still use the dashboard, Ask-the-data and the interventions queue.
            </p>
            <button className="secondary-button mt-4" onClick={signOut}><LogOut size={13} />Sign out</button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div><h2 className="panel-title">Users & roles</h2><p className="panel-sub">users table — roles and real-time responsibilities</p></div>
        </div>
        <div className="p-5">
          {faculty.map(f => (
            <div key={f.email} className="mb-2 flex items-center justify-between rounded-lg border border-[#edf1ef] px-4 py-3">
              <div>
                <p className="text-xs font-bold text-[#315568]">{f.name} <span className="ml-1 text-[9px] font-bold uppercase tracking-wide text-[#4b928d]">{f.role}</span></p>
                <p className="mt-0.5 text-[10px] text-[#8a9da2]">{f.email} · {f.duty}</p>
              </div>
              <button className="secondary-button" onClick={() => { window.dispatchEvent(new CustomEvent("cp:navigate", { detail: "Interventions" })); onNotice(`Showing the live queue (${f.role} actions in green)`); }}>View queue</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ClassManager({ user, onSignOut, onNotice, onOpenStudent }: {
  user: AuthUser; onSignOut: () => void; onNotice: (m: string) => void; onOpenStudent: (reg: string) => void;
}) {
  const [subject, setSubject] = useState("CS402");
  const [tab, setTab] = useState<"Roster" | "Attendance" | "Marks" | "Add student" | "Import CSV">("Roster");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.roster(subject).then(setRoster).catch(e => onNotice("✗ " + (e as Error).message)).finally(() => setLoading(false));
  }, [subject, refresh]);

  const subjectName = CP_SUBJECTS.find(s => s.code === subject)?.name ?? subject;

  return (
    <section className="panel">
      <div className="panel-head flex-wrap gap-3">
        <div>
          <h2 className="panel-title">Class manager</h2>
          <p className="panel-sub">{user.fullName} · {user.role} — every save writes to PostgreSQL and re-scores predictions live</p>
        </div>
        <div className="flex items-center gap-2">
          <select className={inputCls} value={subject} onChange={e => setSubject(e.target.value)}>
            {CP_SUBJECTS.map(s => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
          </select>
          <button className="secondary-button" onClick={onSignOut}><LogOut size={13} />Sign out</button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-[#e5ece8] px-4 pt-3">
        {(["Roster", "Attendance", "Marks", "Add student", "Import CSV"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-t-lg px-4 py-2 text-[11px] font-extrabold transition-colors ${tab === t ? "bg-[#e4f0ed] text-[#2e696a]" : "text-[#7d9397] hover:bg-[#f4f9f7]"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Roster" && <RosterTab roster={roster} loading={loading} subjectName={subjectName} onOpenStudent={onOpenStudent} onNotice={onNotice} />}
      {tab === "Attendance" && <AttendanceTab roster={roster} subject={subject} onNotice={onNotice} onSaved={() => setRefresh(r => r + 1)} />}
      {tab === "Marks" && <MarksTab roster={roster} subject={subject} onNotice={onNotice} onSaved={() => setRefresh(r => r + 1)} />}
      {tab === "Add student" && <AddStudentTab onNotice={onNotice} onCreated={() => { setRefresh(r => r + 1); setTab("Roster"); }} />}
      {tab === "Import CSV" && <ImportCsvTab subject={subject} onNotice={onNotice} onSaved={() => setRefresh(r => r + 1)} />}
    </section>
  );
}

function RosterTab({ roster, loading, subjectName, onOpenStudent, onNotice }: {
  roster: RosterRow[]; loading: boolean; subjectName: string;
  onOpenStudent: (reg: string) => void; onNotice: (m: string) => void;
}) {
  if (loading) return <div className="p-6 text-xs font-bold text-[#8a9da2]">Loading roster…</div>;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b border-[#e5ece8] text-[9px] font-black uppercase tracking-widest text-[#91a2a3]">
              <th className="px-4 py-3">Student</th>
              <th className="py-3">Reg no</th>
              <th className="py-3">Section</th>
              <th className="py-3">GPA</th>
              <th className="py-3">Attendance</th>
              <th className="py-3">Risk</th>
              <th className="py-3">Prediction</th>
            </tr>
          </thead>
          <tbody>
            {roster.map(r => (
              <tr key={r.registration_number}
                className="cursor-pointer border-b border-[#edf1ef] last:border-0 hover:bg-[#f6faf8]"
                onClick={() => r.risk_level
                  ? onOpenStudent(r.registration_number)
                  : onNotice(`${r.full_name} has no predictions yet — enter attendance or marks first`)}>
                <td className="px-4 py-2.5">
                  <p className="text-[11px] font-bold text-[#315568]">{r.full_name}</p>
                  <p className="text-[9px] text-[#a1b0b0]">Sem {r.semester}</p>
                </td>
                <td className="py-2.5 text-[11px] font-bold text-[#52717c]">{r.registration_number}</td>
                <td className="py-2.5 text-[11px] font-semibold text-[#52717c]">{r.section}</td>
                <td className="py-2.5 text-[11px] font-semibold text-[#52717c]">{r.current_gpa ?? "—"}</td>
                <td className="py-2.5">
                  <span className={`text-[11px] font-extrabold ${Number(r.attendance_pct ?? 0) < 75 ? "text-[#d77b55]" : "text-[#418269]"}`}>{r.attendance_pct ?? "—"}%</span>
                </td>
                <td className="py-2.5">{r.risk_level ? <RiskPill risk={r.risk_level} /> : <span className="text-[10px] text-[#a1b0b0]">no data</span>}</td>
                <td className="py-2.5 text-[11px] font-extrabold text-[#2b5363]">{r.predicted_score ? `${Math.round(Number(r.predicted_score))}/100` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <span>{roster.length} students enrolled · {subjectName}</span>
        <span>click a row for the full live profile</span>
      </div>
    </div>
  );
}

function AttendanceTab({ roster, subject, onNotice, onSaved }: {
  roster: RosterRow[]; subject: string; onNotice: (m: string) => void; onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [state, setState] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");

  useEffect(() => {
    api.roster(subject, date).then(rows => {
      const m: Record<string, boolean> = {};
      rows.forEach(r => { m[r.registration_number] = r.today_present === null ? true : r.today_present; });
      setState(m);
      setLoadedFor(date);
    }).catch(() => {});
  }, [subject, date]);

  const presentCount = Object.values(state).filter(Boolean).length;

  const save = async () => {
    setBusy(true);
    try {
      const records = Object.entries(state).map(([registrationNumber, present]) => ({ registrationNumber, present }));
      const r = await api.bulkAttendance({ subjectCode: subject, date, records });
      onNotice(`✓ ${r.saved} attendance records saved for ${date} — predictions re-scoring live`);
      onSaved();
    } catch (e) { onNotice("✗ " + (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="eyebrow">Class date</span>
          <input type="date" className={`mt-1 ${inputCls}`} value={date} max={today}
            onChange={e => setDate(e.target.value)} />
        </label>
        <button className="secondary-button" onClick={() => setState(Object.fromEntries(Object.keys(state).map(k => [k, true])))}>All present</button>
        <button className="secondary-button" onClick={() => setState(Object.fromEntries(Object.keys(state).map(k => [k, false])))}>All absent</button>
        <div className="ml-auto text-[10px] font-bold text-[#8a9da2]">{presentCount} present · {Object.keys(state).length - presentCount} absent</div>
        <button className="primary-button" onClick={save} disabled={busy || loadedFor !== date}>
          {busy ? "Saving…" : <><Save size={13} />Save attendance</>}
        </button>
      </div>
      <div className="max-h-[460px] overflow-y-auto rounded-xl border border-[#edf1ef]">
        {roster.map(r => (
          <div key={r.registration_number} className="flex items-center justify-between border-b border-[#edf1ef] px-4 py-2 last:border-0">
            <div>
              <p className="text-[11px] font-bold text-[#315568]">{r.full_name}</p>
              <p className="text-[9px] text-[#8a9da2]">{r.registration_number} · {r.attendance_pct ?? "—"}% overall{r.today_present !== null && r.today_present !== undefined ? " · already recorded for this date (saving updates it)" : ""}</p>
            </div>
            <div className="flex gap-1">
              <button onClick={() => setState(s => ({ ...s, [r.registration_number]: true }))}
                className={`rounded-lg px-3 py-1.5 text-[10px] font-extrabold transition-colors ${state[r.registration_number] ? "bg-[#e5f2ed] text-[#418269]" : "text-[#a1b0b0] hover:bg-[#f4f9f7]"}`}>Present</button>
              <button onClick={() => setState(s => ({ ...s, [r.registration_number]: false }))}
                className={`rounded-lg px-3 py-1.5 text-[10px] font-extrabold transition-colors ${state[r.registration_number] === false ? "bg-[#f9e7e1] text-[#bd654b]" : "text-[#a1b0b0] hover:bg-[#f4f9f7]"}`}>Absent</button>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-[#8a9da2]">Saving writes one attendance_records row per student (upsert by student + subject + date), stamps your user as recorded_by, and fires the real-time pipeline.</p>
    </div>
  );
}

function MarksTab({ roster, subject, onNotice, onSaved }: {
  roster: RosterRow[]; subject: string; onNotice: (m: string) => void; onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [sel, setSel] = useState<string>("");
  const [name, setName] = useState("");
  const [type, setType] = useState("Quiz");
  const [maxMarks, setMaxMarks] = useState("10");
  const [aDate, setADate] = useState(today);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.assessments(subject).then(a => {
      setAssessments(a);
      setSel(a.length ? String(a[a.length - 1].assessment_id) : "new");
    }).catch(() => {});
  }, [subject]);

  const selected = assessments.find(a => String(a.assessment_id) === sel);
  const max = sel === "new" ? Number(maxMarks) : Number(selected?.max_marks ?? 100);

  const save = async () => {
    const records = Object.entries(marks).filter(([, v]) => v !== "").map(([registrationNumber, v]) => ({ registrationNumber, marksObtained: Number(v) }));
    if (!records.length) { onNotice("Enter at least one mark first"); return; }
    setBusy(true);
    try {
      const body = sel === "new"
        ? { subjectCode: subject, assessment: { name: name.trim() || `Quiz ${assessments.length + 1}`, type, maxMarks: Number(maxMarks), date: aDate }, records }
        : { subjectCode: subject, assessmentId: Number(sel), records };
      const r = await api.bulkMarks(body);
      onNotice(`✓ ${r.saved} marks saved for “${r.assessment.name}” — predictions re-scoring live`);
      setMarks({});
      const fresh = await api.assessments(subject);
      setAssessments(fresh);
      if (sel === "new") setSel(String(r.assessment.id));
      onSaved();
    } catch (e) { onNotice("✗ " + (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="eyebrow">Assessment</span>
          <select className={`mt-1 ${inputCls}`} value={sel} onChange={e => setSel(e.target.value)}>
            {assessments.map(a => (
              <option key={a.assessment_id} value={a.assessment_id}>
                {a.assessment_name} · {a.assessment_type} · max {Number(a.max_marks)} · {a.marks_entered} entered
              </option>
            ))}
            <option value="new">＋ New assessment…</option>
          </select>
        </label>
        {sel === "new" && (
          <>
            <label className="block">
              <span className="eyebrow">Name</span>
              <input className={`mt-1 ${inputCls}`} value={name} onChange={e => setName(e.target.value)} placeholder={`Quiz ${assessments.length + 1}`} />
            </label>
            <label className="block">
              <span className="eyebrow">Type</span>
              <select className={`mt-1 ${inputCls}`} value={type} onChange={e => setType(e.target.value)}>
                {["Quiz", "Internal", "Assignment", "Lab", "Final"].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow">Max marks</span>
              <input className={`mt-1 ${inputCls}`} type="number" min={1} value={maxMarks} onChange={e => setMaxMarks(e.target.value)} />
            </label>
            <label className="block">
              <span className="eyebrow">Date</span>
              <input type="date" className={`mt-1 ${inputCls}`} value={aDate} max={today} onChange={e => setADate(e.target.value)} />
            </label>
          </>
        )}
        <button className="primary-button ml-auto" onClick={save} disabled={busy}>
          {busy ? "Saving…" : <><Save size={13} />Save marks</>}
        </button>
      </div>
      <div className="max-h-[460px] overflow-y-auto rounded-xl border border-[#edf1ef]">
        {roster.map(r => {
          const v = marks[r.registration_number] ?? "";
          const invalid = v !== "" && (Number(v) < 0 || Number(v) > max || Number.isNaN(Number(v)));
          return (
            <div key={r.registration_number} className="flex items-center justify-between border-b border-[#edf1ef] px-4 py-2 last:border-0">
              <div>
                <p className="text-[11px] font-bold text-[#315568]">{r.full_name}</p>
                <p className="text-[9px] text-[#8a9da2]">{r.registration_number}</p>
              </div>
              <div className="flex items-center gap-2">
                {invalid && <span className="text-[9px] font-extrabold text-[#bd654b]">0–{max} only</span>}
                <input type="number" min={0} max={max} className={`${inputCls} w-24 text-right ${invalid ? "border-[#e2a693]" : ""}`}
                  placeholder={`out of ${max}`} value={v}
                  onChange={e => setMarks(m => ({ ...m, [r.registration_number]: e.target.value }))} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-[#8a9da2]">Blank rows are skipped. Saving upserts marks (student + assessment), stamps entered_by, and the trigger pipeline re-predicts every affected student instantly.</p>
    </div>
  );
}

function ImportCsvTab({ subject, onNotice, onSaved }: { subject: string; onNotice: (m: string) => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"attendance" | "marks">("attendance");
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ saved: number; skipped: number; errors: { line: number; error: string }[] } | null>(null);

  const template = kind === "attendance"
    ? "registration_number,date,present\nST-2048,2026-10-05,true\nST-2117,2026-10-05,false"
    : "registration_number,assessment_name,assessment_type,max_marks,marks_obtained,assessment_date\nST-2048,Quiz 5,Quiz,10,7,2026-10-05\nST-2117,Quiz 5,Quiz,10,4,2026-10-05";

  const downloadTemplate = () => {
    const blob = new Blob([template], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${kind}-template.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(f);
  };

  const dataRows = csvText.trim() ? csvText.trim().split(/\r?\n/).length - 1 : 0;

  const submit = async () => {
    if (!csvText.trim()) { onNotice("Paste CSV text or choose a .csv file first"); return; }
    setBusy(true); setResult(null);
    try {
      const r = await api.importCsv(kind, subject, csvText);
      setResult({ saved: r.saved, skipped: r.skipped, errors: r.errors });
      onNotice(`✓ CSV import: ${r.saved} rows saved${r.skipped ? `, ${r.skipped} skipped` : ""} — predictions re-scoring live`);
      onSaved();
    } catch (e) { onNotice("✗ " + (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="eyebrow">Import type</span>
          <select className={`mt-1 ${inputCls}`} value={kind} onChange={e => { setKind(e.target.value as "attendance" | "marks"); setResult(null); }}>
            <option value="attendance">Attendance (reg no · date · present)</option>
            <option value="marks">Marks (reg no · assessment · marks)</option>
          </select>
        </label>
        <label className="block">
          <span className="eyebrow">CSV file</span>
          <input type="file" accept=".csv,text/csv" className={`mt-1 ${inputCls} py-1.5`} onChange={e => onFile(e.target.files?.[0] ?? null)} />
        </label>
        <button className="secondary-button" onClick={downloadTemplate}>Download {kind} template</button>
        <div className="ml-auto text-[10px] font-bold text-[#8a9da2]">{dataRows} data row{dataRows === 1 ? "" : "s"} ready · target: {subject}</div>
        <button className="primary-button" onClick={submit} disabled={busy || !csvText.trim()}>
          {busy ? "Importing…" : <><FileText size={13} />Import {kind}</>}
        </button>
      </div>
      <textarea className={`${inputCls} h-40 font-mono text-[11px] leading-5`}
        value={csvText} onChange={e => setCsvText(e.target.value)}
        placeholder={`…or paste ${kind} CSV here\n\n${template}`} />
      {result && (
        <div className="mt-3 rounded-lg border border-[#d7e7df] bg-[#eef8f1] px-4 py-3">
          <p className="text-[11px] font-extrabold text-[#3f8a76]">✓ {result.saved} row{result.saved === 1 ? "" : "s"} saved{result.skipped ? ` · ${result.skipped} skipped` : ""} — every saved row fired the real-time pipeline</p>
          {result.errors.length > 0 && (
            <div className="mt-2">
              {result.errors.map((e, i) => (
                <p key={i} className="text-[10px] font-bold text-[#bd654b]">line {e.line}: {e.error}</p>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-[10px] leading-5 text-[#8a9da2]">
        Rows are imported in one SQL transaction; unknown students, bad dates and out-of-range marks are reported per line and skipped.
        Re-importing the same registration_number + date (or assessment) updates the existing row — never duplicates it.
      </p>
    </div>
  );
}

function AddStudentTab({ onNotice, onCreated }: { onNotice: (m: string) => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState("");
  const [reg, setReg] = useState("");
  const [email, setEmail] = useState("");
  const [section, setSection] = useState("A");
  const [semester, setSemester] = useState("5");
  const [gpa, setGpa] = useState("");
  const [subjects, setSubjects] = useState<string[]>(CP_SUBJECTS.map(s => s.code));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!fullName.trim()) { onNotice("Student name is required"); return; }
    setBusy(true);
    try {
      const r = await api.addStudent({
        fullName,
        registrationNumber: reg.trim() || undefined,
        email: email.trim() || undefined,
        section,
        semester: Number(semester) || 5,
        gpa: gpa ? Number(gpa) : null,
        subjectCodes: subjects,
      });
      onNotice(`✓ ${r.student.full_name} registered as ${r.student.registration_number} · enrolled in ${r.enrolled.length} subjects`);
      setFullName(""); setReg(""); setEmail(""); setGpa("");
      onCreated();
    } catch (e) { onNotice("✗ " + (e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="eyebrow">Full name *</span>
          <input className={`mt-1 ${inputCls}`} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Ishaan Verma" />
        </label>
        <label className="block">
          <span className="eyebrow">Registration number (blank = auto ST-####)</span>
          <input className={`mt-1 ${inputCls}`} value={reg} onChange={e => setReg(e.target.value)} placeholder="ST-2413" />
        </label>
        <label className="block">
          <span className="eyebrow">Email</span>
          <input className={`mt-1 ${inputCls}`} value={email} onChange={e => setEmail(e.target.value)} placeholder="ishaan.verma@student.local" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="eyebrow">Section</span>
            <select className={`mt-1 ${inputCls}`} value={section} onChange={e => setSection(e.target.value)}>
              {["A", "B"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="eyebrow">Semester</span>
            <input className={`mt-1 ${inputCls}`} type="number" min={1} max={12} value={semester} onChange={e => setSemester(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="eyebrow">Current GPA (0–10)</span>
          <input className={`mt-1 ${inputCls}`} type="number" min={0} max={10} step={0.01} value={gpa} onChange={e => setGpa(e.target.value)} placeholder="7.50" />
        </label>
        <div>
          <span className="eyebrow">Enroll in subjects</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {CP_SUBJECTS.map(s => {
              const on = subjects.includes(s.code);
              return (
                <button key={s.code} type="button"
                  onClick={() => setSubjects(xs => on ? xs.filter(c => c !== s.code) : [...xs, s.code])}
                  className={`rounded-full px-3 py-1.5 text-[10px] font-extrabold transition-colors ${on ? "bg-[#e4f0ed] text-[#2e696a]" : "bg-[#f4f9f7] text-[#a1b0b0]"}`}>
                  {on ? "✓ " : "＋ "}{s.code}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <button className="primary-button mt-5" onClick={submit} disabled={busy}>
        {busy ? "Registering…" : <><UserPlus size={14} />Register student</>}
      </button>
      <p className="mt-3 text-[10px] text-[#8a9da2]">The student is inserted into the students table and enrolled for 2025-26 · Sem 5. Their first attendance/marks entry starts the live prediction history.</p>
    </div>
  );
}

function SettingsView({ live, setLive, onNotice }: { live: boolean; setLive: (v: boolean) => void; onNotice: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const recompute = async () => {
    setBusy(true);
    try {
      const r = await api.recompute();
      onNotice(`Re-scored ${r.predictions} student-subject predictions`);
    } catch (e) { onNotice("Failed: " + (e as Error).message); }
    finally { setBusy(false); }
  };
  const Row = ({ title, sub, action }: { title: string; sub: string; action: React.ReactNode }) => (
    <div className="mb-2 flex items-center justify-between rounded-lg border border-[#edf1ef] px-4 py-3">
      <div><p className="text-xs font-bold text-[#315568]">{title}</p><p className="mt-0.5 text-[10px] text-[#8a9da2]">{sub}</p></div>
      {action}
    </div>
  );
  return (
    <section className="panel mt-2">
      <div className="panel-head">
        <div><h2 className="panel-title">Settings</h2><p className="panel-sub">Live controls for the workspace</p></div>
      </div>
      <div className="p-5">
        <Row title="Live mode" sub={live ? "SSE stream connected — updates arrive instantly" : "Paused — press Resume live mode to reconnect"}
          action={<button className={live ? "secondary-button" : "primary-button"} onClick={() => setLive(!live)}>{live ? "Pause" : "Resume"}</button>} />
        <Row title="Re-run prediction engine" sub="Re-scores all 992 student-subject pairs from current features"
          action={<button className="secondary-button" onClick={recompute} disabled={busy}>{busy ? "Scoring…" : "Re-score now"}</button>} />
        <Row title="Simulate academic event" sub="Inject one random attendance change to watch the pipeline react"
          action={<button className="secondary-button" onClick={() => api.simulate().then(() => onNotice("Event injected — watch the ticker")).catch(e => onNotice((e as Error).message))}>Run</button>} />
        <Row title="Notification feed" sub="Opens the real-time alert drawer"
          action={<button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent("cp:open-notifications"))}>Open</button>} />
      </div>
    </section>
  );
}

/* ---------- notification drawer ---------- */

function NotificationBell({ onNotice, openSignal }: { onNotice: (m: string) => void; openSignal: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const load = () => api.notifications().then(setItems).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);
  useEffect(() => { if (openSignal > 0) setOpen(true); }, [openSignal]);
  const unread = items.filter(n => !n.is_read).length;
  return (
    <>
      <button className="top-icon" onClick={() => { setOpen(o => !o); if (unread) { api.markNotificationsRead().then(load); onNotice("Notifications opened"); } }}>
        <Bell size={16} />{unread > 0 && <i />}
      </button>
      {open && (
        <div className="notice-drawer">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Real-time academic alerts</p>
            <button className="more-button" onClick={() => setOpen(false)}><X size={14} /></button>
          </div>
          {items.length === 0 && <p className="text-[11px] text-[#8a9da2]">No alerts yet — they appear when a risk level changes.</p>}
          {items.map(n => (
            <div key={n.notification_id} className="mb-2 rounded-lg border border-[#edf1ef] bg-white p-3">
              <p className="text-[10px] font-bold text-[#3b5a66]">{n.student_name ?? "System"} <span className={`risk-pill ${n.severity === "Critical" ? "risk-critical" : n.severity === "Warning" ? "risk-high" : "risk-track"}`}><span className="risk-dot" />{n.severity}</span></p>
              <p className="mt-1 text-[10px] text-[#667f86]">{n.message}</p>
              <p className="mt-1 text-[9px] text-[#a1b0b0]">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- help dialog ---------- */

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="ClassPulse AI — quick guide" sub="Everything on this screen is live PostgreSQL data" onClose={onClose} width="max-w-xl">
      <div className="space-y-2 text-[11px] font-semibold leading-5 text-[#52717c]">
        <p><b className="text-[#315568]">Live pipeline:</b> every attendance, mark or submission write fires a DB trigger → academic event → pg_notify → SSE. The dashboard refreshes itself; you never reload.</p>
        <p><b className="text-[#315568]">Predictions:</b> the SQL engine re-scores affected students automatically and attaches human-readable reasons (attendance, quizzes, assignments, trend).</p>
        <p><b className="text-[#315568]">Ask the data:</b> type questions like “Why is Diya at risk?” — the assistant builds safe read-only SQL and shows it.</p>
        <p><b className="text-[#315568]">Act:</b> select a student → <b>Intervene</b> to plan support; mark items ✓ Done in the queue when resolved.</p>
        <p><b className="text-[#315568]">Simulate:</b> the Simulate event button injects random live activity so you can watch the system react.</p>
      </div>
    </Dialog>
  );
}

/* ---------- root app ---------- */

export default function App() {
  const [selectedReg, setSelectedReg] = useState<string | null>(null);
  const [selected, setSelectedDetail] = useState<StudentDetail | null>(null);
  const [live, setLive] = useState(true);
  const [view, setView] = useState("Overview");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [updatedAgo, setUpdatedAgo] = useState("just now");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [detailReg, setDetailReg] = useState<string | null>(null);
  const [interveneReg, setInterveneReg] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notifSignal, setNotifSignal] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);

  const showNotice = (m: string) => { setNotice(m); window.setTimeout(() => setNotice(""), 2300); };

  // restore faculty session on refresh
  useEffect(() => {
    if (!getToken()) return;
    api.me().then(r => setUser(r.user)).catch(() => setToken(""));
  }, []);

  const loadAll = () => {
    api.students().then(setStudents).catch(() => {});
    api.overview().then(setOverview).catch(() => {});
  };
  useEffect(loadAll, []);

  const { lastEvent, eventCount, connected } = useLiveStream(!live, () => {
    loadAll();
    if (selectedReg) api.student(selectedReg).then(setSelectedDetail).catch(() => {});
    setUpdatedAgo("just now");
  });

  useEffect(() => {
    if (!lastEvent) return;
    const t = setTimeout(() => setUpdatedAgo(`${Math.max(1, Math.round((Date.now() - new Date(lastEvent.at).getTime()) / 1000))} sec ago`), 7000);
    return () => clearTimeout(t);
  }, [lastEvent, eventCount]);

  useEffect(() => {
    if (selectedReg) api.student(selectedReg).then(setSelectedDetail).catch(() => {});
  }, [selectedReg]);

  // cross-component navigation signals
  useEffect(() => {
    const nav = (e: Event) => setView((e as CustomEvent).detail);
    const openNotif = () => setNotifSignal(s => s + 1);
    window.addEventListener("cp:navigate", nav);
    window.addEventListener("cp:open-notifications", openNotif);
    return () => { window.removeEventListener("cp:navigate", nav); window.removeEventListener("cp:open-notifications", openNotif); };
  }, []);

  const clearSearch = () => setSearch("");

  return (
    <div className="min-h-screen bg-[#f4f7f4] text-[#274552]">
      {notice && <div className="notice"><Check size={15} /> {notice}</div>}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {detailReg && <StudentDetailDialog regNo={detailReg} onClose={() => setDetailReg(null)} onNotice={showNotice} onIntervene={(r) => { setDetailReg(null); setInterveneReg(r); }} />}
      {interveneReg !== null && <InterventionDialog initialReg={interveneReg} onClose={() => setInterveneReg(null)} onNotice={showNotice} onCreated={loadAll} />}

      <div className="flex min-h-screen">
        <aside className="hidden w-[238px] shrink-0 flex-col border-r border-[#dce6e2] bg-[#fbfcfa] px-4 py-5 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="brand-mark"><BrainCircuit size={19} /></div>
            <div>
              <p className="brand-name">ClassPulse <span>AI</span></p>
              <p className="brand-sub">academic intelligence</p>
            </div>
          </div>
          <div className="mt-11">
            <p className="nav-label">Workspace</p>
            <nav className="mt-3 space-y-1">
              {[["Overview", LayoutDashboard], ["Ask the data", MessageSquareText], ["At-risk students", CircleAlert], ["Interventions", Target], ["Reports", ChartColumn]].map(([label, Icon]: any) => (
                <button key={label} className={`nav-link ${view === label ? "nav-link-active" : ""}`}
                  onClick={() => { setView(label); showNotice(`${label} view — live from PostgreSQL`); }}>
                  <Icon size={16} /><span>{label}</span>
                  {label === "At-risk students" && <span className="nav-badge">{overview?.needAttention ?? "…"}</span>}
                  {view === label && <ChevronRight className="ml-auto" size={14} />}
                </button>
              ))}
            </nav>
          </div>
          <div className="mt-9">
            <p className="nav-label">Manage</p>
            <nav className="mt-3 space-y-1">
              <button className={`nav-link ${view === "Subjects & rosters" ? "nav-link-active" : ""}`} onClick={() => setView("Subjects & rosters")}><BookOpen size={16} /><span>Subjects & rosters</span></button>
              <button className={`nav-link ${view === "Faculty access" ? "nav-link-active" : ""}`} onClick={() => setView("Faculty access")}><ShieldCheck size={16} /><span>Faculty access</span></button>
              <button className={`nav-link ${view === "Settings" ? "nav-link-active" : ""}`} onClick={() => setView("Settings")}><Settings2 size={16} /><span>Settings</span></button>
            </nav>
          </div>
          <div className="mt-auto rounded-2xl border border-[#d7e7df] bg-[#eef8f1] p-4">
            <div className="flex items-center justify-between">
              <span className="nav-label text-[#438269]">Prediction engine</span>
              <span className={`pulse ${connected ? "" : "opacity-30"}`} />
            </div>
            <p className="mt-3 text-xs font-bold text-[#315c4d]">ClassPulse Weighted Ensemble · v2.4</p>
            <p className="mt-1 text-[10px] leading-4 text-[#6f9283]">
              {eventCount > 0 ? `${eventCount} live events processed` : "Listening for academic events…"}
            </p>
            <div className="mt-4 flex items-center justify-between text-[10px] text-[#769487]">
              <span>SSE stream</span><b className="text-[#438269]">{connected ? "live" : "paused"}</b>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3 border-t border-[#dce6e2] px-2 pt-4">
            <div className="avatar">{user ? user.fullName.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() : "GU"}</div>
            <div>
              <p className="text-xs font-bold text-[#355668]">{user ? user.fullName : "Guest"}</p>
              <p className="text-[10px] text-[#879ba1]">{user ? `${user.role.charAt(0).toUpperCase() + user.role.slice(1)} · signed in` : "View only · not signed in"}</p>
            </div>
            {user
              ? <span title="Sign out" className="ml-auto cursor-pointer text-[#a2b0b0] hover:text-[#c56c52]"><LogOut size={15} onClick={() => { setToken(""); setUser(null); showNotice("Signed out — faculty entry locked"); }} /></span>
              : <span title="Faculty sign in" className="ml-auto cursor-pointer text-[#a2b0b0] hover:text-[#4b928d]"><Lock size={15} onClick={() => setView("Faculty access")} /></span>}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="topbar">
            <div className="flex items-center gap-3">
              <div className="mobile-logo"><BrainCircuit size={17} /></div>
              <div>
                <p className="eyebrow">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`pulse ${connected ? "" : "opacity-30"}`} />
                  <span className="text-xs font-bold text-[#456776]">CSE · Semester 5</span>
                  <span className="text-[#b1bfbd]">/</span>
                  <span className="text-xs text-[#8a9ea1]">{connected ? "live workspace" : "paused"}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="search-box">
                <Search size={14} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a student..." />
              </div>
              <NotificationBell onNotice={showNotice} openSignal={notifSignal} />
              {!user && <button className="top-icon" title="Faculty sign in" onClick={() => setView("Faculty access")}><Lock size={15} /></button>}
              <button className="top-icon" onClick={() => setHelpOpen(true)}><CircleHelp size={16} /></button>
            </div>
          </header>

          <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8">
            <div className="mb-7 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
              <div>
                <div className="flex items-center gap-2">
                  <span className="live-tag"><span className={`pulse ${connected ? "" : "opacity-30"}`} />LIVE ACADEMIC PULSE</span>
                  <span className="text-[11px] font-semibold text-[#829799]">· updated {updatedAgo}</span>
                </div>
                <h1 className="font-display mt-4 text-[31px] font-bold tracking-[-.045em] text-[#1f4658] md:text-[38px]">
                  See who needs support<br /><span className="text-[#4b928d]">before the exam does.</span>
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#718a91]">
                  ClassPulse combines live PostgreSQL data with explainable prediction, so every subject teacher knows where attention will have the most impact.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className={`secondary-button ${live ? "live-button" : ""}`} onClick={() => { setLive(!live); showNotice(live ? "Live mode paused" : "Live mode resumed"); }}>
                  {live ? <><span className="pulse" />Pause live mode</> : <><Play size={13} />Resume live mode</>}
                </button>
                <button className="primary-button" onClick={() => api.simulate().then(r => showNotice(r.ok ? "Academic event injected — watch the dashboard update" : "Simulation failed")).catch(e => showNotice((e as Error).message))}>
                  <Target size={14} />Simulate event
                </button>
              </div>
            </div>

            {view === "Overview" && <OverviewView students={students} selected={selected} setSelected={setSelectedReg} search={search} overview={overview} onNotice={showNotice} onOpenFull={setDetailReg} onIntervene={setInterveneReg} riskFilter={riskFilter} setRiskFilter={setRiskFilter} clearSearch={clearSearch} />}
            {view === "Ask the data" && <AskView onNotice={showNotice} />}
            {view === "At-risk students" && <AtRiskView students={students} setSelected={setSelectedReg} search={search} onOpenFull={setDetailReg} riskFilter={riskFilter} setRiskFilter={setRiskFilter} clearSearch={clearSearch} />}
            {view === "Interventions" && <InterventionsView onNotice={showNotice} onChanged={loadAll} />}
            {view === "Reports" && <ReportsView overview={overview} students={students} />}
            {view === "Subjects & rosters" && <SubjectsView overview={overview} />}
            {view === "Faculty access" && <FacultyView onNotice={showNotice} user={user} setUser={setUser} onOpenStudent={setDetailReg} />}
            {view === "Settings" && <SettingsView live={live} setLive={setLive} onNotice={showNotice} />}

            <footer className="mt-6 flex flex-col justify-between gap-2 border-t border-[#dce6e2] pt-4 text-[10px] text-[#94a5a6] sm:flex-row">
              <span>ClassPulse AI · ClassPulse Weighted Ensemble v2.4 · All predictions are explainable and auditable</span>
              <span className="flex items-center gap-1.5">
                <span className={`pulse ${connected ? "" : "opacity-30"}`} />
                {connected ? "Real-time PostgreSQL connected" : "Live mode paused"}
              </span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
