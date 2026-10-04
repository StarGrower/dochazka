// Úvodní animace po spuštění appky (~2,5 s, jednou) - etapa 3, zadání
// "IKONA, LOGO A ÚVODNÍ ANIMACE" bod 3:
//   0,0-0,8 s  helma naskočí (rotate -35°, scale 0,5, průhledná -> přešvih +5°/1,06 -> klid)
//   0,4-1,1 s  žlutý kruh O se dokreslí (strokeDashoffset 158 -> 0, od vrchu)
//   0,6-2,1 s  ručičky se roztočí a dobrzdí (minutová 3 otáčky, hodinová ¾)
//   1,1-2,5 s  "CHÁZKA" vyjede zpoza O (translateX -56 -> 0 + odkrývání zleva)
//   pak krátké podržení a fade do appky.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - části loga jsou samostatné vrstvy (každá
// vlastní <Svg> přes celou plochu loga) a hýbe se jimi přes Animated.View
// s transformOrigin v bodě pivotu (helma 30/50, hodiny 72/52). Animovat
// `transform` přímo uvnitř SVG přes Reanimated nejde spolehlivě
// (react-native-svg ho zpracovává v JS); číselný strokeDashoffset kruhu
// ano - ten jde přes useAnimatedProps.
//
// Data (DB, migrace) se načítají souběžně: fade začne, až doběhne animace
// A ZÁROVEŇ je appka připravená (`ready`) - když načítání trvá déle, logo
// počká. Při "Omezit pohyb" (iOS Reduce Motion) jen statické logo a fade.

import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import Logo, {
  BRAND,
  ClockBackground,
  HelmetShape,
  HourHand,
  MinuteHand,
  WordmarkText,
} from './Logo';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING_LENGTH = 158; // 2π·25 ≈ 157,1 - zadání: 158 -> 0
const ANIMATION_MS = 2500;
const HOLD_MS = 300;
const FADE_MS = 350;
const REDUCED_HOLD_MS = 700;

interface IntroAnimationProps {
  ready: boolean; // appka (DB, fonty) je připravená
  onFinish: () => void; // po fade - odpojit animaci
}

const out = Easing.out(Easing.cubic);

export default function IntroAnimation({ ready, onFinish }: IntroAnimationProps) {
  const reducedMotion = useReducedMotion();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth * 0.78, 360);
  const height = width / 4;
  const unit = width / 400; // 1 jednotka viewBoxu v bodech

  const helmetRotate = useSharedValue(-35);
  const helmetScale = useSharedValue(0.5);
  const helmetOpacity = useSharedValue(0);
  const ringOffset = useSharedValue(RING_LENGTH);
  const minuteRotate = useSharedValue(-3 * 360);
  const hourRotate = useSharedValue(-270);
  const textShift = useSharedValue(-56);
  const textReveal = useSharedValue(0); // 0-1, maska zleva doprava
  const screenOpacity = useSharedValue(1);

  const [animationDone, setAnimationDone] = useState(false);

  useEffect(() => {
    if (reducedMotion) {
      const timer = setTimeout(() => setAnimationDone(true), REDUCED_HOLD_MS);
      return () => clearTimeout(timer);
    }
    helmetOpacity.value = withTiming(1, { duration: 350 });
    helmetRotate.value = withSequence(withTiming(5, { duration: 550, easing: out }), withTiming(0, { duration: 250 }));
    helmetScale.value = withSequence(withTiming(1.06, { duration: 550, easing: out }), withTiming(1, { duration: 250 }));
    ringOffset.value = withDelay(400, withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) }));
    minuteRotate.value = withDelay(600, withTiming(0, { duration: 1500, easing: Easing.out(Easing.exp) }));
    hourRotate.value = withDelay(600, withTiming(0, { duration: 1500, easing: Easing.out(Easing.exp) }));
    textShift.value = withDelay(1100, withTiming(0, { duration: 1400, easing: out }));
    textReveal.value = withDelay(1100, withTiming(1, { duration: 1400, easing: out }));
    const timer = setTimeout(() => setAnimationDone(true), ANIMATION_MS + HOLD_MS);
    return () => clearTimeout(timer);
  }, [reducedMotion, helmetOpacity, helmetRotate, helmetScale, ringOffset, minuteRotate, hourRotate, textShift, textReveal]);

  useEffect(() => {
    if (!animationDone || !ready) return;
    screenOpacity.value = withTiming(0, { duration: FADE_MS }, (finished) => {
      if (finished) runOnJS(onFinish)();
    });
  }, [animationDone, ready, screenOpacity, onFinish]);

  const screenStyle = useAnimatedStyle(() => ({ opacity: screenOpacity.value }));
  const helmetStyle = useAnimatedStyle(() => ({
    opacity: helmetOpacity.value,
    transform: [{ rotate: `${helmetRotate.value}deg` }, { scale: helmetScale.value }],
  }));
  const minuteStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${minuteRotate.value}deg` }] }));
  const hourStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${hourRotate.value}deg` }] }));
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: ringOffset.value }));
  // Text vyjíždí zpoza O: ořezové okno začíná ve středu hodin a roste
  // doprava, text v něm se posouvá z -56 na 0.
  const clipLeft = BRAND.clockCenter.x * unit;
  const clipStyle = useAnimatedStyle(() => ({ width: (width - clipLeft) * textReveal.value }));
  const textStyle = useAnimatedStyle(() => ({ transform: [{ translateX: textShift.value * unit }] }));

  const helmetOrigin = `${(BRAND.helmetPivot.x / 400) * 100}% ${(BRAND.helmetPivot.y / 100) * 100}%`;
  const clockOrigin = `${(BRAND.clockCenter.x / 400) * 100}% ${(BRAND.clockCenter.y / 100) * 100}%`;
  const layer = { position: 'absolute' as const, left: 0, top: 0, width, height };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.screen, screenStyle]} pointerEvents="none">
      {reducedMotion ? (
        <Logo width={width} />
      ) : (
        <View style={{ width, height }}>
          <Animated.View style={[styles.clip, { left: clipLeft, height }, clipStyle]}>
            <Animated.View style={[{ position: 'absolute', left: -clipLeft, top: 0, width, height }, textStyle]}>
              <Svg width={width} height={height} viewBox="0 0 400 100">
                <WordmarkText />
              </Svg>
            </Animated.View>
          </Animated.View>
          <Animated.View style={[layer, { transformOrigin: helmetOrigin }, helmetStyle]}>
            <Svg width={width} height={height} viewBox="0 0 400 100">
              <HelmetShape />
            </Svg>
          </Animated.View>
          <View style={layer}>
            <Svg width={width} height={height} viewBox="0 0 400 100">
              <ClockBackground />
              {/* Začátek kresby nahoře: kruh otočený o -90° kolem středu. */}
              <AnimatedCircle
                cx={72}
                cy={52}
                r={25}
                fill="none"
                stroke={BRAND.yellow}
                strokeWidth={10}
                strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
                transform="rotate(-90 72 52)"
                animatedProps={ringProps}
              />
            </Svg>
          </View>
          <Animated.View style={[layer, { transformOrigin: clockOrigin }, minuteStyle]}>
            <Svg width={width} height={height} viewBox="0 0 400 100">
              <MinuteHand />
            </Svg>
          </Animated.View>
          <Animated.View style={[layer, { transformOrigin: clockOrigin }, hourStyle]}>
            <Svg width={width} height={height} viewBox="0 0 400 100">
              <HourHand />
            </Svg>
          </Animated.View>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: BRAND.dark, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
});
