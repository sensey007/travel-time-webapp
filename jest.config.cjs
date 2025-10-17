module.exports = {
  testEnvironment: 'node',
  // Rely on package.json "type": "module" and NODE_OPTIONS=--experimental-vm-modules for ESM support
  transform: {},
  roots: ['<rootDir>/tests']
};
