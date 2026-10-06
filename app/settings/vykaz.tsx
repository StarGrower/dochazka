// Nastavení -> Výkaz pro šéfa (etapa 4.4): období, místa, volby (ceny,
// mapa tras, podrobně), podpis prstem; PDF / Excel (XLSX) / CSV přes
// systémové Sdílet (e-mail, WhatsApp, Soubory, AirDrop). Soukromá místa
// a jízdy se nikdy nevypíšou (lib/report.ts).

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import SignaturePad from '@/components/SignaturePad';
import ToggleRow from '@/components/ToggleRow';
import { getSettings, listPlaces } from '@/lib/db';
import { toIsoDate } from '@/lib/format';
import { collectReport, reportCsv, reportHtml, reportXlsx, type ReportOptions } from '@/lib/report';
import { listPeople } from '@/lib/orders';
import type { AppSettings, Person, Place } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type PeriodKey = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'custom';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'thisWeek', label: 'Tento týden' },
  { key: 'lastWeek', label: 'Minulý týden' },
  { key: 'thisMonth', label: 'Tento měsíc' },
  { key: 'lastMonth', label: 'Minulý měsíc' },
  { key: 'custom', label: 'Vlastní' },
];

function periodRange(key: PeriodKey): { from: string; to: string } {
  const now = new Date();
  if (key === 'thisMonth' || key === 'lastMonth') {
    const offset = key === 'lastMonth' ? -1 : 0;
    return {
      from: toIsoDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
      to: toIsoDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)),
    };
  }
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  if (key === 'lastWeek') monday.setDate(monday.getDate() - 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: toIsoDate(monday), to: toIsoDate(sunday) };
}

// "5. 10. 2026" -> "2026-10-05"; null = neplatné.
function parseCzDate(text: string): string | null {
  const m = /^\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : toIsoDate(d);
}

const czDate = (iso: string) => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;

