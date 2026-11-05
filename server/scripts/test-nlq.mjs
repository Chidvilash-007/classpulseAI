// Test battery for the NL→SQL assistant. Run: node server/scripts/test-nlq.mjs
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const { answerQuestion } = await import("../services/nlq.mjs");

const CASES = [
  // risk lists & counts
  "Show students at high risk in DBMS",
  "Which CSE students are at risk?",
  "How many students are critical in CS402?",
  "How many students need attention?",
  "List critical students in section A",
  "Top 10 worst predictions",
  "Worst 5 students",
  "Show me failing students",
  "Students on track in Operating Systems",
  // attendance
  "Attendance below 75%",
  "Show students whose attendance fell below 60% in DBMS",
  "Average attendance by subject",
  "What is the attendance situation?",
  // marks & assessments
  "Class average for Quiz 1 in DBMS",
  "Show all quiz marks for Aarav Sharma",
  "Show quiz marks for ST-2048",
  "Internal marks overview",
  // gpa
  "Top 5 by GPA",
  "Students with GPA below 6.5",
  "Bottom 5 by GPA",
  // trends
  "Which students' risk improved?",
  "Which students' risk worsened?",
  "Show recent risk changes",
  "Show Aarav Sharma's prediction history",
  "Show ST-2117 prediction history",
  // subjects
  "Which subject needs the most intervention?",
  "Compare subjects",
  "Pass rate for Computer Networks",
  "Average predicted score by subject",
  // interventions / notifications / events
  "Show all interventions",
  "Interventions for Aarav Sharma",
  "Interventions due this week",
  "Show recent notifications",
  "Show recent events",
  // per-student explain
  "Why is Aarav at risk in Database Management Systems?",
  "Why is Diya Nair at risk?",
  "Details for ST-2204",
  "Profile of Meera Iyer",
  // meta
  "Help",
  "What can you do?",
  "How does the prediction work?",
  // fallback sanity
  "Which CSE students are at risk in DBMS?",
];

let pass = 0, fail = 0;
const failures = [];

for (const question of CASES) {
  const t0 = Date.now();
  let ans;
  try {
    ans = await answerQuestion(question);
  } catch (e) {
    fail++; failures.push({ question, error: "THREW: " + e.message });
    continue;
  }
  const ms = Date.now() - t0;
  const ok = !ans.error && Array.isArray(ans.rows);
  if (ok) pass++; else fail++;
  const note = ok
    ? `ok (${ans.rowCount} rows, ${ans.durationMs}ms, intent=${ans.intent})`
    : `FAIL intent=${ans.intent} error=${ans.error}`;
  console.log(`${ok ? "✓" : "✗"} "${question}" → ${note}`);
  if (!ok) failures.push({ question, intent: ans.intent, error: ans.error, sql: ans.sql?.slice(0, 200) });
}

console.log(`\n${pass}/${CASES.length} passed, ${fail} failed`);
if (failures.length) {
  console.log("\n--- failures ---");
  for (const f of failures) console.log(JSON.stringify(f, null, 2));
  process.exit(1);
}
process.exit(0);
