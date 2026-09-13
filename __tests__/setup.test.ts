/**
 * Test default runner.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import * as core from '@actions/core';
import { setInputs } from '../src/utils/inputs.js';
import { InputName, DefaultInputs } from '../src/constants.js';
import * as setup from '../src/setup.js';

vi.mock('@actions/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@actions/core')>()),
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  setFailed: vi.fn(),
}));

const extraBashlib = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  './fixtures/bashlib.sh',
);

describe('toBashPath', () => {
  it('should convert Windows paths to forward slashes', () => {
    expect(setup.toBashPath('D:\\a\\_actions\\v1\\src\\bashlib.sh')).toBe(
      'D:/a/_actions/v1/src/bashlib.sh',
    );
    expect(setup.toBashPath('/home/runner/work/bashlib.sh')).toBe(
      '/home/runner/work/bashlib.sh',
    );
  });
});

describe('setup runner', () => {
  it('should run the bashlib with the default command', async () => {
    const stdout: string[] = [];
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(chunk => {
        stdout.push(String(chunk));
        return true;
      });
    setInputs({
      [InputName.Bashlib]: extraBashlib,
      [InputName.Parallel]: '',
      [InputName.Run]: '',
    });
    await setup.run();
    stdoutWrite.mockRestore();
    // the fixture bashlib prints the cache script path
    expect(setup.toBashPath(stdout.join(''))).toContain(
      'dist/scripts/cache/index.js',
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('should allow inline bash overrides', async () => {
    const processExitMock = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as never);

    setInputs({
      [InputName.Bashlib]: '',
      [InputName.Parallel]: 'false',
      [InputName.Run]: `
        ${DefaultInputs[InputName.Run]}() {
          echo "It works!"
          exit 202
        }
        ${DefaultInputs[InputName.Run]}
      `,
    });
    await setup.run();
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('exit code 202'),
    );
    expect(processExitMock).toHaveBeenCalledTimes(1);
    expect(processExitMock).toHaveBeenCalledWith(1);
  });

  it('should use run commands', async () => {
    const runner = vi.fn(async () => {});
    setInputs({
      [InputName.Bashlib]: 'non-existent',
      [InputName.Parallel]: '',
      [InputName.Run]: 'print-cachescript-path',
    });

    await setup.run(runner);

    expect(core.error).toHaveBeenCalledWith(
      'Custom bashlib "non-existent" does not exist.',
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith('print-cachescript-path', '');
  });

  it('should handle single-new-line parallel commands', async () => {
    const runner = vi.fn(async () => {});
    setInputs({
      [InputName.Bashlib]: 'non-existent',
      [InputName.Run]: `
        test-command-1
        test-command-2
      `,
      [InputName.Parallel]: 'true',
    });

    await setup.run(runner);

    expect(runner).toHaveBeenNthCalledWith(1, 'test-command-1', '');
    expect(runner).toHaveBeenNthCalledWith(2, 'test-command-2', '');
  });

  it('should handle multi-new-line parallel commands', async () => {
    const runner = vi.fn(async () => {});
    setInputs({
      [InputName.Bashlib]: 'non-existent',
      [InputName.Run]: `
        test-1-1
        test-1-2

        test-2
      `,
      [InputName.Parallel]: 'true',
    });

    await setup.run(runner);

    expect(runner).toHaveBeenNthCalledWith(1, 'test-1-1\n        test-1-2', '');
    expect(runner).toHaveBeenNthCalledWith(2, 'test-2', '');
  });
});
