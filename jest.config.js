module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '__tests__/tsconfig.json' }],
  },
  verbose: true,
};

// suppress debug messages
const processStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, cb) => {
  processStdoutWrite(
    String(chunk)
      .split('\n')
      .filter(x => {
        return !/^::debug::/.test(x);
      })
      .join('\n'),
    encoding,
    cb,
  );
};
