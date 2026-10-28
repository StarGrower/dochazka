// Náhrada nativního modulu pro testy datové vrstvy - chová se jako bez sítě.
exports.default = {
  roadDistance: () => Promise.reject(new Error('offline (test)')),
  scheduleNotification: () => {},
  cancelNotification: () => {},
  getBackupFolder: () => ({ configured: false, accessible: false, name: '', error: '' }),
  getKeyStatus: () => ({ exists: false, synchronizable: false }),
};
exports.__esModule = true;
