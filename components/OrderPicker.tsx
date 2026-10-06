// Výběr zakázky u položky práce / přejezdu (etapa 5 - ruční přeřazení).
// value: null = automaticky podle místa, -1 = ručně bez zakázky, jinak
// ručně vybraná zakázka (migrace v7 order_manual - automatika ji nemění).
// Zobrazuje se vždy - i u položky bez místa a bez založených zakázek.

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
  autoName,
}: {
  orders: OrderOption[];
  value: number | null;
  onChange: (v: number | null) => void;
  locked: boolean; // vyfakturováno - nejde přeřadit
  autoName?: string | null; // kam by položka spadla automaticky (null = nikam)
}) {
  const name = orders.find((o) => o.id === value)?.name;
  if (locked) {
    return (
      <View>
        <Text style={styles.label}>ZAKÁZKA</Text>
        <Text style={styles.locked}>{name ?? autoName ?? 'bez zakázky'} · vyfakturováno - přeřadit nejde (nejdřív zruš podklad k faktuře)</Text>
      </View>
    );
  }
  const options: { id: number | null; label: string }[] = [
    { id: null, label: `Automaticky podle místa${autoName ? ` → ${autoName}` : ' (žádná)'}` },
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
      {orders.length === 0 && <Text style={styles.locked}>Zatím žádné zakázky - založíš je v záložce Zakázky.</Text>}
      {value !== null && <Text style={styles.locked}>Ruční volba - změna míst zakázky ji nezmění.</Text>}
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
  locked: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 8 },
});
