// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/**
 * `npm run build` with a job count that fits the machine.
 *
 * A Firefox build runs one compile job per core, and the Rust style crate
 * alone can take several GB. On a laptop with 16 GB that exhausts memory and
 * can take the whole system down, so locally the default is one job per 4 GB
 * of RAM (and two cores left free), at a lower priority. CI (the CI variable)
 * keeps surfer's default of every core.
 *
 *   npm run build [-- <surfer build options>]
 *
 * PM_BUILD_JOBS=<n> overrides the count. An explicit -j / --jobs is kept.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const GB_PER_JOB = 4;
const CORES_LEFT_FREE = 2;
const NICENESS = 10;

export function defaultJobs(
  cpus = os.cpus().length,
  totalMemory = os.totalmem()
) {
  const byMemory = Math.floor(totalMemory / 1024 ** 3 / GB_PER_JOB);
  return Math.max(2, Math.min(cpus - CORES_LEFT_FREE, byMemory));
}

export function buildArgs(argv, env = process.env) {
  const args = ["build", ...argv];
  const hasJobs = argv.some(
    arg => arg === "-j" || arg === "--jobs" || /^-j\d+$/.test(arg)
  );
  if (hasJobs || (env.CI && !env.PM_BUILD_JOBS)) {
    return args;
  }
  const jobs = parseInt(env.PM_BUILD_JOBS, 10) || defaultJobs();
  return [...args, "-j", String(jobs)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = buildArgs(process.argv.slice(2));
  console.log(`build: surfer ${args.join(" ")}`);
  if (process.env.PM_BUILD_DRY_RUN) {
    process.exit(0);
  }
  try {
    os.setPriority(NICENESS);
  } catch {
    // A lower priority is a courtesy, not a requirement.
  }
  const child = spawn(path.join(root, "node_modules/.bin/surfer"), args, {
    cwd: root,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
