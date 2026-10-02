// Hmatová odezva (zadání "Aplikace -> hmatová odezva při klepnutí
// zap/vyp") - tenký wrapper, ať volající nemusí řešit import
// expo-haptics a kontrolu nastavení zvlášť. Zatím zapojeno na hlavních
// interakcích zápisu dne (NumPad, uložení) - viz POZNAMKY.md.

import * as Haptics from 'expo-haptics';

export function tapHaptic(enabled: boolean): void {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
