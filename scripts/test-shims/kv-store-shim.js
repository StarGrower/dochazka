const m = new Map();
exports.default = { getItemSync: (k) => m.get(k) ?? null, setItemSync: (k, v) => m.set(k, v) };
exports.__esModule = true;
