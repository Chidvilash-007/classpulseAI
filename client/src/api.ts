export type Risk = "On track" | "Moderate" | "High" | "Critical";

export interface StudentRow {
  id: string;
  studentId: number;
  subjectId: number;
  name: string;
  initials: string;
  department: string;
  section: string;
  gpa: string;
  attendance: number;
  risk: Risk;
  prediction: number;
  passProbability: number;
  subject: string;
  subjectCode: string;
  delta: string;
  factors: string[];
  updatedAt: string;
}

export interface StudentDetail extends StudentRow {
  allSubjects: { subject: string; subjectCode: string; risk: Risk; prediction: number; attendance: number }[];
  trajectory: { label: string; type: string; pct: number; date: string }[];
  predictionHistory: { predicted_score: string; risk_level: Risk; predicted_at: string }[];
  interventions: Record<string, unknown>[];
}

export interface Overview {
  studentsMonitored: number;
  needAttention: number;
  needAttentionPct: number;
  avgPredictedScore: number;
  interventionsActive: number;
  recentEvents: { event_type: string; created_at: string; processing_status: string }[];
  subjects: { code: string; name: string; riskPct: number; avgScore: number; color: string }[];
  riskDistribution: Record<string, number>;
}

export interface Intervention {
  intervention_id: number;
  intervention_type: string;
  status: string;
  review_date: string | null;
  description: string | null;
  full_name: string;
  registration_number: string;
  subject_code: string | null;
  subject_name: string | null;
  assigned_to: string | null;
}

export interface Notification {
  notification_id: number;
  notification_type: string;
  severity: string;
  message: string;
  is_read: boolean;
  created_at: string;
  student_name: string | null;
  registration_number: string | null;
}

export interface AskAnswer {
  question: string;
  intent: string;
  sql: string;
  safety: { ok: boolean; problems: string[] };
  explanation: string;
  rows: Record<string, unknown>[] | null;
  rowCount?: number;
  durationMs?: number;
  error: string | null;
}

export interface AuthUser {
  userId: number;
  fullName: string;
  email: string;
  role: string;
}

export interface RosterRow {
  student_id: number;
  registration_number: string;
  full_name: string;
  section: string;
  semester: number;
  current_gpa: string | null;
  email: string | null;
  attendance_pct: string | null;
  risk_level: Risk | null;
  predicted_score: string | null;
  pass_probability: string | null;
  today_present: boolean | null;
}

export interface AssessmentRow {
  assessment_id: number;
  assessment_name: string;
  assessment_type: string;
  max_marks: string;
  assessment_date: string | null;
  subject_code: string;
  subject_name: string;
  marks_entered: number;
}

const BASE = import.meta.env.VITE_API_URL || "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path}: ${res.statusText}`);
  return res.json();
}

const TOKEN_KEY = "cp_token";
export function getToken(): string { return localStorage.getItem(TOKEN_KEY) || ""; }
export function setToken(t: string): void { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function authPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body ?? {}) });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch { /* keep statusText */ }
    throw new Error(msg);
  }
  return res.json();
}

async function authGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${path}: ${res.statusText}`);
  return res.json();
}

export const api = {
  overview: () => get<Overview>("/api/overview"),
  students: (search = "") => get<StudentRow[]>(`/api/students?search=${encodeURIComponent(search)}`),
  student: (regNo: string) => get<StudentDetail>(`/api/students/${encodeURIComponent(regNo)}`),
  interventions: () => get<Intervention[]>("/api/interventions"),
  createIntervention: (body: Record<string, unknown>) => post<{ ok: boolean }>("/api/interventions", body),
  updateIntervention: (id: number, body: Record<string, unknown>) => post<{ ok: boolean }>(`/api/interventions/${id}/status`, body),
  recompute: () => post<{ ok: boolean; predictions: number }>("/api/recompute"),
  notifications: () => get<Notification[]>("/api/notifications"),
  markNotificationsRead: () => post<{ ok: boolean }>("/api/notifications/read-all"),
  events: () => get<Record<string, unknown>[]>("/api/events"),
  ask: (question: string) => post<AskAnswer>("/api/ask", { question }),
  simulate: () => post<{ ok: boolean }>("/api/simulate"),
  markAttendance: (body: { registrationNumber: string; subjectCode: string; present: boolean; date?: string }) =>
    authPost<{ ok: boolean }>("/api/attendance", body),
  enterMarks: (body: { registrationNumber: string; assessmentId: number; marksObtained: number }) =>
    authPost<{ ok: boolean }>("/api/marks", body),

  // ---------- faculty auth + data entry ----------
  login: (email: string, password: string) =>
    post<{ ok: boolean; token: string; user: AuthUser }>("/api/auth/login", { email, password }),
  me: () => authGet<{ user: AuthUser }>("/api/auth/me"),
  roster: (subjectCode: string, date?: string) =>
    get<RosterRow[]>(`/api/roster?subjectCode=${encodeURIComponent(subjectCode)}${date ? `&date=${date}` : ""}`),
  assessments: (subjectCode: string) =>
    get<AssessmentRow[]>(`/api/assessments?subjectCode=${encodeURIComponent(subjectCode)}`),
  addStudent: (body: { fullName: string; registrationNumber?: string; email?: string; section?: string; semester?: number; gpa?: number | null; subjectCodes?: string[] }) =>
    authPost<{ ok: boolean; student: { student_id: number; registration_number: string; full_name: string }; enrolled: string[] }>("/api/students", body),
  bulkAttendance: (body: { subjectCode: string; date: string; records: { registrationNumber: string; present: boolean }[] }) =>
    authPost<{ ok: boolean; saved: number; skipped: number }>("/api/attendance/bulk", body),
  bulkMarks: (body: { subjectCode: string; assessmentId?: number; assessment?: { name: string; type: string; maxMarks: number; date?: string }; records: { registrationNumber: string; marksObtained: number }[] }) =>
    authPost<{ ok: boolean; assessment: { id: number; name: string; maxMarks: number }; saved: number; skipped: number }>("/api/marks/bulk", body),
  importCsv: (kind: "attendance" | "marks", subjectCode: string, csv: string) =>
    authPost<{ ok: boolean; kind: string; subjectCode: string; saved: number; skipped: number; errors: { line: number; error: string }[] }>("/api/import/csv", { kind, subjectCode, csv }),
};

export { BASE };
