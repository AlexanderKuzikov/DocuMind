#!/usr/bin/env node
import { configDoctor, dryRun, renderPrompt, runPipeline } from './orchestrator.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  if (command === 'config:doctor') {
    await configDoctor(args);
  } else if (command === 'dry-run') {
    await dryRun(args);
  } else if (command === 'prompt:render') {
    await renderPrompt(args);
  } else if (command === 'extract' || !command) {
    const results = await runPipeline(args);
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'UNHANDLED_ERROR',
    message: error.message
  }, null, 2));
  process.exitCode = 1;
}
