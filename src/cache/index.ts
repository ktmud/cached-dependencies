/**
 * Execute @actions/cache with predefined cache configs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import * as core from '@actions/core';
import * as cache from '@actions/cache';
import * as glob from '@actions/glob';
import { CacheInputs, InputName, DefaultInputs } from '../constants.js';
import { getInput, toStringArray } from '../utils/inputs.js';
import { loadState, saveState } from './state.js';
import caches from './caches.js'; // default cache configs

// GitHub uses `sha256` for the built-in `${{ hashFiles(...) }}` expression
// https://help.github.com/en/actions/reference/context-and-expression-syntax-for-github-actions#hashfiles
function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Load custom cache configs from the `caches` path defined in inputs.
 *
 * @returns Whether the loading is successfull.
 */
export async function loadCustomCacheConfigs(): Promise<boolean> {
  const customCachePath = getInput(InputName.Caches);
  const isDefault = customCachePath === DefaultInputs[InputName.Caches];
  const resolvedPath = path.resolve(customCachePath);
  if (!fs.existsSync(resolvedPath)) {
    if (isDefault) {
      core.debug(`No custom cache configs found at '${resolvedPath}'`);
      return true;
    }
    core.setFailed(`Custom cache configs not found: '${customCachePath}'`);
    process.exit(1);
    return false;
  }
  try {
    core.debug(`Reading cache configs from '${resolvedPath}'`);
    // must use a file URL for dynamic imports to work on Windows
    const customCache = await import(
      /* webpackIgnore: true */ pathToFileURL(resolvedPath).href
    );
    Object.assign(caches, customCache.default || customCache);
  } catch (error) {
    core.error((error as Error).message);
    core.setFailed(`Failed to load custom cache configs: '${customCachePath}'`);
    process.exit(1);
    return false;
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
      hash += sha256(fs.readFileSync(file));
      counter += 1;
    }
  }
  core.debug(`Computed hash for ${counter} files. Pattern: ${patterns}`);
  return sha256(hash + extra);
}

// Env variables whose values depend on the runner (and therefore must not
// leak into cache keys), ordered from the most specific to the least.
const RUNNER_PATH_VARIABLES = [
  'GITHUB_WORKSPACE',
  'RUNNER_TOOL_CACHE',
  'RUNNER_TEMP',
  'HOME',
];

/**
 * Normalize a cache path for the purpose of computing cache keys.
 *
 * The workspace and home directories differ between runners (e.g.
 * `/home/runner/work/repo/repo` on hosted runners vs. `/runner/_work/repo/repo`
 * on self-hosted runners), so we replace them with placeholders to make sure
 * the same cache config always generates the same cache key.
 */
export function normalizePathForKey(cachePath: string): string {
  const normalized = cachePath.replace(/\\/g, '/');
  if (normalized === '~' || normalized.startsWith('~/')) {
    return `$HOME${normalized.slice(1)}`;
  }
  for (const name of RUNNER_PATH_VARIABLES) {
    const value = (process.env[name] || '').replace(/\\/g, '/');
    if (value && (normalized === value || normalized.startsWith(`${value}/`))) {
      return `$${name}${normalized.slice(value.length)}`;
    }
  }
  return normalized;
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
  const hash = await hashFiles(
    patterns,
    paths.map(normalizePathForKey).join('\n'),
  );
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

// Exit codes for `check`
export enum CheckResult {
  ExactMatch = 0,
  NotFound = 1,
  PartialMatch = 2,
}

/**
 * Cache actions. Each action may return a number to be used as the exit code
 * of the runner script.
 */
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

  /**
   * Check whether a cache exists without downloading it. Exits with 0 when
   * a cache matching the primary key exists, 2 when only one of the restore
   * keys matched, and 1 when no cache was found.
   */
  async check(cacheName: string, inputs: CacheInputs): Promise<number> {
    const { key, paths, restoreKeys } = inputs;
    if (!checkCacheService()) {
      return CheckResult.NotFound;
    }
    try {
      const matchedKey = await cache.restoreCache(paths, key, restoreKeys, {
        lookupOnly: true,
      });
      if (!matchedKey) {
        core.info(
          `Cache not found for input keys: ${[key, ...restoreKeys].join(', ')}`,
        );
        return CheckResult.NotFound;
      }
      if (isExactKeyMatch(key, matchedKey)) {
        core.info(`Cache found for the primary key: ${matchedKey}`);
        return CheckResult.ExactMatch;
      }
      core.info(`Cache found for a restore key: ${matchedKey}`);
      return CheckResult.PartialMatch;
    } catch (error) {
      if ((error as Error).name === cache.ValidationError.name) {
        throw error;
      }
      core.warning((error as Error).message);
      return CheckResult.NotFound;
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
      const exitCode = await actions[action as ActionChoice](cacheName, inputs);
      if (typeof exitCode === 'number') {
        process.exitCode = exitCode;
      }
    } catch (error) {
      core.setFailed((error as Error).message);
      return process.exit(1);
    }
    if (!runInParallel) {
      core.endGroup();
    }
  }
}
