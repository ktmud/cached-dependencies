import path from 'path';
import * as cache from '../src/cache';
import * as inputsUtils from '../src/utils/inputs';
import { setInputs } from '../src/utils/inputs';
import { InputName, GitHubEvent, EnvVariable } from '../src/constants';
import caches, { npmHashFiles, npmExpectedHash } from './fixtures/caches';

describe('cache runner', () => {
  it('hash files', async () => {
    const hash = await cache.hashFiles(npmHashFiles);
    expect(hash).toStrictEqual(npmExpectedHash);
  });

  it('should use default cache config', async () => {
    // when caches is empty, will read from `DefaultInputs.Caches`
    await cache.loadCustomCacheConfigs();
    // but `npm` actually come from `src/cache/caches.ts`
    const inputs = await cache.getCacheInputs('npm');
    expect(inputs?.[InputName.RestoreKeys]).toStrictEqual('npm-');
  });

  it('should override cache config', async () => {
    setInputs({
      [InputName.Caches]: path.resolve(__dirname, 'fixtures/caches'),
    });

    await cache.loadCustomCacheConfigs();

    const inputs = await cache.getCacheInputs('npm');
    expect(inputs?.[InputName.RestoreKeys]).toStrictEqual(
      caches.npm.restoreKeys.join('\n'),
    );
    expect(inputs?.[InputName.Key]).toStrictEqual(`npm-${npmExpectedHash}`);
  });

  it('should apply inputs', async () => {
    setInputs({
      [InputName.Caches]: path.resolve(__dirname, 'fixtures/caches'),
      [EnvVariable.GitHubEventName]: GitHubEvent.PullRequest,
    });

    const setInputsMock = jest.spyOn(inputsUtils, 'setInputs');
    const inputs = await cache.getCacheInputs('npm');
    const result = await cache.run('restore', 'npm');

    expect(result).toBeUndefined();

    // before run
    expect(setInputsMock).toHaveBeenNthCalledWith(1, inputs);

    // after run
    expect(setInputsMock).toHaveBeenNthCalledWith(2, {
      [InputName.Key]: '',
      [InputName.Path]: '',
      [InputName.RestoreKeys]: '',
    });

    setInputsMock.mockRestore();

    // call to save should also work
    await cache.run('save', 'npm');
  });

  it('should exit on invalid args', async () => {
    // other calls do not generate errors
    const mockExit = jest
      .spyOn(process, 'exit')
      // @ts-ignore
      .mockImplementation(() => {});

    // incomplete arguments
    await cache.run();
    await cache.run('save');

    // bad arguments
    await cache.run('save', 'unknown-cache');
    await cache.run('unknown-action', 'unknown-cache');

    setInputs({
      [InputName.Caches]: 'non-existent',
    });
    await cache.run('save', 'npm');

    expect(mockExit).toHaveBeenCalledTimes(5);
  });
});
