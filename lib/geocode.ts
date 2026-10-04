// Nejbližší obec k souřadnicím (oprava 2, F1/F2) - reverzní geokódování
// přes Apple (expo-location -> reverseGeocodeAsync, zdarma).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - nedohledává se při záznamu polohy (baterie,
// na pozadí často bez sítě), ale až při ZOBRAZENÍ (ladicí deník, průběh
// dne) a exportu. Výsledky se cachují v DB podle souřadnic zaokrouhlených
// na 3 desetinná místa (~100 m). Bez internetu zůstanou jen souřadnice a
// obec se doplní při dalším otevření (chyba se necachuje).

import * as Location from 'expo-location';

import { getGeocodeCache, putGeocodeCache } from './db';

export function geocodeKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

// Apple geokodér má limit na počet dotazů - jedno otevření obrazovky
// dohledá nejvýš tolik nových míst (zbytek při dalším otevření).
const MAX_LOOKUPS_PER_CALL = 25;

let inFlight: Promise<unknown> = Promise.resolve();

// Vrátí mapu klíč -> název obce pro zadané body (z cache + nově dohledané).
export function resolveLocalities(points: Array<{ latitude: number; longitude: number }>): Promise<Map<string, string>> {
  // Jedno dohledávání najednou - dvě obrazovky by jinak dotazy zdvojily.
  const run = inFlight.then(async () => {
    const unique = new Map<string, { latitude: number; longitude: number }>();
    for (const p of points) unique.set(geocodeKey(p.latitude, p.longitude), p);
    const result = await getGeocodeCache([...unique.keys()]);

    let lookups = 0;
    for (const [key, p] of unique) {
      if (result.has(key) || lookups >= MAX_LOOKUPS_PER_CALL) continue;
      lookups++;
      try {
        const [address] = await Location.reverseGeocodeAsync({ latitude: p.latitude, longitude: p.longitude });
        const locality = address?.city ?? address?.district ?? address?.subregion ?? null;
        if (locality) {
          result.set(key, locality);
          await putGeocodeCache(key, locality);
        }
      } catch {
        break; // typicky bez sítě nebo limit - zkusí se příště
      }
    }
    return result;
  });
  inFlight = run.catch(() => {});
  return run;
}

// "u Tábora", "u Plzně", "u Kolína" - 2. pád podle nejčastějších
// koncovek českých obcí. Víceslovné názvy a nejasné koncovky se
// neskloňují ("· Karlovy Vary") - raději správně než legračně.
export function nearLocalityLabel(locality: string): string {
  const name = locality.trim();
  if (name.includes(' ') || name.includes('-')) return name;
  const rules: Array<[RegExp, string]> = [
    [/ice$/, 'ic'],
    [/any$/, 'an'],
    [/ov$/, 'ova'],
    [/ín$/, 'ína'],
    [/ýn$/, 'ýna'],
    [/in$/, 'ina'],
    [/ek$/, 'ku'],
    [/ec$/, 'ce'],
    [/eň$/, 'ně'],
    [/ň$/, 'ně'],
    [/o$/, 'a'],
    [/([kghrdtnbmpvlsz])a$/, '$1y'],
    [/([cjžščřď])a$/, '$1e'],
    [/([bdfhkmnprtvz])$/, '$1a'],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(name)) return `u ${name.replace(pattern, replacement)}`;
  }
  return name;
}