export default function VykazScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [period, setPeriod] = useState<PeriodKey>('lastMonth');
  const [customFrom, setCustomFrom] = useState(czDate(periodRange('thisMonth').from));
  const [customTo, setCustomTo] = useState(czDate(toIsoDate(new Date())));
  const [placeIds, setPlaceIds] = useState<number[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [workerId, setWorkerId] = useState<number | null>(null);
  const [withPrices, setWithPrices] = useState(true);
  const [withMap, setWithMap] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setSettings(await getSettings());
    setPlaces((await listPlaces()).filter((p) => !p.isPrivate && !p.isHome));
    setPeople(await listPeople());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const range = (): { from: string; to: string } | null => {
    if (period !== 'custom') return periodRange(period);
    const from = parseCzDate(customFrom);
    const to = parseCzDate(customTo);
    return from && to && from <= to ? { from, to } : null;
  };

  const togglePlace = (id: number) =>
    setPlaceIds((current) => {
      const list = current ?? [];
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      return next.length === 0 ? null : next;
    });

  const exportAs = async (format: 'pdf' | 'xlsx' | 'csv') => {
    const r = range();
    if (!r || !settings) {
      Alert.alert('Neplatné období', 'Zadej datum od-do ve tvaru 1. 10. 2026.');
      return;
    }
    setBusy(true);
    try {
      const options: ReportOptions = {
        ...r,
        placeIds,
        workerId,
        withPrices,
        withMap: withMap && format === 'pdf',
        detailed,
        signatureSvgPath: signing ? signature : null,
      };
      const data = await collectReport(options);
      if (data.days.length === 0) {
        Alert.alert('Nic k výkazu', 'V tomhle období nejsou žádné zápisy ani pobyty.');
        return;
      }
      const baseName = `Vykaz-${r.from}-az-${r.to}`;
      let uri: string;
      let mimeType: string;
      if (format === 'pdf') {
        const printed = await Print.printToFileAsync({ html: await reportHtml(data, settings) });
        const target = new File(Paths.cache, `${baseName}.pdf`);
        if (target.exists) target.delete();
        await new File(printed.uri).move(target);
        uri = target.uri;
        mimeType = 'application/pdf';
      } else {
        const target = new File(Paths.cache, `${baseName}.${format}`);
        if (target.exists) target.delete();
        target.create();
        if (format === 'csv') target.write(reportCsv(data));
        else target.write(reportXlsx(data));
        uri = target.uri;
        mimeType = format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }
      await Sharing.shareAsync(uri, { mimeType, dialogTitle: 'Odeslat výkaz' });
    } catch (err) {
      Alert.alert('Výkaz se nepovedl', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const r = range();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="VÝKAZ PRO ŠÉFA" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" scrollEnabled={!signing || !!signature}>
        <Text style={styles.sectionHeader}>OBDOBÍ</Text>
        <View style={styles.chips}>
          {PERIODS.map((p) => (
            <TouchableOpacity key={p.key} style={[styles.chip, period === p.key && styles.chipOn]} onPress={() => setPeriod(p.key)}>
              <Text style={[styles.chipText, period === p.key && styles.chipTextOn]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {period === 'custom' && (
          <View style={styles.dates}>
            <TextInput style={styles.dateInput} value={customFrom} onChangeText={setCustomFrom} placeholder="1. 10. 2026" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
            <Text style={styles.dash}>–</Text>
            <TextInput style={styles.dateInput} value={customTo} onChangeText={setCustomTo} placeholder="31. 10. 2026" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          </View>
        )}
        <Text style={styles.hint}>{r ? `${czDate(r.from)} – ${czDate(r.to)}` : 'Zadej datum ve tvaru 1. 10. 2026'}</Text>

        {places.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>MÍSTA</Text>
            <View style={styles.chips}>
              <TouchableOpacity style={[styles.chip, placeIds === null && styles.chipOn]} onPress={() => setPlaceIds(null)}>
                <Text style={[styles.chipText, placeIds === null && styles.chipTextOn]}>Vše</Text>
              </TouchableOpacity>
              {places.map((p) => {
                const on = placeIds?.includes(p.id) ?? false;
                return (
                  <TouchableOpacity key={p.id} style={[styles.chip, on && styles.chipOn]} onPress={() => togglePlace(p.id)}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.orderLabel ? `${p.name} · ${p.orderLabel}` : p.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {people.length > 1 && (
          <>
            <Text style={styles.sectionHeader}>PRACOVNÍK</Text>
            <View style={styles.chips}>
              <TouchableOpacity style={[styles.chip, workerId === null && styles.chipOn]} onPress={() => setWorkerId(null)}>
                <Text style={[styles.chipText, workerId === null && styles.chipTextOn]}>Všichni</Text>
              </TouchableOpacity>
              {people.map((p) => (
                <TouchableOpacity key={p.id} style={[styles.chip, workerId === p.id && styles.chipOn]} onPress={() => setWorkerId(p.id)}>
                  <Text style={[styles.chipText, workerId === p.id && styles.chipTextOn]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionHeader}>VOLBY</Text>
        <ToggleRow label="S cenami" description="Sazby, příplatky a částky" value={withPrices} onValueChange={setWithPrices} />
        <ToggleRow label="S mapou tras" description="Jen PDF; jinak jen souhrn km" value={withMap} onValueChange={setWithMap} />
        <ToggleRow label="Podrobně" description="Pobyty s časy a přejezdy; jinak souhrn po dnech" value={detailed} onValueChange={setDetailed} />
        <ToggleRow label="Podpis na konci" description="Podepíšeš se prstem" value={signing} onValueChange={setSigning} />
        {signing && <SignaturePad onChange={setSignature} />}
        <Text style={styles.hint}>Soukromá místa a soukromé jízdy se ve výkazu nikdy nezobrazí.</Text>

        {busy ? (
          <ActivityIndicator color={colors.accent} style={styles.busy} />
        ) : (
          <>
            <TouchableOpacity style={styles.primary} onPress={() => exportAs('pdf')}>
              <Text style={styles.primaryText}>PDF VÝKAZ</Text>
            </TouchableOpacity>
            <View style={styles.row}>
              <TouchableOpacity style={styles.secondary} onPress={() => exportAs('xlsx')}>
                <Text style={styles.secondaryText}>Excel (XLSX)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => exportAs('csv')}>
                <Text style={styles.secondaryText}>CSV</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  sectionHeader: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(12), letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 14, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  chipTextOn: { color: colors.onAccent },
  dates: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  dateInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: MIN_TOUCH, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.card, textAlign: 'center' },
  dash: { color: colors.textMuted, fontSize: fs(18) },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 8, marginBottom: 4 },
  primary: { height: 54, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18), letterSpacing: 1 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  secondary: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  busy: { marginTop: 24 },
});
