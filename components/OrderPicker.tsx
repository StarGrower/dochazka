// Výběr zakázky u položky práce / přejezdu (etapa 5 - ruční přeřazení).
// value: null = automaticky, -1 = bez zakázky, jinak id zakázky.

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

export interface OrderOption {
  id: number;
  name: string;
}

export default function OrderPicker({
  orders,
  value,
  onChange,
  locked,
}: {
  orders: OrderOption[];
  value: number | null;
  onChange: (v: number | null) => void;
  locked: boolean; // vyfakturováno - už nejde měnit
}) {
  if (orders.length === 0) return null;
  const name = orders.find((o) => o.id === value)?.name;
  if (locked) {
    return <Text style={styles.locked}>Zakázka: {name ?? 'bez zakázky'} · vyfakturováno, nejde změnit</Text>;
  }
  const options: { id: number | null; label: string }[] = [
    { id: null, label: 'Automaticky' },
    ...orders.map((o) => ({ id: o.id, label: o.name })),
    { id: -1, label: 'Bez zakázky' },
  ];
  return (
    <View>
      <Text style={styles.label}>ZAKÁZKA</Text>
      <View style={styles.chips}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <TouchableOpacity key={String(o.id)} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(o.id)}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(12), letterSpacing: 1, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  chipTextOn: { color: colors.onAccent },
  locked: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 10 },
});
