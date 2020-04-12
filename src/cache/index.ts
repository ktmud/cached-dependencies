/**
 * Execute @actions/cache with predefined cache configs.
 */
import { beginImport, doneImport } from './patch'; // monkey patch @actions modules

beginImport();
import saveCache from '@actions/cache/src/save';
import restoreCache from '@actions/cache/src/restore';
doneImport();

import hasha from 'hasha';
import * as fs from 'fs';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import { Inputs, InputName, DefaultInputs } from '../constants';
import { applyInputs, getInput } from '../utils/inputs';
import caches from './caches'; // default cache configs

// GitHub uses `sha256` for the built-in `${{ hashFiles(...) }}` expression
// https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#hashfiles
const HASH_OPTION = { algorithm: 'sha256' };

/**
 * Load custom cache configs from the `caches` path defined in inputs.
 *
 * @returns Whether the loading is successfull.
 */
export async function loadCustomCacheConfigs() {
  const customCachePath = getInput(InputName.Caches);
  try {
    core.debug(`Reading cache configs from '${customCachePath}'`);
    const customCache = await import(customCachePath);
    Object.assign(caches, customCache.default);
  } catch (error) {
    if (
      customCachePath !== DefaultInputs[InputName.Caches] ||
      !error.message.includes('Cannot find module')
    ) {
      core.error(error.message);
      core.setFailed(
        `Failed to load custom cache configs: '${customCachePath}'`,
      );
      return process.exit(1);
    }
  }
  return true;
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

export const actions = {
  restore(inputs: Inputs) {
    return applyInputs(inputs, restoreCache);
  },
  save(inputs: Inputs) {
    return applyInputs(inputs, saveCache);
  },
};

export type ActionChoice = keyof typeof actions;

export async function run(
  action: string | undefined = undefined,
  cacheName: string | undefined = undefined,
) {
  if (!action || !(action in actions)) {
    core.setFailed(`Choose a cache action from: [restore, save]`);
    return process.exit(1);
  }
  if (!cacheName) {
    core.setFailed(`Must provide a cache name.`);
    return process.exit(1);
  }

  const runInParallel = getInput(InputName.Parallel);

  if (!runInParallel) {
    core.startGroup(`${action.toUpperCase()} cache for ${cacheName}`);
  }
  if (await loadCustomCacheConfigs()) {
    const inputs = await getCacheInputs(cacheName);
    if (inputs) {
      core.info(JSON.stringify(inputs, null, 2));
      await actions[action as ActionChoice](inputs);
    } else {
      core.setFailed(`Cache '${cacheName}' not defined, failed to ${action}.`);
      process.exit(1);
    }
  }
  if (!runInParallel) {
    core.endGroup();
  }
}
