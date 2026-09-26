// The app shares the tiny mayor (three.js) and the report types with the web app one folder up.
// Metro watches just those folders, and every `three` import resolves to this app's copy so the
// shared scene code and the GL renderer agree on one THREE.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);

config.watchFolders = [path.join(root, 'lib'), path.join(root, 'components', 'mayor')];
// Mamdani's generated models (scripts/bake-mamdani.ts) ship as binary assets
config.resolver.assetExts.push('mrig');

const here = path.join(__dirname, 'index.ts');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (!context.originModulePath.startsWith(__dirname) && !name.startsWith('.')) {
    // bare imports from shared files (three, …) come from mobile/node_modules
    return resolve({ ...context, originModulePath: here }, name, platform);
  }
  return resolve(context, name, platform);
};

module.exports = config;
