/**
 * Prints the Vitest v8 coverage totals as a GitHub-flavoured markdown table.
 * Used by CI to surface coverage in the job summary. Vitest enforces the
 * repository-wide minimums configured in vitest.config.ts.
 *
 * Reads ./coverage/coverage-summary.json (json-summary reporter output).
 */
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
const { total } = data;

const cell = (metric) =>
  `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;

const lines = [
  "### Coverage",
  "",
  "| Metric | Coverage |",
  "| --- | --- |",
  `| Statements | ${cell(total.statements)} |`,
  `| Branches | ${cell(total.branches)} |`,
  `| Functions | ${cell(total.functions)} |`,
  `| Lines | ${cell(total.lines)} |`,
  "",
];

process.stdout.write(`${lines.join("\n")}\n`);
