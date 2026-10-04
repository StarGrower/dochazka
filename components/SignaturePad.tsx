// Podpis prstem (etapa 4.4) - kreslení přes react-native-gesture-handler
// do SVG cesty (viewBox 0 0 300 100), bez další knihovny. Výsledná cesta
// se vloží do PDF výkazu.

import { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

import { colors, fonts, fs, radii } from '@/theme';

const VIEW_W = 300;
const VIEW_H = 100;

export default function SignaturePad({ onChange }: { onChange: (path: string | null) => void }) {
  const [path, setPath] = useState('');
  const size = useRef({ width: 1, height: 1 });

  const toView = (x: number, y: number) =>
    `${((x / size.current.width) * VIEW_W).toFixed(1)} ${((y / size.current.height) * VIEW_H).toFixed(1)}`;

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      setPath((p) => `${p} M${toView(e.x, e.y)}`);
    })
    .onUpdate((e) => {
      setPath((p) => `${p} L${toView(e.x, e.y)}`);
    })
    .onFinalize(() => {
      setPath((p) => {
        onChange(p.trim() || null);
        return p;
      });
    });

  const onLayout = (e: LayoutChangeEvent) => {
    size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
  };

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View style={styles.pad} onLayout={onLayout}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
            <Path d={path || 'M0 0'} fill="none" stroke={colors.text} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          {!path && <Text style={styles.placeholder}>Podepiš se prstem</Text>}
        </View>
      </GestureDetector>
      {!!path && (
        <TouchableOpacity
          onPress={() => {
            setPath('');
            onChange(null);
          }}
          hitSlop={8}
        >
          <Text style={styles.clear}>Smazat podpis</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { height: 120, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' },
  placeholder: { position: 'absolute', alignSelf: 'center', top: 50, color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  clear: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13), marginTop: 6, textAlign: 'right' },
});
