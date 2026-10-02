// Jediný zdroj barev/písem/rozměrů pro CELOU appku (vizuální směr "A ·
// Stavba") - v komponentách se nemá objevit žádná barva napevno, vždy
// přes tenhle soubor. Appka je VŽDY tmavá (viz app.json
// "userInterfaceStyle": "dark") - žádné světlé varianty barev tu proto
// nejsou, na rozdíl od dřívějšího components/Themed.tsx (smazáno).

export const colors = {
  background: '#131311',
  card: '#1E1E1B',
  border: '#2C2C28',
  text: '#F3F1EA',
  textMuted: '#A39F93',
  accent: '#F2B705',
  onAccent: '#131311', // text/ikony NA žlutém pozadí
  danger: '#E5484D',
} as const;

// Barvy pro rozlišení kategorií prací/strojů (viz lib/db.ts ->
// WorkCategory.color, components/ColorPicker.tsx) - 16 barev, mřížka
// 8×2 (zadání ČÁST 2), vybrané tak, aby byly dobře rozlišitelné na
// tmavém pozadí #131311 (střední až vysoký jas/sytost). Výchozí se
// cyklicky přiřadí nově vytvořeným kategoriím.
export const categoryPalette = [
  '#F2B705', '#E07A2F', '#D9574A', '#E0616B',
  '#C062D9', '#8C6FE0', '#5C7CE0', '#3E9BDE',
  '#2FB6A3', '#4CAF78', '#8BC34A', '#C9A227',
  '#8A6D4B', '#B9B39F', '#7D8A99', '#E0609E',
] as const;

export function paletteColorAt(index: number): string {
  return categoryPalette[((index % categoryPalette.length) + categoryPalette.length) % categoryPalette.length];
}

export const fonts = {
  // Barlow Condensed Bold - nadpisy, název měsíce, VŠECHNA čísla
  // (hodiny, km, Kč).
  headingBold: 'BarlowCondensed_700Bold',
  // Barlow Regular/SemiBold - běžný text.
  body: 'Barlow_400Regular',
  bodySemiBold: 'Barlow_600SemiBold',
} as const;

export const radii = {
  card: 6,
  calendarDay: 4,
} as const;

// Minimální dotyková plocha (iOS HIG) - viz zadání "dotykové plochy min. 44 px".
export const MIN_TOUCH = 44;
