#!/usr/bin/env node
// Category taxonomy CLI. Modes: plan | apply | weekly | undo | hide | unhide | protect.
// Every mode that writes to the database needs ENABLE_TAXONOMY=1. The last stdout line is always a JSON
// object {runId, mode, status, report}. Exit codes: 0 ok / clean stop, 1 error, 2 refused, 3 outside the allowed time.
import { runCli } from '../lib/taxonomy/cli.js';

runCli(process.argv.slice(2), process.env).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error('taxonomy crashed:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);
