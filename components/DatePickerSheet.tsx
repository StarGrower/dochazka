// Výběr data (okno zespodu) - měsíční mřížka Po-Ne, šipky po měsících.
// Dny před `minIso` jsou tlumené a nejdou vybrat (např. splatnost před
// datem vystavení). Bez nativní knihovny - stačí na jeden den.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import BottomSheetModal from './BottomSheetModal';
import { monthLabel, weekdayShort } from '@/lib/format';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

interface DatePickerSheetProps {
  visible: boolean;
  title: string;
  valueIso: string; // YYYY-MM-DD
  minIso?: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default function DatePickerSheet({ visible, title, valueIso, minIso, onSelect, onClose }: DatePickerSheetProps) {
  const [ym, setYm] = useState(() => ({ y: Number(valueIso.slice(0, 4)), m: Number(valueIso.slice(5, 7)) }));

  // Při otevření začít na měsíci zvoleného data.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visible) setYm({ y: Number(valueIso.slice(0, 4)), m: Number(valueIso.slice(5, 7)) });
  }, [visible, valueIso]);

  const shift = (delta: number) =>
    setYm(({ y, m }) => {
      const d = new Date(y, m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });

  const leading = (new Date(ym.y, ym.m - 1, 1).getDay() + 6) % 7; // Po = 0
  const days = new Date(ym.y, ym.m, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(leading).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.arrow} onPress={() => shift(-1)} accessibilityLabel="Předchozí měsíc">
          <Text style={styles.arrowText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.month}>{monthLabel(ym.y, ym.m).toUpperCase()}</Text>
        <TouchableOpacity style={styles.arrow} onPress={() => shift(1)} accessibilityLabel="Další měsíc">
          <Text style={styles.arrowText}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.grid}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <Text key={`h${i}`} style={styles.head}>
            {weekdayShort(i)}
          </Text>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <View key={`e${i}`} style={styles.cell} />;
          const value = iso(ym.y, ym.m, d);
          const disabled = !!minIso && value < minIso;
          const on = value === valueIso;
          return (
            <TouchableOpacity key={value} style={[styles.cell, on && styles.cellOn]} disabled={disabled} onPress={() => onSelect(value)}>
              <Text style={[styles.day, disabled && styles.dayOff, on && styles.dayOn]}>{d}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1, marginBottom: 8 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  arrow: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.text, fontSize: fs(26), fontFamily: fonts.body },
  month: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(17), letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  head: { width: `${100 / 7}%`, textAlign: 'center', color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), paddingVertical: 6 },
  cell: { width: `${100 / 7}%`, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radii.card },
  cellOn: { backgroundColor: colors.accent },
  day: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  dayOff: { color: colors.textMuted, opacity: 0.4 },
  dayOn: { color: colors.onAccent },
});
