// Záložka Zakázky (etapa 5) - seznam podle předlohy
// private/predloha-zakazky.html ("SEZNAM ZAKÁZEK"): souhrn nevyfakturováno
// / čeká na platbu, filtry Vše / Běží / K fakturaci / Hotové, řazení,
// karty s částkou, stavem a rozpočtem.

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import OrderBadge, { INVOICED_BLUE } from '@/components/OrderBadge';
import { formatKc, monthLabel } from '@/lib/format';
import { listOrderSummaries, type OrderSummary } from '@/lib/orders';
import { BUDGET_WARN_PCT } from '@/lib/orderStats';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type Filter = 'all' | 'running' | 'billing' | 'finished';
type Sort = 'unbilled' | 'name' | 'newest';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Vše' },
  { key: 'running', label: 'Běží' },
  { key: 'billing', label: 'K fakturaci' },
  { key: 'finished', label: 'Hotové' },
];
const SORTS: { key: Sort; label: string }[] = [
  { key: 'unbilled', label: 'Nevyfakturováno' },
  { key: 'name', label: 'Název' },
  { key: 'newest', label: 'Nejnovější' },
];

export default function ZakazkyScreen() {
  const [items, setItems] = useState<OrderSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('unbilled');

  const load = useCallback(async () => {
    setItems(await listOrderSummaries());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const totals = useMemo(
    () => ({
      unbilled: (items ?? []).reduce((s, i) => s + i.unbilledKc, 0),
      awaiting: (items ?? []).reduce((s, i) => s + i.awaitingPaymentKc, 0),
    }),
    [items]
  );

  const visible = useMemo(() => {
    const list = (items ?? []).filter((i) => {
      const st = i.order.status;
      if (filter === 'running') return st === 'running' || st === 'preparing';
      if (filter === 'billing') return i.unbilledKc > 0.5 && st !== 'paid';
      if (filter === 'finished') return st === 'invoiced' || st === 'paid';
      return true;
    });
    return [...list].sort((a, b) =>
      sort === 'name' ? a.order.name.localeCompare(b.order.name, 'cs') : sort === 'newest' ? b.order.id - a.order.id : b.unbilledKc - a.unbilledKc
    );
  }, [items, filter, sort]);

  const now = new Date();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.top}>
        <View>
          <Text style={styles.h1}>ZAKÁZKY</Text>
          <Text style={styles.sub}>{monthLabel(now.getFullYear(), now.getMonth() + 1)}</Text>
        </View>
        <TouchableOpacity style={styles.ib} onPress={() => router.push('/order/edit')} accessibilityLabel="Nová zakázka">
          <Text style={styles.plus}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.kp}>
        <View style={styles.k}>
          <Text style={[styles.kv, styles.y]}>{formatKc(totals.unbilled)}</Text>
          <Text style={styles.kl}>NEVYFAKTUROVÁNO</Text>
        </View>
        <View style={styles.k}>
          <Text style={styles.kv}>{formatKc(totals.awaiting)}</Text>
          <Text style={styles.kl}>ČEKÁ NA PLATBU</Text>
        </View>
      </View>

      <View style={styles.flt}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f.key} style={[styles.fc, filter === f.key && styles.on]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.fcText, filter === f.key && styles.onText]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.lst}>
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Řadit:</Text>
          {SORTS.map((s) => (
            <TouchableOpacity key={s.key} onPress={() => setSort(s.key)} hitSlop={8}>
              <Text style={[styles.sortItem, sort === s.key && styles.sortOn]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {items === null && <ActivityIndicator color={colors.accent} style={styles.loading} />}
        {items !== null && visible.length === 0 && (
          <Text style={styles.empty}>
            {items.length === 0 ? 'Zatím žádné zakázky. Založ první tlačítkem +.' : 'V tomhle filtru nic není.'}
          </Text>
        )}
        {visible.map((i) => {
          const awaiting = i.unbilledKc < 0.5 && i.awaitingPaymentKc > 0;
          return (
            <TouchableOpacity key={i.order.id} style={styles.it} onPress={() => router.push(`/order/${i.order.id}`)}>
              <View style={styles.r1}>
                <View style={styles.nameBlock}>
                  <Text style={styles.nm}>{i.order.name}</Text>
                  <Text style={styles.od}>
                    {[i.order.clientName, `${i.placeCount} ${i.placeCount === 1 ? 'místo' : i.placeCount < 5 ? 'místa' : 'míst'}`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View>
                  <Text style={[styles.am, awaiting && styles.amBlue]}>{formatKc(awaiting ? i.awaitingPaymentKc : i.unbilledKc)}</Text>
                  <Text style={styles.amLabel}>{awaiting ? 'NEZAPLACENO' : 'NEVYFAKT.'}</Text>
                </View>
              </View>
              <OrderBadge status={i.order.status} />
              {i.order.budgetKc !== null && i.budgetPct !== null && (
                <>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.min(100, i.budgetPct)}%` },
                        i.budgetPct >= BUDGET_WARN_PCT && styles.barWarn,
                      ]}
                    />
                  </View>
                  <View style={styles.bl}>
                    <Text style={styles.blText}>Rozpočet {formatKc(i.order.budgetKc)}</Text>
                    <Text style={[styles.blText, i.budgetPct >= BUDGET_WARN_PCT && styles.warnText]}>{Math.round(i.budgetPct)} %</Text>
                  </View>
                </>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

// Rozměry podle předlohy (.top, .ib, .h1, .kp/.k/.kv/.kl, .flt/.fc, .it, .am, .bar).
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 22, paddingHorizontal: 16, paddingBottom: 12 },
  h1: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(28), letterSpacing: 0.84, lineHeight: fs(30) },
  sub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginTop: 2 },
  ib: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radii.card, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  plus: { color: colors.text, fontSize: fs(26), fontFamily: fonts.body, marginTop: -2 },
  kp: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  k: { flex: 1, backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 10, paddingHorizontal: 12 },
  kv: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(26), lineHeight: fs(28) },
  y: { color: colors.accent },
  kl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11), letterSpacing: 0.66, marginTop: 2 },
  flt: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12, flexWrap: 'wrap' },
  fc: { height: 36, paddingHorizontal: 14, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  fcText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  onText: { color: colors.onAccent },
  lst: { gap: 8, paddingHorizontal: 16, paddingBottom: 24 },
  sortRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 2 },
  sortLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  sortItem: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(12) },
  sortOn: { color: colors.accent },
  loading: { marginTop: 24 },
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(14), textAlign: 'center', marginTop: 24 },
  it: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  r1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  nameBlock: { flex: 1 },
  nm: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(16) },
  od: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  am: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(22), textAlign: 'right' },
  amBlue: { color: INVOICED_BLUE },
  amLabel: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(10), letterSpacing: 0.6, textAlign: 'right' },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  barWarn: { backgroundColor: colors.danger },
  bl: { flexDirection: 'row', justifyContent: 'space-between' },
  blText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  warnText: { color: colors.danger, fontFamily: fonts.bodySemiBold },
});
