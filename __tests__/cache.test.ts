import path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as core from '@actions/core';
import * as actionsCache from '@actions/cache';
import * as glob from '@actions/glob';
import hasha from 'hasha';
import * as cache from '../src/cache';
import { getStateFile, loadState, saveState } from '../src/cache/state';
import defaultCaches from '../src/cache/caches';
import { setInputs, toStringArray } from '../src/utils/inputs';
import { InputName } from '../src/constants';
import caches from './fixtures/caches';

jest.mock('@actions/cache', () => {
  const actual = jest.requireActual('@actions/cache');
  return {
    ...actual,
    isFeatureAvailable: jest.fn(() => true),
    restoreCache: jest.fn(async () => undefined),
    saveCache: jest.fn(async () => 1),
  };
});

const restoreCacheMock = actionsCache.restoreCache as jest.Mock;
const saveCacheMock = actionsCache.saveCache as jest.Mock;
const isFeatureAvailableMock = actionsCache.isFeatureAvailable as jest.Mock;

const fixtureCaches = path.resolve(__dirname, 'fixtures/caches');

/**
 * Compute the expected hash the same way GitHub's `hashFiles` does, plus the
 * cache paths.
 */
async function expectedHash(patterns: string[], paths: string[]) {
  const globber = await glob.create(patterns.join('\n'));
  let hash = '';
  for (const file of await globber.glob()) {
    if (!fs.statSync(file).isDirectory()) {
      hash += hasha.fromFileSync(file, { algorithm: 'sha256' });
    }
  }
  return hasha(hash + paths.map(cache.normalizePathForKey).join('\n'), {
    algorithm: 'sha256',
  });
}

describe('cache states', () => {
  it('should persist state in a temp file', () => {
    const stateFile = getStateFile('test/cache');
    expect(stateFile.startsWith(process.env.RUNNER_TEMP || os.tmpdir())).toBe(
      true,
    );
    expect(path.basename(stateFile)).toBe(
      `cached-dependencies-${[
        process.env.GITHUB_RUN_ID,
        process.env.GITHUB_RUN_ATTEMPT,
        'test_cache-state.json',
      ]
        .filter(x => !!x)
        .join('-')}`,
    );
    fs.rmSync(stateFile, { force: true });

    expect(loadState('test/cache')).toStrictEqual({});
    saveState('test/cache', { primaryKey: 'a' });
    saveState('test/cache', { matchedKey: 'b' });
    expect(loadState('test/cache')).toStrictEqual({
      primaryKey: 'a',
      matchedKey: 'b',
    });
    fs.rmSync(stateFile, { force: true });
  });

  it('should warn if state file is invalid', () => {
    const warningMock = jest.spyOn(core, 'warning').mockImplementation();
    const stateFile = getStateFile('invalid');
    fs.writeFileSync(stateFile, 'INVALID_JSON', { encoding: 'utf-8' });
    expect(loadState('invalid')).toStrictEqual({});
    expect(warningMock).toHaveBeenCalledTimes(1);
    fs.rmSync(stateFile, { force: true });
  });
});

describe('cache configs', () => {
  it('should use default cache config', async () => {
    setInputs({ [InputName.Caches]: '' });
    expect(await cache.loadCustomCacheConfigs()).toBe(true);
    const inputs = await cache.getCacheInputs('npm');
    expect(inputs?.paths).toStrictEqual(toStringArray(defaultCaches.npm.path));
    expect(inputs?.restoreKeys).toStrictEqual(['npm-']);
    expect(inputs?.key.startsWith('npm-')).toBe(true);
  });

  it('should return null for unknown cache', async () => {
    expect(await cache.getCacheInputs('unknown-cache')).toBeNull();
  });

  it('should override cache config', async () => {
    setInputs({ [InputName.Caches]: fixtureCaches });
    expect(await cache.loadCustomCacheConfigs()).toBe(true);

    const inputs = await cache.getCacheInputs('npm');
    const paths = toStringArray(caches.npm.path);
    expect(inputs).toStrictEqual({
      key: `npm-${await expectedHash(caches.npm.hashFiles, paths)}`,
      paths,
      restoreKeys: [caches.npm.restoreKeys],
    });
  });

  it('should exit when custom config does not exist', async () => {
    const processExitMock = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    setInputs({ [InputName.Caches]: 'non-existent' });
    expect(await cache.loadCustomCacheConfigs()).toBe(false);
    expect(processExitMock).toHaveBeenCalledWith(1);
  });
});

