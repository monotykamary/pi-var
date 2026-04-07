/**
 * Extension configuration
 */

export const DEFAULT_CONFIG = {
  copy: [
    '.env',
    '.env.*',
    '.envrc',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    '.tool-versions',
    '.node-version',
    '.python-version',
    'docker-compose.override.yml',
  ],
  symlink: [
    'node_modules',
    '.next',
    '.nuxt',
    '.angular',
    '.turbo',
    'target',
    '.venv',
    'venv',
    'vendor',
  ],
  postCreate: [],
};
