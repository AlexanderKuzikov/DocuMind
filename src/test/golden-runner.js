import fs from 'node:fs/promises';
import path from 'node:path';
import { runPipeline } from '../orchestrator.js';
import { projectRoot } from '../lib/paths.js';

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function runGolden() {
  const goldenRoot = path.join(projectRoot, 'golden');
  const cases = [];
  try {
    const entries = await fs.readdir(goldenRoot, { withFileTypes: true });
    for (const typeEntry of entries.filter((entry) => entry.isDirectory())) {
      const caseDir = path.join(goldenRoot, typeEntry.name);
      const caseEntries = await fs.readdir(caseDir, { withFileTypes: true });
      for (const caseEntry of caseEntries.filter((entry) => entry.isDirectory())) {
        cases.push(path.join(caseDir, caseEntry.name));
      }
    }
  } catch (_) {
    console.log(JSON.stringify({ ok: true, message: 'No golden cases found' }, null, 2));
    return;
  }

  const summary = [];
  for (const caseDir of cases) {
    const expected = JSON.parse(await fs.readFile(path.join(caseDir, 'expected.json'), 'utf8'));
    const result = await runPipeline({ input: path.join(caseDir, 'input') });
    const actual = result[0]?.outputPath ? JSON.parse(await fs.readFile(result[0].outputPath, 'utf8')) : null;
    const passed = actual && deepEqual(actual.fields, expected.fields) && actual.docType === expected.docType;
    summary.push({
      case: path.relative(projectRoot, caseDir),
      passed,
      actualStatus: actual?.status || null,
      expectedStatus: expected.status
    });
  }

  console.log(JSON.stringify({ ok: summary.every((item) => item.passed), summary }, null, 2));
  if (!summary.every((item) => item.passed)) process.exitCode = 1;
}

runGolden().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
