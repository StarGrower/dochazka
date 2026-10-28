// Písma Barlow / Barlow Condensed vložená do HTML faktury (@font-face s
// base64) - PDF i náhled vypadají jako předloha i bez internetu. Soubory
// jsou ty samé, které appka načítá při startu (@expo-google-fonts).
// Když se načtení nepovede, HTML spadne na systémové písmo.

import { Barlow_400Regular, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

const FONTS: { family: string; weight: number; module: number }[] = [
  { family: 'Barlow', weight: 400, module: Barlow_400Regular },
  { family: 'Barlow', weight: 600, module: Barlow_600SemiBold },
  { family: 'Barlow', weight: 700, module: Barlow_700Bold },
  { family: 'Barlow Condensed', weight: 700, module: BarlowCondensed_700Bold },
  { family: 'Barlow Condensed', weight: 800, module: BarlowCondensed_800ExtraBold },
];

let cached: Promise<string> | null = null;

async function load(): Promise<string> {
  const faces: string[] = [];
  for (const f of FONTS) {
    try {
      const asset = Asset.fromModule(f.module);
      await asset.downloadAsync();
      if (!asset.localUri) continue;
      const b64 = await new File(asset.localUri).base64();
      faces.push(`@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;src:url(data:font/ttf;base64,${b64}) format('truetype')}`);
    } catch {
      // bez tohoto řezu - náhradní písmo
    }
  }
  return faces.join('\n');
}

export function invoiceFontsCss(): Promise<string> {
  if (!cached) cached = load().catch(() => '');
  return cached;
}
