// Detail zakázky → "Přidat nepřiřazenou práci": položky, přejezdy a výdaje
// bez zakázky (výdaje = ze smazaných zakázek) s filtrem období, místa a
// pracovníka; zaškrtnout -> přiřadit ručně (automatika je pak nezmění).
// Vyfakturované položky se nenabízejí - přeřadit nejdou.

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import { listPlaces } from '@/lib/db';
import { formatKc, formatNumberCs, formatQuantity, toIsoDate } from '@/lib/format';
import {
  assignToOrder,
  getOrder,
  listOrphanExpenses,
  listPeople,
  listUnassignedRecords,
  listUnassignedTrips,
  type UnassignedRecord,
  type UnassignedTrip,
} from '@/lib/orders';
import { EXPENSE_LABEL } from '@/lib/orderReport';
import type { Order, OrderExpense, Person, Place } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type Tab = 'records' | 'trips' | 'expenses';
type Period = 'all' | 'order' | 'thisMonth' | 'lastMonth';
type Expense = OrderExpense & { orderName: string };

const cz = (iso: string) => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;

function periodRange(p: Period, order: Order | null): { from: string; to: string } | null {
  const now = new Date();
  if (p === 'thisMonth') return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  if (p === 'lastMonth') return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (p === 'order' && order) return { from: order.dateFrom ?? '0000-01-01', to: order.dateTo ?? '9999-12-31' };
  return null;
}

