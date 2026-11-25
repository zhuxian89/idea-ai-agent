// Shared locations for the refactoring tools. Nothing here may point outside the repository.
const path = require('path');
const repoRoot = path.resolve(__dirname, '../../..');
const webRoot = path.join(repoRoot, 'runtime/web');
let ts;
try { ts = require(path.join(webRoot, 'node_modules/typescript')); }
catch { throw new Error('Install frontend dependencies first: cd runtime/web && corepack pnpm install --frozen-lockfile'); }
module.exports = { repoRoot, webRoot, ts };
