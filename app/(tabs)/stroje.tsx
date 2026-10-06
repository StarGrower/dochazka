// Záložka Stroje (etapa 6) - ve stylu předlohy zakázek: souhrn K
// PROPLACENÍ / ZÁSOBA NAFTY, + TANKOVAT, KNIHA JÍZD (etapa 7), karty
// strojů s počitadlem, nejbližším servisem a závadami.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { formatKc, formatNumberCs } from '@/lib/format';
import { fuelReportHtml, fuelReportXlsx } from '@/lib/fuelReport';
import {
  COUNTER_LABEL,
  fuelCostOf,
  fuelStock,
  itemStatus,
  listDefects,
  listFuelEntries,
  listMachines,
  listServiceItems,
  listToReimburse,
  machineCounter,
  markReimbursed,
  PAYMENT_LABEL,
  type FuelEntry,
  type MachineCard,
} from '@/lib/machines';
import { shareBytes, sharePdfFromHtml, XLSX_MIME } from '@/lib/shareFile';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

interface MachineSummary {
  machine: MachineCard;
  counter: number | null;
  service: { label: string; level: 'ok' | 'soon' | 'overdue' } | null;
  defects: number;
  stopped: boolean;
  fuelMonthKc: number;
}

export const SERVICE_COLOR = { ok: '#4CAF78', soon: colors.accent, overdue: colors.danger } as const;