export default function AssignWorkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const [order, setOrder] = useState<Order | null>(null);
  const [records, setRecords] = useState<UnassignedRecord[] | null>(null);
  const [trips, setTrips] = useState<UnassignedTrip[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [tab, setTab] = useState<Tab>('records');
  const [period, setPeriod] = useState<Period>('all');
  const [placeFilter, setPlaceFilter] = useState<number | null | 'all'>('all');
  const [workerFilter, setWorkerFilter] = useState<number | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const o = await getOrder(orderId);
    setOrder(o);
    if (o && (o.dateFrom || o.dateTo)) setPeriod((p) => (p === 'all' ? 'order' : p));
    setRecords(await listUnassignedRecords());
    setTrips(await listUnassignedTrips());
    setExpenses(await listOrphanExpenses());
    setPlaces(await listPlaces(true));
    setPeople(await listPeople(true));
    setSelected(new Set());
  }, [orderId]);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const range = periodRange(period, order);
  const inRange = (date: string) => !range || (date >= range.from && date <= range.to);
  const placeName = (pid: number | null) => (pid === null ? 'bez místa' : (places.find((p) => p.id === pid)?.name ?? 'smazané místo'));
  const personName = (pid: number) => people.find((p) => p.id === pid)?.name ?? '?';

  const fRecords = useMemo(
    () =>
      (records ?? []).filter(
        (r) => inRange(r.date) && (placeFilter === 'all' || r.placeId === placeFilter) && (workerFilter === 'all' || r.workerId === workerFilter)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, period, order, placeFilter, workerFilter]
  );
  const fTrips = useMemo(
    () =>
      trips.filter((t) => {
        const d = toIsoDate(new Date(t.startAt));
        return inRange(d) && (placeFilter === 'all' || t.toPlaceId === placeFilter || t.fromPlaceId === placeFilter) && (workerFilter === 'all' || t.driverId === workerFilter);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trips, period, order, placeFilter, workerFilter]
  );
  const fExpenses = useMemo(
    () => expenses.filter((e) => inRange(e.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, period, order]
  );

  const placeOptions = [...new Set([...(records ?? []).map((r) => r.placeId), ...trips.flatMap((t) => [t.toPlaceId, t.fromPlaceId])])].filter(
    (p, i, arr) => arr.indexOf(p) === i && (p === null || !places.find((x) => x.id === p)?.isPrivate)
  );
  const workerOptions = [...new Set([...(records ?? []).map((r) => r.workerId), ...trips.map((t) => t.driverId)])];

  const keysOfTab = (t: Tab) =>
    t === 'records' ? fRecords.map((r) => `r${r.id}`) : t === 'trips' ? fTrips.map((x) => `t${x.id}`) : fExpenses.map((e) => `e${e.id}`);
  const tabKeys = keysOfTab(tab);
  const allOn = tabKeys.length > 0 && tabKeys.every((k) => selected.has(k));

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const next = new Set(s);
      for (const k of tabKeys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  const ids = (prefix: string) => [...selected].filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(1)));

  const assign = async () => {
    if (!order || selected.size === 0) return;
    const recordIds = ids('r');
    const tripIds = ids('t');
    const expenseIds = ids('e');
    const manualNone = (records ?? []).filter((r) => recordIds.includes(r.id) && r.manualNone).length;
    const go = async () => {
      setBusy(true);
      try {
        await assignToOrder(order.id, { recordIds, tripIds, expenseIds });
        router.back();
      } finally {
        setBusy(false);
      }
    };
    if (manualNone > 0) {
      Alert.alert('Ručně bez zakázky', `${manualNone} vybraných položek má ručně nastaveno „bez zakázky“. Přiřadit je přesto k zakázce ${order.name}?`, [
        { text: 'Zrušit', style: 'cancel' },
        { text: 'Přiřadit', onPress: go },
      ]);
    } else {
      await go();
    }
  };

  const chip = (label: string, active: boolean, onPress: () => void, key: string) => (
    <TouchableOpacity key={key} style={[styles.chip, active && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const check = (on: boolean) => (
    <View style={[styles.check, on && styles.checkOn]}>
      <Text style={styles.checkMark}>{on ? '✓' : ''}</Text>
    </View>
  );

  const header = (
    <View style={styles.headerBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {chip(`Práce (${fRecords.length})`, tab === 'records', () => setTab('records'), 'tr')}
        {chip(`Přejezdy (${fTrips.length})`, tab === 'trips', () => setTab('trips'), 'tt')}
        {chip(`Výdaje (${fExpenses.length})`, tab === 'expenses', () => setTab('expenses'), 'te')}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {order && (order.dateFrom || order.dateTo) ? chip('Období zakázky', period === 'order', () => setPeriod('order'), 'po') : null}
        {chip('Tento měsíc', period === 'thisMonth', () => setPeriod('thisMonth'), 'pt')}
        {chip('Minulý měsíc', period === 'lastMonth', () => setPeriod('lastMonth'), 'pl')}
        {chip('Vše', period === 'all', () => setPeriod('all'), 'pa')}
      </ScrollView>
      {tab !== 'expenses' && placeOptions.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {chip('Všechna místa', placeFilter === 'all', () => setPlaceFilter('all'), 'pall')}
          {placeOptions.map((p) => chip(placeName(p), placeFilter === p, () => setPlaceFilter(p), `pl${p ?? 'none'}`))}
        </ScrollView>
      )}
      {tab !== 'expenses' && workerOptions.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {chip('Všichni', workerFilter === 'all', () => setWorkerFilter('all'), 'wall')}
          {workerOptions.map((w) => chip(personName(w), workerFilter === w, () => setWorkerFilter(w), `w${w}`))}
        </ScrollView>
      )}
      {tab === 'expenses' && <Text style={styles.hint}>Výdaje patří vždy zakázce - tady jsou výdaje smazaných zakázek.</Text>}
      {tabKeys.length > 0 && (
        <TouchableOpacity style={styles.allRow} onPress={toggleAll}>
          {check(allOn)}
          <Text style={styles.allText}>{allOn ? 'Zrušit výběr' : 'Vybrat vše v seznamu'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  type Row = { key: string; title: string; sub: string; right: string };
  const rows: Row[] =
    tab === 'records'
      ? fRecords.map((r) => ({
          key: `r${r.id}`,
          title: `${cz(r.date)} · ${r.categoryName} ${formatQuantity(r.quantity, r.unit)}`,
          sub: [placeName(r.placeId), personName(r.workerId), r.manualNone ? 'ručně bez zakázky' : null].filter(Boolean).join(' · '),
          right: formatKc(r.amountKc),
        }))
      : tab === 'trips'
        ? fTrips.map((t) => ({
            key: `t${t.id}`,
            title: `${cz(toIsoDate(new Date(t.startAt)))} · ${placeName(t.fromPlaceId)} → ${placeName(t.toPlaceId)}`,
            sub: personName(t.driverId),
            right: `${formatNumberCs(Math.round(t.km * 10) / 10)} km`,
          }))
        : fExpenses.map((e) => ({
            key: `e${e.id}`,
            title: `${cz(e.date)} · ${EXPENSE_LABEL[e.category]}${e.description ? ` · ${e.description}` : ''}`,
            sub: `ze smazané zakázky ${e.orderName}`,
            right: formatKc(e.amountKc),
          }));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="NEPŘIŘAZENÁ PRÁCE" subtitle={order?.name} onBack={() => router.back()} />
      {records === null ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>V tomto výběru není nic nepřiřazeného.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => toggle(item.key)}>
              {check(selected.has(item.key))}
              <View style={styles.flex}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {!!item.sub && <Text style={styles.rowSub}>{item.sub}</Text>}
              </View>
              <Text style={styles.rowRight}>{item.right}</Text>
            </TouchableOpacity>
          )}
        />
      )}
      <TouchableOpacity style={[styles.cta, selected.size === 0 && styles.ctaDisabled]} disabled={selected.size === 0 || busy} onPress={assign}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.ctaText}>PŘIŘADIT K ZAKÁZCE ({selected.size})</Text>}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { marginTop: 40 },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  headerBlock: { gap: 8, marginBottom: 8 },
  chipsRow: { gap: 8 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', maxWidth: 220 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  chipTextOn: { color: colors.onAccent },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  allRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TOUCH },
  allText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6, minHeight: 56 },
  rowTitle: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  rowSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 1 },
  rowRight: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(15) },
  check: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15) },
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), paddingVertical: 20, textAlign: 'center' },
  cta: { height: 56, margin: 16, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18), letterSpacing: 0.9 },
});
