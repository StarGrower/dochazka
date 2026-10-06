// Vlastní zásoba nafty (etapa 6): stav a průměrná cena (vážený průměr
// nákupů), pohyby (nákup / výdej do stroje) a zápis nákupu.

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import { formatKc, formatNumberCs, todayIso } from '@/lib/format';
import { addStockPurchase, fuelStock, listStockMoves } from '@/lib/machines';
import { colors, fonts, fs, radii } from '@/theme';

const parseNum = (t: string) => {
  const v = Number(t.replace(/\s/g, '').replace(',', '.'));
  return t.trim() && Number.isFinite(v) ? v : null;
};
const cz = (iso: string) => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;

type Move = Awaited<ReturnType<typeof listStockMoves>>[number];

export default function FuelStockScreen() {
  const [stock, setStock] = useState({ liters: 0, avgPricePerL: 0 });
  const [moves, setMoves] = useState<Move[]>([]);
  const [liters, setLiters] = useState('');
  const [total, setTotal] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setStock(await fuelStock());
    setMoves(await listStockMoves());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const save = async () => {
    const l = parseNum(liters);
    const t = parseNum(total);
    if (!l || l <= 0 || t === null) {
      Alert.alert('Chybí údaje', 'Zadej litry a cenu nákupu celkem.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('Datum', 'Datum zadej jako RRRR-MM-DD.');
      return;
    }
    await addStockPurchase({ movedAt: new Date(`${date}T12:00:00`).toISOString(), liters: l, priceTotalKc: t, note: note.trim() });
    setLiters('');
    setTotal('');
    setNote('');
    await load();
  };

  const l = parseNum(liters);
  const t = parseNum(total);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="ZÁSOBA NAFTY" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.sc} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.hl}>V ZÁSOBĚ</Text>
          <Text style={styles.hv}>{formatNumberCs(Math.round(stock.liters))} l</Text>
          <Text style={styles.small}>
            průměrná cena {formatNumberCs(Math.round(stock.avgPricePerL * 100) / 100)} Kč/l · hodnota {formatKc(stock.liters * stock.avgPricePerL)}
          </Text>
        </View>

        <Text style={styles.section}>NÁKUP DO ZÁSOBY</Text>
        <View style={styles.row2}>
          <View style={styles.flex}>
            <Text style={styles.label}>Litry</Text>
            <TextInput style={styles.input} value={liters} onChangeText={setLiters} keyboardType="decimal-pad" inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>Celkem Kč</Text>
            <TextInput style={styles.input} value={total} onChangeText={setTotal} keyboardType="decimal-pad" inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          </View>
        </View>
        <View style={styles.row2}>
          <View style={styles.flex}>
            <Text style={styles.label}>Datum</Text>
            <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="RRRR-MM-DD" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>Poznámka</Text>
            <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="dodavatel" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          </View>
        </View>
        {l && t ? <Text style={styles.small}>{formatNumberCs(Math.round((t / l) * 100) / 100)} Kč/l</Text> : null}
        <TouchableOpacity style={styles.cta} onPress={save}>
          <Text style={styles.ctaText}>ZAPSAT NÁKUP</Text>
        </TouchableOpacity>

        <Text style={styles.section}>POHYBY</Text>
        <View style={styles.tb}>
          {moves.length === 0 && <Text style={styles.empty}>Zatím žádné pohyby.</Text>}
          {moves.map((m, i) => (
            <View key={m.id} style={[styles.row, i === 0 && styles.rowFirst]}>
              <View style={styles.flex}>
                <Text style={styles.rowText}>{m.kind === 'purchase' ? 'Nákup' : 'Výdej do stroje'}</Text>
                <Text style={styles.rq}>
                  {cz(m.movedAt.slice(0, 10))}
                  {m.note ? ` · ${m.note}` : ''}
                </Text>
              </View>
              <Text style={[styles.rv, m.kind === 'issue' && styles.issue]}>
                {m.kind === 'purchase' ? '+' : '−'}
                {formatNumberCs(m.liters)} l
              </Text>
              {m.priceTotalKc !== null && <Text style={styles.rq}>{formatKc(m.priceTotalKc)}</Text>}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  sc: { paddingHorizontal: 16, gap: 10, paddingBottom: 40 },
  hero: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  hl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), letterSpacing: 0.72 },
  hv: { color: colors.accent, fontFamily: 'BarlowCondensed_800ExtraBold', fontSize: fs(40), lineHeight: fs(42) },
  small: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  section: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1.1, marginTop: 6 },
  label: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.card },
  row2: { flexDirection: 'row', gap: 8 },
  cta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18), letterSpacing: 0.9 },
  tb: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 2, paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: 1, borderTopColor: colors.border, gap: 10, paddingVertical: 4 },
  rowFirst: { borderTopWidth: 0 },
  rowText: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14) },
  rq: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  rv: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16) },
  issue: { color: colors.textMuted },
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), paddingVertical: 10 },
});