export default function StrojeScreen() {
  const [items, setItems] = useState<MachineSummary[] | null>(null);
  const [reimburse, setReimburse] = useState<FuelEntry[]>([]);
  const [stock, setStock] = useState({ liters: 0, avgPricePerL: 0 });
  const [reimburseOpen, setReimburseOpen] = useState(false);

  const load = useCallback(async () => {
    const machines = await listMachines();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const out: MachineSummary[] = [];
    for (const m of machines) {
      const info = await machineCounter(m);
      const statuses = (await listServiceItems(m.id)).map((i) => ({ item: i, st: itemStatus(i, info) })).filter((x) => x.st.level !== 'unknown');
      // Nejbližší servis: po termínu > blíží se > nejmenší zbytek.
      const rank = { overdue: 0, soon: 1, ok: 2, unknown: 3 } as const;
      statuses.sort((a, b) => rank[a.st.level] - rank[b.st.level] || (a.st.estimatedWorkdays ?? a.st.remainingDays ?? 9999) - (b.st.estimatedWorkdays ?? b.st.remainingDays ?? 9999));
      const next = statuses[0];
      const unit = COUNTER_LABEL[m.counterUnit];
      const defects = await listDefects(m.id, false);
      const fuel = (await listFuelEntries(m.id)).filter((e) => Date.parse(e.fueledAt) >= monthStart.getTime());
      out.push({
        machine: m,
        counter: info.estimate?.value ?? null,
        service: next
          ? {
              level: next.st.level as 'ok' | 'soon' | 'overdue',
              label:
                next.st.level === 'overdue'
                  ? `${next.item.name} - po termínu`
                  : next.st.remainingValue !== null && unit
                    ? `${next.item.name} za ${formatNumberCs(Math.round(next.st.remainingValue))} ${unit}${next.st.estimatedWorkdays !== null ? ` (≈ ${next.st.estimatedWorkdays} prac. dní)` : ''}`
                    : `${next.item.name} za ${next.st.remainingDays} dní`,
            }
          : null,
        defects: defects.length,
        stopped: defects.some((d) => d.severity === 'stopped'),
        fuelMonthKc: fuel.reduce((s, e) => s + fuelCostOf(e), 0),
      });
    }
    setItems(out);
    setReimburse(await listToReimburse());
    setStock(await fuelStock());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const reimburseKc = reimburse.reduce((s, e) => s + fuelCostOf(e), 0);

  const exportFuel = () => {
    const year = new Date().getFullYear();
    const run = async (format: 'pdf' | 'xlsx') => {
      try {
        const entries = (await listFuelEntries()).filter((e) => new Date(e.fueledAt).getFullYear() === year);
        const machines = await listMachines();
        if (format === 'pdf') await sharePdfFromHtml(fuelReportHtml(year, entries, machines), `Tankovani-${year}`, 'Přehled tankování');
        else await shareBytes(fuelReportXlsx(entries, machines), `Tankovani-${year}.xlsx`, XLSX_MIME, 'Přehled tankování');
      } catch (err) {
        Alert.alert('Export se nepovedl', err instanceof Error ? err.message : String(err));
      }
    };
    Alert.alert(`Přehled tankování ${year}`, undefined, [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'PDF', onPress: () => run('pdf') },
      { text: 'Excel', onPress: () => run('xlsx') },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.top}>
        <Text style={styles.h1}>STROJE</Text>
        <TouchableOpacity style={styles.ib} onPress={() => router.push('/machine/edit')} accessibilityLabel="Nový stroj">
          <Text style={styles.plus}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.kp}>
        <TouchableOpacity style={styles.k} onPress={() => setReimburseOpen(true)}>
          <Text style={[styles.kv, styles.y]}>{formatKc(reimburseKc)}</Text>
          <Text style={styles.kl}>K PROPLACENÍ</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.k} onPress={() => router.push('/fuel/stock')}>
          <Text style={styles.kv}>{formatNumberCs(Math.round(stock.liters))} l</Text>
          <Text style={styles.kl}>ZÁSOBA NAFTY</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.primary} onPress={() => router.push('/fuel/edit')}>
          <Text style={styles.primaryText}>+ TANKOVAT</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => router.push('/logbook')}>
          <Text style={styles.secondaryText}>KNIHA JÍZD</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.lst}>
        {items === null && <ActivityIndicator color={colors.accent} style={styles.loading} />}
        {items?.length === 0 && <Text style={styles.empty}>Zatím žádné stroje. Přidej první tlačítkem +.</Text>}
        {items?.map((i) => (
          <TouchableOpacity key={i.machine.id} style={styles.it} onPress={() => router.push(`/machine/${i.machine.id}`)}>
            <View style={styles.r1}>
              <View style={styles.nameRow}>
                <View style={[styles.sw, { backgroundColor: i.machine.color }]} />
                <View style={styles.nameBlock}>
                  <Text style={styles.nm}>{i.machine.name}</Text>
                  {!!(i.machine.plate || i.machine.model) && <Text style={styles.od}>{[i.machine.model, i.machine.plate].filter(Boolean).join(' · ')}</Text>}
                </View>
              </View>
              {i.counter !== null && (
                <Text style={styles.am}>
                  ≈ {formatNumberCs(Math.round(i.counter))} {COUNTER_LABEL[i.machine.counterUnit]}
                </Text>
              )}
            </View>
            {i.service && (
              <View style={styles.serviceRow}>
                <View style={[styles.dot, { backgroundColor: SERVICE_COLOR[i.service.level] }]} />
                <Text style={styles.od}>{i.service.label}</Text>
              </View>
            )}
            <View style={styles.bl}>
              {i.defects > 0 ? (
                <Text style={[styles.blText, i.stopped ? styles.danger : styles.warn]}>
                  {i.stopped ? 'Stroj stojí' : `Závady: ${i.defects}`}
                </Text>
              ) : (
                <Text style={styles.blText}>Bez závad</Text>
              )}
              {i.fuelMonthKc > 0 && <Text style={styles.blText}>Palivo tento měsíc {formatKc(i.fuelMonthKc)}</Text>}
            </View>
          </TouchableOpacity>
        ))}
        {items !== null && items.length > 0 && (
          <TouchableOpacity style={styles.exportLink} onPress={exportFuel}>
            <Text style={styles.exportText}>Přehled tankování {new Date().getFullYear()} (PDF / Excel)</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <BottomSheetModal
        visible={reimburseOpen}
        onClose={() => setReimburseOpen(false)}
        footer={
          reimburse.length > 0 ? (
            <TouchableOpacity
              style={styles.primaryWide}
              onPress={() =>
                Alert.alert('Označit proplaceno', `${reimburse.length}× za ${formatKc(reimburseKc)}?`, [
                  { text: 'Zrušit', style: 'cancel' },
                  {
                    text: 'Proplaceno',
                    onPress: async () => {
                      await markReimbursed(reimburse.map((e) => e.id));
                      setReimburseOpen(false);
                      await load();
                    },
                  },
                ])
              }
            >
              <Text style={styles.primaryText}>OZNAČIT PROPLACENO</Text>
            </TouchableOpacity>
          ) : undefined
        }
      >
        <Text style={styles.modalTitle}>K PROPLACENÍ</Text>
        <Text style={styles.hintText}>Tankování vlastní kartou nebo hotově, zatím neproplacená.</Text>
        <View>
          {reimburse.map((e) => (
            <View key={e.id} style={styles.reRow}>
              <Text style={styles.reText}>
                {new Date(e.fueledAt).toLocaleDateString('cs-CZ')} · {formatNumberCs(e.liters)} l · {PAYMENT_LABEL[e.payment]}
              </Text>
              <Text style={styles.reKc}>{formatKc(fuelCostOf(e))}</Text>
            </View>
          ))}
          {reimburse.length === 0 && <Text style={styles.hintText}>Nic k proplacení.</Text>}
        </View>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  exportLink: { minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  exportText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  container: { flex: 1, backgroundColor: colors.background },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 22, paddingHorizontal: 16, paddingBottom: 12 },
  h1: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(28), letterSpacing: 0.84 },
  ib: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radii.card, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  plus: { color: colors.text, fontSize: fs(26), fontFamily: fonts.body, marginTop: -2 },
  kp: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  k: { flex: 1, backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 10, paddingHorizontal: 12 },
  kv: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(26), lineHeight: fs(28) },
  y: { color: colors.accent },
  kl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11), letterSpacing: 0.66, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  primary: { flex: 1, height: 48, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryWide: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(17), letterSpacing: 0.85 },
  secondary: { flex: 1, height: 48, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(17), letterSpacing: 0.85 },
  lst: { gap: 8, paddingHorizontal: 16, paddingBottom: 24 },
  loading: { marginTop: 24 },
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(14), textAlign: 'center', marginTop: 24 },
  it: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  r1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  nameBlock: { flex: 1 },
  sw: { width: 10, height: 10, borderRadius: 2 },
  nm: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(16) },
  od: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  am: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(20), textAlign: 'right' },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bl: { flexDirection: 'row', justifyContent: 'space-between' },
  blText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  warn: { color: colors.accent, fontFamily: fonts.bodySemiBold },
  danger: { color: colors.danger, fontFamily: fonts.bodySemiBold },
  modalTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1, marginBottom: 6 },
  hintText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 8 },
  reRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  reText: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14), flex: 1 },
  reKc: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(16) },
});
