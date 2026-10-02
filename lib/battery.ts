import * as Battery from 'expo-battery';

// Pro ladicí deník (zadání ČÁST B bod 9: "stav baterie u každé"
// události) - nikdy nespadne, jen vrátí null, kdyby se stav baterie
// nedal zjistit (simulator, chvilka po startu apod.).
export async function getBatteryLevelSafe(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? level : null;
  } catch {
    return null;
  }
}
