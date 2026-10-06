// Detail zakázky (etapa 5) - podle předlohy private/predloha-zakazky.html
// ("DETAIL ZAKÁZKY"): hlavička se stavem, NEVYFAKTUROVÁNO s rozpočtem,
// K FAKTURACI (stroje/práce/km), NÁKLADY A VÝSLEDEK, LIDÉ, PŘIPRAVIT
// PODKLAD K FAKTUŘE. Navíc (zadání): výdaje, podklady k faktuře a jejich
// platba, rozpad po dnech, exporty pro odběratele a interní.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import OrderBadge from '@/components/OrderBadge';
import { getSettings } from '@/lib/db';
import { formatKc, formatNumberCs, toIsoDate } from '@/lib/format';
import { EXPENSE_LABEL, orderReportHtml, orderReportXlsx, type OrderReportKind } from '@/lib/orderReport';
import {
  addExpense,
  createInvoiceBatch,
  deleteExpense,
  deleteInvoiceBatch,
  getOrderDetail,
  listClients,
  listPeople,
  setInvoiceBatchPaid,
  type OrderDetail,
} from '@/lib/orders';
import { BUDGET_WARN_PCT } from '@/lib/orderStats';
import { safeFileName, shareBytes, sharePdfFromHtml, XLSX_MIME } from '@/lib/shareFile';
import type { ExpenseCategory, Person } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

