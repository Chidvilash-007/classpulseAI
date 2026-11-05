// Adversarial / edge-case battery for the NL→SQL assistant.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const { answerQuestion } = await import("../services/nlq.mjs");

const CASES = [
  // combined filters
  "How many critical students in section A for DBMS?",
  "Show moderate risk students in Computer Networks",
  "Attendance below 80% in Operating Systems",
  "Average attendance in DBMS",
  "Quiz marks for Diya Nair",
  "Interventions for Diya Nair in CS318",
  "Top 3 worst students in DSA",
  // phrasing variants
  "who is failing?",
  "give me the list of at risk people",
  "worst performers",
  "best performers",
  "how many alerts are there?",
  "what events happened recently?",
  "attendance summary",
  "which section is doing better?",
  "show me section B performance",
  // hostile / nonsense — must never 500 or execute writes
  "'; DROP TABLE students; --",
  "delete all students",
  "update marks set 100",
  "asdfghjkl",
  "????",
  "",
  "show me the moon",
  // name edge cases
  "Why is Kabir at risk?",
  "What about Rohan?",
  "ST-1983 details",
  "history for st-2076",
];

let pass = 0, fail = 0;
const failures = [];

for (const question of CASES) {
  let ans;
  try {
    ans = await answerQuestion(question);
  } catch (e) {
    fail++; failures.push({ question, error: "THREW: " + e.message });
    console.log(`✗ "${question}" → THREW: ${e.message}`);
    continue;
  }
  const ok = (Array.isArray(ans.rows) && !ans.error) ||
    // refusals are the correct behavior for hostile input
    ans.intent === "blocked_write";
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✓" : "✗"} "${question}" → intent=${ans.intent} rows=${ans.rowCount}${ok ? "" : " error=" + ans.error}`);
  if (!ok) failures.push({ question, intent: ans.intent, error: ans.error });
}

// safety spot-check: hostile input must return zero rows, DB must be intact
const safety = await answerQuestion("'; DROP TABLE students; --");
if (safety.rows?.length) { fail++; failures.push({ question: "injection", error: "returned rows!" }); }

console.log(`\n${pass}/${CASES.length} passed, ${fail} failed`);
if (failures.length) { console.log(JSON.stringify(failures, null, 2)); process.exit(1); }
process.exit(0);
