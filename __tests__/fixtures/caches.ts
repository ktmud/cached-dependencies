/**
 * Example cache config.
 */
export const npmHashFiles = ['.*ignore'];

export default {
  npm: {
    path: [`~/.npm`],
    hashFiles: npmHashFiles,
    restoreKeys: 'node-npm-',
  },
};
