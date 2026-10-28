// Spuštění testu faktur nad skutečnou SQLite (node:sqlite): npm run test:invoice-db
// lib/*.ts zkompilované do node_modules/.cache, expo-sqlite a nativní modul
// nahrazené shimy ze scripts/test-shims.
const Module = require('module');
const path = require('path');
const out = path.join(__dirname, '..', 'node_modules', '.cache', 'dochazka-invoice-db');
const shims = path.join(__dirname, 'test-shims');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'expo-sqlite') return path.join(shims, 'expo-sqlite-shim.js');
  if (request === 'expo-sqlite/kv-store') return path.join(shims, 'kv-store-shim.js');
  if (request.endsWith('dochazka-native/src/DochazkaNative')) return path.join(shims, 'dochazka-native-shim.js');
  if (request.startsWith('@/')) return origResolve.call(this, path.join(out, request.slice(2)), ...rest);
  return origResolve.call(this, request, ...rest);
};
require(path.join(out, 'scripts', 'test-invoice-db.js'));
