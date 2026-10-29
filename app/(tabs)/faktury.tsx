// Fakturace - seznam faktur (koncepty, vystavené, zaplacené, zrušené), souhrn
// nezaplaceno / po splatnosti, "+ Nová faktura" bez zakázky (faktura ze
// zakázky se zakládá v detailu zakázky) a odběratelé. Styl jako Zakázky.

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import SafeScreen from '@/components/SafeScreen';
import { czDate } from '@/lib/invoiceCalc';
import { kcInvoice } from '@/lib/invoiceReport';
import { listInvoices } from '@/lib/invoices';
import { formatKc, todayIso } from '@/lib/format';
import type { Invoice } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type Filter = 'all' | 'draft' | 'unpaid' | 'paid' | 'cancelled';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Vše' },
  { key: 'unpaid', label: 'Nezaplacené' },
  { key: 'draft', label: 'Koncepty' },
  { key: 'paid', label: 'Zaplacené' },
  { key: 'cancelled', label: 'Zrušené' },
];

export default function InvoicesScreen() {
  const [items, setItems] = useState<Invoice[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setItems(await listInvoices());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const today = todayIso();
  const unpaid = (items ?? []).filter((i) => i.status === 'issued');
  const overdue = unpaid.filter((i) => i.dueDate < today);
  const visible = (items ?? []).filter((i) => (filter === 'all' ? true : filter === 'unpaid' ? i.status === 'issued' : i.status === filter));

  return (
    <SafeScreen style={styles.container} tab>
      <View style={styles.top}>
        <Text style={styles.h1}>FAKTURACE</Text>
        <TouchableOpacity style={styles.clients} onPress={() => router.push('/invoice/clients')}>
          <Text style={styles.clientsText}>Odběratelé</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.kp}>
        <View style={styles.k}>
          <Text style={[styles.kv, styles.y]}>{formatKc(unpaid.reduce((s, i) => s + i.totalKc, 0))}</Text>
          <Text style={styles.kl}>NEZAPLACENO</Text>
        </View>
        <View style={styles.k}>
          <Text style={[styles.kv, overdue.length > 0 && styles.red]}>{formatKc(overdue.reduce((s, i) => s + i.totalKc, 0))}</Text>
          <Text style={styles.kl}>PO SPLATNOSTI</Text>
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
        {items === null && <ActivityIndicator color={colors.accent} style={styles.loading} />}
        {items !== null && visible.length === 0 && (
          <Text style={styles.empty}>{items.length === 0 ? 'Zatím žádné faktury. Fakturu ze zakázky vystavíš v detailu zakázky.' : 'V tomhle filtru nic není.'}</Text>
        )}
        {visible.map((i) => {
          const late = i.status === 'issued' && i.dueDate < today;
          const label =
            i.status === 'draft' ? 'KONCEPT' : i.status === 'paid' ? 'ZAPLACENO' : i.status === 'cancelled' ? 'ZRUŠENÁ' : late ? 'PO SPLATNOSTI' : `SPLATNÁ ${czDate(i.dueDate)}`;
          // Koncept číslo nemá (přidělí se při vystavení), jen ručně zadané.
          return (
            <TouchableOpacity key={i.id} style={styles.it} onPress={() => router.push(`/invoice/edit?id=${i.id}`)}>
              <View style={styles.nameBlock}>
                <Text style={styles.nm}>
                  {i.status === 'draft' && !i.numberManual ? 'Koncept' : `č. ${i.number}`}
                  {i.client?.name ? ` · ${i.client.name}` : ''}
                </Text>
                <Text style={styles.od}>{[czDate(i.issueDate), i.orderName ? `zakázka ${i.orderName}` : 'bez zakázky'].join(' · ')}</Text>
              </View>
              <View>
                <Text style={[styles.am, i.status === 'paid' && styles.green, (i.status === 'draft' || i.status === 'cancelled') && styles.muted, i.status === 'cancelled' && styles.strike]}>{kcInvoice(i.totalKc)}</Text>
                <Text style={[styles.amLabel, (late || i.status === 'cancelled') && styles.red]}>{label}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity style={styles.cta} onPress={() => router.push('/invoice/edit')}>
        <Text style={styles.ctaText}>+ NOVÁ FAKTURA</Text>
      </TouchableOpacity>
    </SafeScreen>
  );
}

// Rozměry jako seznam zakázek (.top, .kp/.k, .flt/.fc, .it, .am).
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 22, paddingHorizontal: 16, paddingBottom: 12 },
  h1: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(28), letterSpacing: 0.84, lineHeight: fs(30) },
  clients: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, backgroundColor: colors.card, justifyContent: 'center' },
  clientsText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  kp: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  k: { flex: 1, backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 10, paddingHorizontal: 12 },
  kv: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(26), lineHeight: fs(28) },
  y: { color: colors.accent },
  red: { color: colors.danger },
  green: { color: '#4CAF78' },
  muted: { color: colors.textMuted },
  strike: { textDecorationLine: 'line-through' },
  kl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11), letterSpacing: 0.66, marginTop: 2 },
  flt: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12, flexWrap: 'wrap' },
  fc: { height: 36, paddingHorizontal: 14, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  fcText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  onText: { color: colors.onAccent },
  lst: { gap: 8, paddingHorizontal: 16, paddingBottom: 24 },
  loading: { marginTop: 24 },
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(14), textAlign: 'center', marginTop: 24 },
  it: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 12, paddingHorizontal: 14 },
  nameBlock: { flex: 1 },
  nm: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(16) },
  od: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginTop: 2 },
  am: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(22), textAlign: 'right' },
  amLabel: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(10), letterSpacing: 0.6, textAlign: 'right' },
  cta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginHorizontal: 16, marginBottom: 16 },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(19), letterSpacing: 0.95 },
});
