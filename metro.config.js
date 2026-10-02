// Cíl aplikace je výhradně iPhone (Expo Go / .ipa) - webový target se
// nepoužívá. `expo-sqlite` ale pro webovou variantu potřebuje .wasm
// (wa-sqlite) a Metro tuhle příponu ve výchozím nastavení nezná, takže
// by `npx expo start --web` spadl na "Unable to resolve module
// ./wa-sqlite/wa-sqlite.wasm". Přidáno jen pro jistotu, kdyby web
// náhled někdy někdo zkusil - na iOS build to nemá žádný vliv.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = config;
