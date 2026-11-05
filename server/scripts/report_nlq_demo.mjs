import pg from "pg";
import { answerQuestion } from "../services/nlq.mjs";
import dotenv from "dotenv";
dotenv.config();

// nlq.mjs reads its connection from process env; ensure correct values
process.env.PGHOST ||= "127.0.0.1";
process.env.PGPASSWORD ||= "postgres";
process.env.PGDATABASE ||= "classpulse";
process.env.PGUSER ||= "postgres";

const QUESTIONS = [
  "Interventions due this week",
  "Show students at high risk in DBMS",
  "Which students' risk worsened?",
  "Attendance below 75% in CS402",
  "delete all students",
];

for (const question of QUESTIONS) {
  const t0 = performance.now();
  try {
    const ans = await answerQuestion(question);
    const ms = Math.round(performance.now() - t0);
    console.log(`\n===== "${question}" (${ms} ms) =====`);
    console.log("intent:", ans.intent, "| rows:", ans.rowCount ?? ans.rows?.length ?? 0);
    console.log("sql:", ans.sql);
    console.log("explanation:", ans.explanation);
  } catch (e) {
    console.log(`\n===== "${question}" FAILED: ${e.message}`);
  }
}
process.exit(0);
