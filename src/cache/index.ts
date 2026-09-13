/**
 * Execute @actions/cache with predefined cache configs.
 */
import * as fs from 'fs';
import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as glob from '@actions/glob';
import hasha from 'hasha';
import { CacheInputs, InputName, DefaultInputs } from '../constants';
import { getInput, toStringArray } from '../utils/inputs';
import { loadState, saveState } from './state';
import caches from './caches'; // default cache configs

// GitHub uses `sha256` for the built-in `${{ hashFiles(...) }}` expression
// https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#hashfiles
const HASH_OPTION = { algorithm: 'sha256' };

/**
 * Load custom cache configs from the `caches` path defined in inputs.
 *
 * @returns Whether the loading is successfull.
 */
export async function loadCustomCacheConfigs(): Promise<boolean> {
  const customCachePath = getInput(InputName.Caches);
  try {
    core.debug(`Reading cache configs from '${customCachePath}'`);
    const customCache = await import(customCachePath);
    Object.assign(caches, customCache.default || customCache);
  } catch (error) {
    const { message } = error as Error;
    if (
      customCachePath !== DefaultInputs[InputName.Caches] ||
      !message.includes('Cannot find module')
    ) {
      core.error(message);
      core.setFailed(
        `Failed to load custom cache configs: '${customCachePath}'`,
      );
      process.exit(1);
      return false;
    }
  }
  return true;
}

/**
 * Generate SHA256 hash for a list of files matched by glob patterns.
 *
 * @param {string[]} patterns - The glob pattern.
 * @param {string} extra - The extra string to append to the file hashes to
 *                         comptue the final hash.
 */
export async function hashFiles(
  patterns: string[] | string,
  extra = '',
): Promise<string> {
  const globber = await glob.create(toStringArray(patterns).join('\n'));
  let hash = '';
  let counter = 0;
  for await (const file of globber.globGenerator()) {
    if (!fs.statSync(file).isDirectory()) {
      hash += hasha.fromFileSync(file, HASH_OPTION);
      counter += 1;
    }
  }
  core.debug(`Computed hash for ${counter} files. Pattern: ${patterns}`);
  return hasha(hash + extra, HASH_OPTION);
}

/**
 * Generate cache inputs (key, paths, restore keys) based on predefined cache
 * config.
 *
 * @param {string} cacheName - Name of the predefined cache config.
 */
export async function getCacheInputs(
  cacheName: string,
): Promise<CacheInputs | null> {
  if (!(cacheName in caches)) {
    return null;
  }
  const {
    keyPrefix,
    restoreKeys,
    path,
    hashFiles: patterns,
  } = caches[cacheName];
  const paths = toStringArray(path);
  const prefix = keyPrefix || `${cacheName}-`;
  // include `path` to hash, too, so to burst caches in case users change
  // the path definition.
  const hash = await hashFiles(patterns, paths.join('\n'));
  return {
    key: `${prefix}${hash}`,
    paths,
    // only use prefix as restore key if it is never defined
    restoreKeys:
      restoreKeys === undefined ? [prefix] : toStringArray(restoreKeys),
  };
}

function isExactKeyMatch(key: string, cacheKey?: string): boolean {
  return !!(
    cacheKey &&
    cacheKey.localeCompare(key, undefined, { sensitivity: 'accent' }) === 0
  );
}

function checkCacheService(): boolean {
  if (!cache.isFeatureAvailable()) {
    core.warning(
      'Cache service is not available. Make sure the `cache-restore` and ' +
        '`cache-save` commands are executed within the `run` input of ' +
        '`ktmud/cached-dependencies`.',
    );
    return false;
  }
  return true;
}

export const actions = {
  /**
   * Restore cache and remember which key matched, so that `save` can skip
   * uploading when the cache was restored with the exact primary key.
   */
  async restore(cacheName: string, inputs: CacheInputs): Promise<void> {
    const { key, paths, restoreKeys } = inputs;
    saveState(cacheName, { primaryKey: key, matchedKey: undefined });
    if (!checkCacheService()) {
      return;
    }
    try {
      const matchedKey = await cache.restoreCache(paths, key, restoreKeys);
      if (!matchedKey) {
        core.info(
          `Cache not found for input keys: ${[key, ...restoreKeys].join(', ')}`,
        );
        return;
      }
      saveState(cacheName, { matchedKey });
      core.info(`Cache restored from key: ${matchedKey}`);
    } catch (error) {
      if ((error as Error).name === cache.ValidationError.name) {
        throw error;
      }
      core.warning((error as Error).message);
    }
  },

  /**
   * Save cache unless it was restored with the exact primary key.
   */
  async save(cacheName: string, inputs: CacheInputs): Promise<void> {
    const { key, paths } = inputs;
    const { matchedKey } = loadState(cacheName);
    if (isExactKeyMatch(key, matchedKey)) {
      core.info(
        `Cache hit occurred on the primary key ${key}, not saving cache.`,
      );
      return;
    }
    if (!checkCacheService()) {
      return;
    }
    try {
      await cache.saveCache(paths, key);
      core.info(`Cache saved with key: ${key}`);
    } catch (error) {
      const { name, message } = error as Error;
      if (name === cache.ValidationError.name) {
        throw error;
      } else if (name === cache.ReserveCacheError.name) {
        core.info(message);
      } else {
        core.warning(message);
      }
    }
  },
};

export type ActionChoice = keyof typeof actions;

export async function run(
  action: string | undefined = undefined,
  cacheName: string | undefined = undefined,
): Promise<void> {
  if (!action || !(action in actions)) {
    core.setFailed(
      `Choose a cache action from: [${Object.keys(actions).join(', ')}]`,
    );
    return process.exit(1);
  }
  if (!cacheName) {
    core.setFailed(`Must provide a cache name.`);
    return process.exit(1);
  }

  const runInParallel = getInput(InputName.Parallel);

  if (await loadCustomCacheConfigs()) {
    if (runInParallel) {
      core.info(`${action.toUpperCase()} cache for ${cacheName}`);
    } else {
      core.startGroup(`${action.toUpperCase()} cache for ${cacheName}`);
    }
    const inputs = await getCacheInputs(cacheName);
    if (!inputs) {
      core.setFailed(`Cache '${cacheName}' not defined, failed to ${action}.`);
      return process.exit(1);
    }
    core.info(JSON.stringify(inputs, null, 2));
    try {
      await actions[action as ActionChoice](cacheName, inputs);
    } catch (error) {
      core.setFailed((error as Error).message);
      return process.exit(1);
    }
    if (!runInParallel) {
      core.endGroup();
    }
  }
}
