/**
 * Execute @actions/cache with predefined cache configs.
 */
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as fs from 'fs';
import hasha from 'hasha';
import caches from './caches';
import { Inputs, InputName, EnvVariable, DefaultInputs } from '../constants';
import { applyInputs } from '../utils/inputs';

// GitHub uses `sha256` for the built-in `${{ hashFiles(...) }}` expression
// https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#hashfiles
const HASH_OPTION = { algorithm: 'sha256' };

/**
 * Load custom cache configs from the `caches` path defined in inputs.
 */
export async function loadCustomCacheConfigs() {
  const customCachePath = core.getInput('caches') || DefaultInputs.Caches;
  try {
    const customCache = await import(customCachePath);
    Object.assign(caches, customCache.default);
    core.debug(`Use cache configs from ${customCachePath}`);
  } catch (error) {
    core.setFailed(`Failed to load custom cache configs: ${customCachePath}`);
    return;
  }
}

/**
 * Generate SHA256 hash for a list of files matched by glob patterns.
 *
 * @param {string[]} patterns - The glob pattern.
 */
export async function hashFiles(patterns: string[]) {
  const globber = await glob.create(patterns.join('\n'));
  let hash = '';
  let counter = 0;
  for await (const file of globber.globGenerator()) {
    if (!fs.statSync(file).isDirectory()) {
      hash += hasha.fromFileSync(file, HASH_OPTION);
      counter += 1;
    }
  }
  core.debug(`Computed hash for ${counter} files. Pattern: ${patterns}`);
  return hasha(hash, HASH_OPTION);
}

/**
 * Generate GitHub Action inputs based on predefined cache config. Will be used
 * to override env variables.
 *
 * @param {string} cacheName - Name of the predefined cache config.
 */
export async function getCacheInputs(
  cacheName: string,
): Promise<Inputs | null> {
  if (!(cacheName in caches)) {
    return null;
  }
  const { keyPrefix, restoreKeys, path, hashFiles: patterns } = caches[
    cacheName
  ];
  const prefix = keyPrefix || `${cacheName}-`;
  const hash = await hashFiles(patterns);
  return {
    [InputName.Key]: `${prefix}${hash}`,
    [InputName.Path]: path.join('\n'),
    // only use prefix as restore key if it is never defined
    [InputName.RestoreKeys]:
      restoreKeys === undefined ? prefix : restoreKeys.join('\n'),
  };
}

/**
 * Import `@actions/cache` modules safely, i.e., force GitHub event name to be
 * empty, so actual runner code doesn't execute. Then we manually trigger the
 * run with new inputs.
 *
 * Note we can't just apply inputs before import, because the runner is always
 * called at first import, and there is no way to capture the returned promise.
 * We want to capture the promise so we have guarantees on when the job finishes.
 *
 * @param {string} moduleName - Name of the JS module to import.
 * @param {Inputs} inputs - Custom inputs to apply to the runner.
 */
async function safeImportRun(moduleName: string, inputs: Inputs) {
  // We assume the default export of the module is always the runner function.
  const { default: runModule } = await applyInputs(
    { [EnvVariable.GitHubEventName]: '' },
    () => import(moduleName),
  );
  return await applyInputs(inputs, runModule);
}

export const actions = {
  restore(inputs: Inputs) {
    return safeImportRun('@actions/cache/dist/save', inputs);
  },
  save(inputs: Inputs) {
    return safeImportRun('@actions/cache/dist/save', inputs);
  },
};

export type ActionChoice = keyof typeof actions;

export async function run(
  action: string | undefined = undefined,
  cacheName: string | undefined = undefined,
) {
  if (!action || !(action in actions)) {
    core.setFailed(`Choose a cache action from: [restore, save]`);
    return;
  }
  if (!cacheName) {
    core.setFailed(`Must provide a cache name.`);
    return;
  }
  await loadCustomCacheConfigs();
  const inputs = await getCacheInputs(cacheName);
  if (inputs) {
    await actions[action as ActionChoice](inputs);
  } else {
    core.setFailed(`Cache "${cacheName}" not defined, failed to ${action}.`);
  }
}