describe('cache runner', () => {
  beforeEach(() => {
    setInputs({
      [InputName.Caches]: fixtureCaches,
      [InputName.Parallel]: '',
    });
    fs.rmSync(getStateFile('npm'), { force: true });
  });

  it('should restore and skip save on exact key match', async () => {
    const inputs = await cache.getCacheInputs('npm');
    restoreCacheMock.mockResolvedValueOnce(inputs?.key);

    await cache.run('restore', 'npm');
    expect(restoreCacheMock).toHaveBeenCalledWith(
      inputs?.paths,
      inputs?.key,
      inputs?.restoreKeys,
    );
    expect(loadState('npm')).toStrictEqual({
      primaryKey: inputs?.key,
      matchedKey: inputs?.key,
    });

    await cache.run('save', 'npm');
    expect(saveCacheMock).not.toHaveBeenCalled();
  });

  it('should save when restored from a fallback key', async () => {
    const inputs = await cache.getCacheInputs('npm');
    restoreCacheMock.mockResolvedValueOnce('node-npm-outdated');

    await cache.run('restore', 'npm');
    expect(loadState('npm').matchedKey).toBe('node-npm-outdated');

    await cache.run('save', 'npm');
    expect(saveCacheMock).toHaveBeenCalledWith(inputs?.paths, inputs?.key);
  });

  it('should save without a prior restore', async () => {
    setInputs({ [InputName.Parallel]: 'true' });
    const inputs = await cache.getCacheInputs('npm');
    await cache.run('save', 'npm');
    expect(saveCacheMock).toHaveBeenCalledWith(inputs?.paths, inputs?.key);
  });

  it('should handle cache miss and cache service errors', async () => {
    const infoMock = jest.spyOn(core, 'info');
    const warningMock = jest.spyOn(core, 'warning').mockImplementation();

    await cache.run('restore', 'npm');
    expect(infoMock).toHaveBeenCalledWith(
      expect.stringMatching(/^Cache not found for input keys: npm-/),
    );

    restoreCacheMock.mockRejectedValueOnce(new Error('network error'));
    await cache.run('restore', 'npm');
    expect(warningMock).toHaveBeenCalledWith('network error');

    saveCacheMock.mockRejectedValueOnce(
      new actionsCache.ReserveCacheError('already exists'),
    );
    await cache.run('save', 'npm');
    expect(infoMock).toHaveBeenCalledWith('already exists');

    saveCacheMock.mockRejectedValueOnce(new Error('upload failed'));
    await cache.run('save', 'npm');
    expect(warningMock).toHaveBeenCalledWith('upload failed');
  });

  it('should skip when cache service is not available', async () => {
    const warningMock = jest.spyOn(core, 'warning').mockImplementation();
    isFeatureAvailableMock.mockReturnValue(false);
    await cache.run('restore', 'npm');
    await cache.run('save', 'npm');
    isFeatureAvailableMock.mockReturnValue(true);
    expect(restoreCacheMock).not.toHaveBeenCalled();
    expect(saveCacheMock).not.toHaveBeenCalled();
    expect(warningMock).toHaveBeenCalledTimes(2);
  });

  it('should fail on validation errors', async () => {
    const processExitMock = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);
    const setFailedMock = jest.spyOn(core, 'setFailed');

    restoreCacheMock.mockRejectedValueOnce(
      new actionsCache.ValidationError('bad key'),
    );
    await cache.run('restore', 'npm');
    saveCacheMock.mockRejectedValueOnce(
      new actionsCache.ValidationError('bad path'),
    );
    await cache.run('save', 'npm');

    expect(setFailedMock).toHaveBeenCalledWith('bad key');
    expect(setFailedMock).toHaveBeenCalledWith('bad path');
    expect(processExitMock).toHaveBeenCalledTimes(2);
  });

  it('should exit on invalid args', async () => {
    const processExitMock = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);

    // incomplete arguments
    await cache.run();
    await cache.run('save');

    // bad arguments
    await cache.run('save', 'unknown-cache');
    await cache.run('unknown-action', 'unknown-cache');

    setInputs({ [InputName.Caches]: 'non-existent' });
    await cache.run('save', 'npm');

    expect(processExitMock).toHaveBeenCalledTimes(5);
  });
});

describe('normalizePathForKey', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('should replace runner specific directories', () => {
    process.env.GITHUB_WORKSPACE = '/runner/_work/repo/repo';
    process.env.HOME = '/runner';
    expect(
      cache.normalizePathForKey('/runner/_work/repo/repo/node_modules'),
    ).toBe('$GITHUB_WORKSPACE/node_modules');
    expect(cache.normalizePathForKey('/runner/_work/repo/repo')).toBe(
      '$GITHUB_WORKSPACE',
    );
    expect(cache.normalizePathForKey('/runner/.npm')).toBe('$HOME/.npm');
    expect(cache.normalizePathForKey('/runner2/.npm')).toBe('/runner2/.npm');
    expect(cache.normalizePathForKey('~/.npm')).toBe('$HOME/.npm');
    expect(cache.normalizePathForKey('~')).toBe('$HOME');
    expect(cache.normalizePathForKey('/opt/cache')).toBe('/opt/cache');
  });

  it('should handle Windows paths', () => {
    process.env.GITHUB_WORKSPACE = 'D:\\a\\repo\\repo';
    expect(cache.normalizePathForKey('D:\\a\\repo\\repo\\dist')).toBe(
      '$GITHUB_WORKSPACE/dist',
    );
  });

  it('should generate the same key on different runners', async () => {
    setInputs({ [InputName.Caches]: fixtureCaches });
    await cache.loadCustomCacheConfigs();
    process.env.HOME = '/home/runner';
    const key1 = (await cache.getCacheInputs('npm'))?.key;
    process.env.HOME = '/runner';
    const key2 = (await cache.getCacheInputs('npm'))?.key;
    expect(key1).toBe(key2);
  });
});