const czDate = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}.` : '');
const czDateYear = (iso: string) => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expense, setExpense] = useState({ amount: '', description: '', category: 'material' as ExpenseCategory, date: toIsoDate(new Date()) });
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceNote, setInvoiceNote] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [workerFilter, setWorkerFilter] = useState<number | null>(null);

  const load = useCallback(async () => {
    setDetail(await getOrderDetail(orderId, workerFilter));
    setPeople(await listPeople());
  }, [orderId, workerFilter]);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!detail) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      </SafeAreaView>
    );
  }
  const { order, stats } = detail;
  const from = order.dateFrom ?? detail.firstDate;
  const subtitle = [order.clientName, from ? `${czDate(from)} – ${order.dateTo ? czDate(order.dateTo) : 'dosud'}` : null].filter(Boolean).join(' · ');
  const budget = order.budgetKc;
  const warn = stats.budgetPct !== null && stats.budgetPct >= BUDGET_WARN_PCT;
  // Pevná cena se fakturuje za celou zakázku, ne po pracovnících.
  const invoiceBlocked = workerFilter !== null && order.priceMode === 'fixed';
  const workerName = workerFilter !== null ? people.find((p) => p.id === workerFilter)?.name : null;

  const saveExpense = async () => {
    const amountKc = Number(expense.amount.replace(',', '.').replace(/\s/g, ''));
    if (!(amountKc > 0)) {
      Alert.alert('Chybí částka', 'Zadej částku výdaje v Kč.');
      return;
    }
    await addExpense(order.id, { date: expense.date, amountKc, description: expense.description.trim(), category: expense.category });
    setExpenseOpen(false);
    setExpense({ amount: '', description: '', category: 'material', date: toIsoDate(new Date()) });
    await load();
  };

  const confirmInvoice = async () => {
    setBusy(true);
    try {
      await createInvoiceBatch(order, stats.unbilledKc, invoiceNote.trim(), workerFilter);
      setInvoiceOpen(false);
      setInvoiceNote('');
      await load();
      Alert.alert('Podklad vytvořen', 'Položky jsou označené jako vyfakturované. Chceš poslat podklad odběrateli?', [
        { text: 'Později', style: 'cancel' },
        { text: 'PDF pro odběratele', onPress: () => runExport('client', 'pdf') },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const runExport = async (kind: OrderReportKind, format: 'pdf' | 'xlsx') => {
    setExportOpen(false);
    setBusy(true);
    try {
      const fresh = (await getOrderDetail(order.id, workerFilter)) ?? detail;
      const base = `Zakazka-${safeFileName(order.name)}-${kind === 'client' ? 'pro-odberatele' : 'interni'}`;
      if (format === 'pdf') {
        const [settings, clients] = await Promise.all([getSettings(), listClients()]);
        const client = clients.find((c) => c.id === order.clientId) ?? null;
        await sharePdfFromHtml(orderReportHtml(fresh, kind, settings, client, workerName ?? null), base, 'Odeslat přehled zakázky');
      } else {
        await shareBytes(orderReportXlsx(fresh, kind), `${base}.xlsx`, XLSX_MIME, 'Odeslat přehled zakázky');
      }
    } catch (err) {
      Alert.alert('Export se nepovedl', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.top}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={8} accessibilityLabel="Zpět">
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text style={styles.h1}>{order.name.toUpperCase()}</Text>
          {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}
        </View>
        <OrderBadge status={order.status} />
      </View>

      <ScrollView contentContainerStyle={styles.sc}>
        {people.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workerRow}>
            {[{ id: null as number | null, name: 'Všichni' }, ...people].map((p) => (
              <TouchableOpacity key={p.id ?? 'all'} style={[styles.chip, workerFilter === p.id && styles.chipOn]} onPress={() => setWorkerFilter(p.id)}>
                <Text style={[styles.chipText, workerFilter === p.id && styles.chipTextOn]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {workerName && <Text style={styles.filterHint}>Jen práce: {workerName} (bez výdajů zakázky; přejezdy, kde řídil)</Text>}
        <View style={styles.hero}>
          <Text style={styles.hl}>NEVYFAKTUROVÁNO</Text>
          <Text style={styles.hv}>{formatKc(stats.unbilledKc)}</Text>
          {budget !== null && stats.budgetPct !== null ? (
            <>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.min(100, stats.budgetPct)}%` }, warn && styles.barWarn]} />
              </View>
              <View style={styles.bl}>
                <Text style={styles.blText}>
                  Celkem {formatKc(stats.ratesTotalKc)} z rozpočtu {formatKc(budget)}
                </Text>
                <Text style={[styles.blText, warn && styles.warnText]}>{Math.round(stats.budgetPct)} %</Text>
              </View>
              {warn && <Text style={styles.warnText}>Blíží se rozpočet - zkontroluj zbývající práce.</Text>}
            </>
          ) : (
            <Text style={styles.blText}>
              Celkem {formatKc(stats.billableKc)}
              {order.priceMode === 'fixed' ? ' (pevná cena)' : ''}
            </Text>
          )}
        </View>

        <Text style={styles.section}>K FAKTURACI</Text>
        <View style={styles.tb}>
          {stats.lines.map((l, i) => (
            <View key={l.categoryId} style={[styles.row, i === 0 && styles.rowFirst]}>
              <View style={styles.rn}>
                <View style={[styles.sw, { backgroundColor: l.color }]} />
                <Text style={styles.rowText}>{l.name}</Text>
                <Text style={styles.rq}>{l.quantityLabel}</Text>
              </View>
              <Text style={styles.rv}>{formatNumberCs(Math.round(l.amountKc))}</Text>
            </View>
          ))}
          {stats.km > 0 && (
            <View style={[styles.row, stats.lines.length === 0 && styles.rowFirst]}>
              <View style={styles.rn}>
                <View style={[styles.sw, { backgroundColor: colors.textMuted }]} />
                <Text style={styles.rowText}>Kilometry</Text>
                <Text style={styles.rq}>{formatNumberCs(Math.round(stats.km))} km</Text>
              </View>
              <Text style={styles.rv}>{formatNumberCs(Math.round(stats.kmAmountKc))}</Text>
            </View>
          )}
          {stats.lines.length === 0 && stats.km === 0 && <Text style={styles.emptyRow}>Zatím žádné zápisy na místech zakázky.</Text>}
          <View style={styles.row}>
            <Text style={[styles.rowText, styles.tot]}>Celkem{order.priceMode === 'fixed' ? ' (pevná cena)' : ''}</Text>
            <Text style={[styles.rv, styles.rvY]}>{formatKc(stats.billableKc)}</Text>
          </View>
        </View>

        <Text style={styles.section}>NÁKLADY A VÝSLEDEK</Text>
        <View style={styles.tb}>
          <View style={[styles.row, styles.rowFirst]}>
            <View style={styles.rn}>
              <Text style={styles.rowText}>Palivo</Text>
              <Text style={styles.rq}>{formatNumberCs(Math.round(stats.fuelLiters))} l</Text>
            </View>
            <Text style={styles.rv}>−{formatNumberCs(Math.round(stats.fuelCostKc))}</Text>
          </View>
          <View style={styles.row}>
            <View style={styles.rn}>
              <Text style={styles.rowText}>Výdaje</Text>
              <Text style={styles.rq}>{stats.expensesByCategory.map((e) => EXPENSE_LABEL[e.category].toLowerCase()).join(', ')}</Text>
            </View>
            <Text style={styles.rv}>−{formatNumberCs(Math.round(stats.expensesKc))}</Text>
          </View>
          <View style={styles.row}>
            <View style={styles.rn}>
              <Text style={[styles.rowText, styles.tot]}>Výsledek</Text>
              {stats.kcPerHour !== null && <Text style={styles.rq}>{formatNumberCs(Math.round(stats.kcPerHour))} Kč/h</Text>}
            </View>
            <Text style={[styles.rv, styles.rvY]}>{formatKc(stats.resultKc)}</Text>
          </View>
        </View>

        {stats.people.length > 0 && (
          <>
            <Text style={styles.section}>LIDÉ</Text>
            <View style={styles.tb}>
              {stats.people.map((p, i) => (
                <View key={p.name} style={[styles.row, i === 0 && styles.rowFirst]}>
                  <Text style={styles.rowText}>{p.name}</Text>
                  <Text style={styles.rv}>{formatNumberCs(Math.round(p.hours * 10) / 10)} h</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.sectionRow}>
          <Text style={styles.section}>VÝDAJE</Text>
          <TouchableOpacity onPress={() => setExpenseOpen(true)} hitSlop={8}>
            <Text style={styles.link}>+ Přidat výdaj</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.tb}>
          {detail.expenses.length === 0 && <Text style={styles.emptyRow}>Žádné výdaje.</Text>}
          {detail.expenses.map((e, i) => (
            <TouchableOpacity
              key={e.id}
              style={[styles.row, i === 0 && styles.rowFirst]}
              onLongPress={() =>
                Alert.alert('Smazat výdaj', `${e.description || EXPENSE_LABEL[e.category]} · ${formatKc(e.amountKc)}`, [
                  { text: 'Zrušit', style: 'cancel' },
                  { text: 'Smazat', style: 'destructive', onPress: async () => { await deleteExpense(e.id); await load(); } },
                ])
              }
            >
              <View style={styles.rn}>
                <Text style={styles.rowText}>{czDate(e.date)}</Text>
                <Text style={styles.rq}>
                  {EXPENSE_LABEL[e.category]}
                  {e.description ? ` · ${e.description}` : ''}
                  {e.invoiceBatchId ? ' · vyúčtováno' : ''}
                </Text>
              </View>
              <Text style={styles.rv}>{formatNumberCs(Math.round(e.amountKc))}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {detail.batches.length > 0 && (
          <>
            <Text style={styles.section}>PODKLADY K FAKTUŘE</Text>
            <View style={styles.tb}>
              {detail.batches.map((b, i) => (
                <View key={b.id} style={[styles.row, i === 0 && styles.rowFirst]}>
                  <View style={styles.rn}>
                    <Text style={styles.rowText}>{czDateYear(toIsoDate(new Date(b.createdAt)))}</Text>
                    <Text style={styles.rq}>{b.status === 'paid' ? `zaplaceno ${b.paidAt ? czDate(toIsoDate(new Date(b.paidAt))) : ''}` : 'čeká na platbu'}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert(`Podklad ${formatKc(b.totalKc)}`, b.note || undefined, [
                        { text: 'Zavřít', style: 'cancel' },
                        { text: b.status === 'paid' ? 'Označit nezaplaceno' : 'Označit zaplaceno', onPress: async () => { await setInvoiceBatchPaid(b, b.status !== 'paid'); await load(); } },
                        { text: 'Zrušit podklad', style: 'destructive', onPress: async () => { await deleteInvoiceBatch(b); await load(); } },
                      ])
                    }
                  >
                    <Text style={[styles.rv, b.status === 'paid' ? styles.paid : styles.rvY]}>{formatKc(b.totalKc)} ›</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        {stats.days.length > 0 && (
          <>
            <Text style={styles.section}>PO DNECH</Text>
            <View style={styles.tb}>
              {stats.days.slice(0, 31).map((x, i) => (
                <TouchableOpacity key={x.date} style={[styles.row, i === 0 && styles.rowFirst]} onPress={() => router.push(`/day/${x.date}`)}>
                  <Text style={styles.rowText}>{czDateYear(x.date)}</Text>
                  <Text style={styles.rv}>{formatNumberCs(Math.round(x.amountKc))} ›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <TouchableOpacity style={styles.assignBtn} onPress={() => router.push(`/order/assign?id=${order.id}`)}>
          <Text style={styles.assignText}>+ Přidat nepřiřazenou práci</Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.secondary} onPress={() => setExportOpen(true)}>
            <Text style={styles.secondaryText}>Export</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => router.push(`/order/edit?id=${order.id}`)}>
            <Text style={styles.secondaryText}>Upravit zakázku</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.cta, (stats.unbilledKc < 0.5 || invoiceBlocked) && styles.ctaDisabled]}
        disabled={stats.unbilledKc < 0.5 || busy || invoiceBlocked}
        onPress={() => setInvoiceOpen(true)}
      >
        {busy ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.ctaText}>{invoiceBlocked ? 'PEVNÁ CENA - PODKLAD ZA CELOU ZAKÁZKU' : workerName ? `PODKLAD K FAKTUŘE · ${workerName.toUpperCase()}` : 'PŘIPRAVIT PODKLAD K FAKTUŘE'}</Text>
        )}
      </TouchableOpacity>

      <BottomSheetModal visible={invoiceOpen} onClose={() => setInvoiceOpen(false)}>
        <Text style={styles.modalTitle}>PODKLAD K FAKTUŘE</Text>
        <Text style={styles.hint}>
          {workerName
            ? `Nevyfakturovaná práce pracovníka ${workerName} (a přejezdy, kde řídil) se označí jako vyfakturovaná. Výdaje zakázky zůstanou pro podklad bez filtru.`
            : 'Všechno nevyfakturované od posledního podkladu se označí jako vyfakturované - nic se nevyúčtuje dvakrát. Podklad jde zrušit.'}
        </Text>
        <Text style={styles.modalBig}>{formatKc(stats.unbilledKc)}</Text>
        <TextInput
          style={styles.input}
          value={invoiceNote}
          onChangeText={setInvoiceNote}
          placeholder="Poznámka (např. číslo faktury)"
          placeholderTextColor={colors.textMuted}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <TouchableOpacity style={styles.modalCta} onPress={confirmInvoice}>
          <Text style={styles.ctaText}>OZNAČIT VYFAKTUROVÁNO</Text>
        </TouchableOpacity>
      </BottomSheetModal>

      <BottomSheetModal visible={expenseOpen} onClose={() => setExpenseOpen(false)}>
        <Text style={styles.modalTitle}>VÝDAJ K ZAKÁZCE</Text>
        <View style={styles.chips}>
          {(Object.keys(EXPENSE_LABEL) as ExpenseCategory[]).map((c) => (
            <TouchableOpacity key={c} style={[styles.chip, expense.category === c && styles.chipOn]} onPress={() => setExpense((e) => ({ ...e, category: c }))}>
              <Text style={[styles.chipText, expense.category === c && styles.chipTextOn]}>{EXPENSE_LABEL[c]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={expense.amount}
          onChangeText={(t) => setExpense((e) => ({ ...e, amount: t }))}
          placeholder="Částka Kč"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <TextInput
          style={styles.input}
          value={expense.description}
          onChangeText={(t) => setExpense((e) => ({ ...e, description: t }))}
          placeholder="Popis (např. štěrk 8 t)"
          placeholderTextColor={colors.textMuted}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <TouchableOpacity style={styles.modalCta} onPress={saveExpense}>
          <Text style={styles.ctaText}>ULOŽIT VÝDAJ</Text>
        </TouchableOpacity>
      </BottomSheetModal>

      <BottomSheetModal visible={exportOpen} onClose={() => setExportOpen(false)}>
        <Text style={styles.modalTitle}>EXPORT ZAKÁZKY</Text>
        <Text style={styles.hint}>Pro odběratele: bez nákladů, s logem a tvými údaji. Interní: s náklady, výsledkem, lidmi a dny.</Text>
        {(['client', 'internal'] as OrderReportKind[]).map((kind) => (
          <View key={kind} style={styles.exportRow}>
            <Text style={styles.exportLabel}>{kind === 'client' ? 'Pro odběratele' : 'Interní'}</Text>
            <TouchableOpacity style={styles.exportBtn} onPress={() => runExport(kind, 'pdf')}>
              <Text style={styles.secondaryText}>PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.exportBtn} onPress={() => runExport(kind, 'xlsx')}>
              <Text style={styles.secondaryText}>Excel</Text>
            </TouchableOpacity>
          </View>
        ))}
      </BottomSheetModal>
    </SafeAreaView>
  );
}

// Rozměry podle předlohy (.top, .hero/.hv/.hl, .tb/.row/.rv, .cta).
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { marginTop: 40 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 22, paddingHorizontal: 16, paddingBottom: 12 },
  back: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  backText: { color: colors.text, fontSize: fs(28), fontFamily: fonts.body, marginTop: -2 },
  titleBlock: { flex: 1 },
  h1: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(28), letterSpacing: 0.84, lineHeight: fs(30) },
  sub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginTop: 2 },
  sc: { paddingHorizontal: 16, gap: 12, paddingBottom: 16 },
  hero: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  hl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), letterSpacing: 0.72 },
  hv: { color: colors.accent, fontFamily: 'BarlowCondensed_800ExtraBold', fontSize: fs(40), lineHeight: fs(42) },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  barWarn: { backgroundColor: colors.danger },
  bl: { flexDirection: 'row', justifyContent: 'space-between' },
  blText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  warnText: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(12) },
  section: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1.1 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  tb: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 2, paddingHorizontal: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 34, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  rowFirst: { borderTopWidth: 0 },
  rn: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' },
  sw: { width: 9, height: 9, borderRadius: 2 },
  rowText: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14) },
  rq: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginLeft: 4 },
  rv: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(17) },
  rvY: { color: colors.accent, fontSize: fs(19) },
  paid: { color: '#4CAF78' },
  tot: { fontFamily: fonts.bodySemiBold },
  emptyRow: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), paddingVertical: 10 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  secondary: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  cta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12, marginHorizontal: 16, marginBottom: 20 },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(19), letterSpacing: 0.95 },
  modalTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1, marginBottom: 10 },
  modalBig: { color: colors.accent, fontFamily: 'BarlowCondensed_800ExtraBold', fontSize: fs(40), marginVertical: 8 },
  modalCta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), lineHeight: fs(17) },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.background, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  workerRow: { gap: 8 },
  assignBtn: { minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  assignText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  filterHint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  chipTextOn: { color: colors.onAccent },
  exportRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  exportLabel: { flex: 1, color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  exportBtn: { minWidth: 72, minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
});
