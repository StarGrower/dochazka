// Logo "DOCHÁZKA" (varianta W2) - značka DO (helma = D, hodiny = O) +
// text "CHÁZKA" v Barlow Condensed ExtraBold. Geometrie přesně podle
// zadání (viewBox 0 0 400 100), zdroj i v assets/brand/logo.svg.
// Části značky jsou exportované zvlášť - skládá z nich i úvodní
// animace (components/IntroAnimation.tsx).

import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

export const BRAND = {
  yellow: '#F2B705',
  dark: '#131311',
  light: '#F3F1EA',
  // Pivoty animace (souřadnice viewBoxu).
  helmetPivot: { x: 30, y: 50 },
  clockCenter: { x: 72, y: 52 },
  clockRadius: 25,
  textX: 106,
} as const;

export const LOGO_FONT = 'BarlowCondensed_800ExtraBold';

export function HelmetShape() {
  return (
    <G transform="rotate(-12 30 50)">
      <Rect x={12} y={20} width={10} height={60} rx={5} fill={BRAND.yellow} />
      <Path d="M23 22a28 28 0 0 1 0 56z" fill={BRAND.yellow} />
      <Path d="M29 46h13v8H29z" fill={BRAND.dark} opacity={0.25} />
    </G>
  );
}

// Tmavý kruh s okrajem = mezera oddělující O od D (a zakrývá text, který
// v animaci vyjíždí zpoza O).
export function ClockBackground() {
  return <Circle cx={72} cy={52} r={25} fill={BRAND.dark} stroke={BRAND.dark} strokeWidth={12} />;
}

export function ClockRing() {
  return <Circle cx={72} cy={52} r={25} fill="none" stroke={BRAND.yellow} strokeWidth={10} />;
}

export function MinuteHand() {
  return <Path d="M72 52V39" stroke={BRAND.light} strokeWidth={6} strokeLinecap="round" />;
}

export function HourHand() {
  return <Path d="M72 52h10" stroke={BRAND.light} strokeWidth={6} strokeLinecap="round" />;
}

export function WordmarkText() {
  return (
    <SvgText x={106} y={81} fontFamily={LOGO_FONT} fontSize={86} letterSpacing={1} fill={BRAND.light}>
      CHÁZKA
    </SvgText>
  );
}

// Statické logo; `width` v bodech, výška = width / 4.
export default function Logo({ width = 240 }: { width?: number }) {
  return (
    <Svg width={width} height={width / 4} viewBox="0 0 400 100">
      <WordmarkText />
      <HelmetShape />
      <ClockBackground />
      <ClockRing />
      <MinuteHand />
      <HourHand />
    </Svg>
  );
}
