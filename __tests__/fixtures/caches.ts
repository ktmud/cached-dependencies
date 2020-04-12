/**
 * Example cache config.
 */
export const npmHashFiles = ['.*ignore'];
export const npmExpectedHash =
  '5a6a7167f53dd2805b5400bbcb8c06fd8f490a8969784cc8df510211ba36d135';

export default {
  npm: {
    path: [`${process.env.HOME}/.npm`],
    hashFiles: npmHashFiles,
    restoreKeys: ['npm-', 'node-npm-'],
  },
};
