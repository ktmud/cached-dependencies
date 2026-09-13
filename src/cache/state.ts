/**
 * Persistent states for cache actions.
 *
 * `core.saveState` and `core.getState` from `@actions/core` only work across
 * different steps (state is passed as env variables to the `post` step). Since
 * `cache-restore` and `cache-save` are separate processes running inside the
 * same step, we persist states in a temp file instead. Each cache has its own
 * file so that parallel commands don't overwrite each other.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';

export interface CacheState {
  // the primary key used to restore the cache
  primaryKey?: string;
  // the key actually matched when restoring
  matchedKey?: string;
}

export function getStateFile(cacheName: string): string {
  // `RUNNER_TEMP` is cleaned up at the beginning and end of each job, so
  // states never leak between jobs on self-hosted runners.
  const tmpDir = process.env.RUNNER_TEMP || os.tmpdir();
  const runId = [process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT]
    .filter(x => !!x)
    .join('-');
  const safeName = cacheName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(
    tmpDir,
    `cached-dependencies-${runId ? `${runId}-` : ''}${safeName}-state.json`,
  );
}

export function loadState(cacheName: string): CacheState {
  const stateFile = getStateFile(cacheName);
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, { encoding: 'utf-8' }));
    core.debug(`Loaded state from ${stateFile}: ${JSON.stringify(state)}`);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      core.warning(
        `Could not load cache state from ${stateFile}: ${
          (error as Error).message
        }`,
      );
    }
  }
  return {};
}

export function saveState(cacheName: string, state: CacheState): CacheState {
  const stateFile = getStateFile(cacheName);
  const newState = { ...loadState(cacheName), ...state };
  fs.writeFileSync(stateFile, JSON.stringify(newState, null, 2), {
    encoding: 'utf-8',
  });
  core.debug(`Saved state to ${stateFile}: ${JSON.stringify(newState)}`);
  return newState;
}
