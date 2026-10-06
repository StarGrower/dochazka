// Tankování (etapa 6): stroj, palivo, litry, Kč (Kč/l se dopočítá),
// plná nádrž, stav počitadla (fotka + OCR = kotevní bod), účtenka
// (fotka + OCR předvyplní, potvrzuje uživatel), platba, zdroj (pumpa /
// vlastní zásoba). Otevírá se i z upozornění "Tankoval jsi?" (lat/lon/at).

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import ToggleRow from '@/components/ToggleRow';
import { formatKc, formatNumberCs, toIsoDate } from '@/lib/format';
import { parseCounterText, parseReceiptText } from '@/lib/machineCalc';
import {
  COUNTER_LABEL,
  FUEL_LABEL,
  fuelStock,
  listFuelEntries,
  listMachines,
  machineCounter,
  PAYMENT_LABEL,
  saveFuelEntry,
  type FuelPayment,
  type FuelType,
  type MachineCard,
} from '@/lib/machines';
import { takePhoto } from '@/lib/photos';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

const parseNum = (t: string) => {
  const v = Number(t.replace(/\s/g, '').replace(',', '.'));
  return t.trim() && Number.isFinite(v) ? v : null;
};
const pad = (n: number) => String(n).padStart(2, '0');
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

type Photo = { id: number; base64: string };

export default function FuelEditScreen() {
  const params = useLocalSearchParams<{ machineId?: string; lat?: string; lon?: string; at?: string }>();
  const startAt = params.at ? new Date(Number(params.at)) : new Date();
  const [machines, setMachines] = useState<MachineCard[]>([]);
  const [machineId, setMachineId] = useState<number | null>(params.machineId ? Number(params.machineId) : null);
  const [fuelType, setFuelType] = useState<FuelType>('diesel');
  const [liters, setLiters] = useState('');
  const [total, setTotal] = useState('');
  const [fullTank, setFullTank] = useState(true);
  const [counter, setCounter] = useState('');
  const [counterHint, setCounterHint] = useState('');
  const [counterPhoto, setCounterPhoto] = useState<Photo | null>(null);
  const [receiptPhoto, setReceiptPhoto] = useState<Photo | null>(null);
  const [payment, setPayment] = useState<FuelPayment>('own_card');
  const [source, setSource] = useState<'pump' | 'stock'>('pump');
  const [stock, setStock] = useState<{ liters: number; avgPricePerL: number }>({ liters: 0, avgPricePerL: 0 });
  const [date, setDate] = useState(toIsoDate(startAt));
  const [time, setTime] = useState(timeOf(startAt));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const defaulted = useRef(!!params.machineId);
  const machine = machines.find((m) => m.id === machineId) ?? null;

  useEffect(() => {
    let alive = true;
    if (!machine || machine.counterUnit === 'none') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCounterHint('');
      return;
    }
    machineCounter(machine).then((info) => {
      if (alive) setCounterHint(info.estimate ? `odhad ≈ ${formatNumberCs(Math.round(info.estimate.value))} ${COUNTER_LABEL[machine.counterUnit]}` : '');
    });
    return () => {
      alive = false;
    };
  }, [machine]);

  const load = useCallback(async () => {
    const list = await listMachines();
    setMachines(list);
    setStock(await fuelStock());
    // Předvolby podle posledního tankování (palivo, platba, stroj).
    const last = (await listFuelEntries())[0];
    if (last) {
      setFuelType(last.fuelType);
      setPayment(last.payment);
    }
    if (!defaulted.current) {
      defaulted.current = true;
      setMachineId(last?.categoryId ?? list[0]?.id ?? null);
    }
  }, [setMachines, setStock, setFuelType, setPayment, setMachineId]);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const litersN = parseNum(liters);
  const totalN = parseNum(total);
  const effectiveTotal = source === 'stock' && litersN ? Math.round(litersN * stock.avgPricePerL * 100) / 100 : totalN;
  const perL = litersN && effectiveTotal ? effectiveTotal / litersN : null;

  const withBusy = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      Alert.alert('Nepovedlo se', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const photoCounter = () =>
    withBusy(async () => {
      const p = await takePhoto('camera', true);
      if (!p) return;
      setCounterPhoto(p);
      const v = parseCounterText(p.lines);
      if (v !== null) setCounter(formatNumberCs(v));
      else Alert.alert('Nerozpoznáno', 'Stav počitadla se z fotky nepodařilo přečíst - zadej ho ručně.');
    });

  const photoReceipt = (fromLibrary: boolean) =>
    withBusy(async () => {
      const p = await takePhoto(fromLibrary ? 'library' : 'camera', true);
      if (!p) return;
      setReceiptPhoto(p);
      const g = parseReceiptText(p.lines);
      if (g.liters !== null) setLiters(formatNumberCs(g.liters));
      if (g.totalKc !== null) setTotal(formatNumberCs(g.totalKc));
      else if (g.liters !== null && g.pricePerL !== null) setTotal(formatNumberCs(Math.round(g.liters * g.pricePerL * 100) / 100));
      if (g.date) setDate(g.date);
      const found = [g.liters !== null && 'litry', (g.totalKc !== null || g.pricePerL !== null) && 'cena', g.date && 'datum'].filter(Boolean);
      Alert.alert(
        found.length ? 'Z účtenky předvyplněno' : 'Nerozpoznáno',
        found.length ? `${found.join(', ')} - zkontroluj a případně oprav.` : 'Údaje z účtenky se nepodařilo přečíst - zadej je ručně. Fotka zůstane uložená.'
      );
    });

  const save = async () => {
    if (!litersN || litersN <= 0) {
      Alert.alert('Chybí litry', 'Zadej natankované litry.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
      Alert.alert('Datum a čas', 'Datum zadej jako RRRR-MM-DD a čas jako HH:MM.');
      return;
    }
    if (source === 'stock' && litersN > stock.liters + 0.01) {
      Alert.alert('Málo nafty v zásobě', `V zásobě je jen ${formatNumberCs(Math.round(stock.liters))} l. Doplň nákup v Zásobě nafty.`);
      return;
    }
    const [h, mi] = time.split(':').map(Number);
    const at = new Date(`${date}T00:00:00`);
    at.setHours(h, mi, 0, 0);
    let lat = params.lat ? Number(params.lat) : null;
    let lon = params.lon ? Number(params.lon) : null;
    if (lat === null) {
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last && Math.abs(last.timestamp - at.getTime()) < 30 * 60 * 1000) {
        lat = last.coords.latitude;
        lon = last.coords.longitude;
      }
    }
    await saveFuelEntry({
      categoryId: machineId,
      fueledAt: at.toISOString(),
      liters: litersN,
      priceTotalKc: effectiveTotal,
      pricePerL: perL,
      fuelType,
      fullTank,
      counterValue: machine && machine.counterUnit !== 'none' ? parseNum(counter) : null,
      counterPhotoId: counterPhoto?.id ?? null,
      receiptPhotoId: receiptPhoto?.id ?? null,
      latitude: lat,
      longitude: lon,
      payment: source === 'stock' ? 'company_card' : payment,
      source,
      note: note.trim(),
    });
    router.back();
  };

  const chip = <T extends string>(value: T, current: T, label: string, set: (v: T) => void) => (
    <TouchableOpacity key={value} style={[styles.chip, current === value && styles.chipOn]} onPress={() => set(value)}>
      <Text style={[styles.chipText, current === value && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="TANKOVÁNÍ" onBack={() => router.back()} right={busy ? <ActivityIndicator color={colors.accent} /> : undefined} />
      <ScrollView contentContainerStyle={styles.sc} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>STROJ</Text>
        <View style={styles.chips}>
          {machines.map((m) => (
            <TouchableOpacity key={m.id} style={[styles.chip, machineId === m.id && styles.chipOn]} onPress={() => setMachineId(m.id)}>
              <Text style={[styles.chipText, machineId === m.id && styles.chipTextOn]}>{m.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.chip, machineId === null && styles.chipOn]} onPress={() => setMachineId(null)}>
            <Text style={[styles.chipText, machineId === null && styles.chipTextOn]}>Kanystr / jiné</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>ZDROJ</Text>
        <View style={styles.chips}>
          {chip('pump', source, 'Čerpací stanice', setSource)}
          {chip('stock', source, `Vlastní zásoba (${formatNumberCs(Math.round(stock.liters))} l)`, setSource)}
        </View>

        {source === 'pump' && (
          <View style={styles.row2}>
            <TouchableOpacity style={styles.btn} onPress={() => photoReceipt(false)} disabled={busy}>
              <Text style={styles.btnText}>Vyfotit účtenku</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => photoReceipt(true)} disabled={busy}>
              <Text style={styles.btnText}>Z galerie</Text>
            </TouchableOpacity>
          </View>
        )}
        {receiptPhoto && <Image source={{ uri: `data:image/jpeg;base64,${receiptPhoto.base64}` }} style={styles.photo} resizeMode="contain" />}

        <View style={styles.chips}>{(Object.keys(FUEL_LABEL) as FuelType[]).map((f) => chip(f, fuelType, FUEL_LABEL[f], setFuelType))}</View>

        <View style={styles.row2}>
          <View style={styles.flex}>
            <Text style={styles.label}>Litry</Text>
            <TextInput style={styles.input} value={liters} onChangeText={setLiters} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>Celkem Kč</Text>
            {source === 'stock' ? (
              <Text style={styles.computed}>{effectiveTotal !== null ? formatKc(effectiveTotal) : '—'}</Text>
            ) : (
              <TextInput style={styles.input} value={total} onChangeText={setTotal} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
            )}
          </View>
        </View>
        <Text style={styles.hint}>
          {perL !== null ? `${formatNumberCs(Math.round(perL * 100) / 100)} Kč/l` : 'Kč/l se dopočítá.'}
          {source === 'stock' ? ' · za průměrnou cenu zásoby' : ''}
        </Text>

        <ToggleRow label="Plná nádrž" description="Spotřeba se počítá mezi dvěma plnými nádržemi" value={fullTank} onValueChange={setFullTank} />

        {machine && machine.counterUnit !== 'none' && (
          <>
            <Text style={styles.label}>
              Stav počitadla ({COUNTER_LABEL[machine.counterUnit]}){counterHint ? ` · ${counterHint}` : ''}
            </Text>
            <View style={styles.row2}>
              <TextInput style={[styles.input, styles.flex]} value={counter} onChangeText={setCounter} keyboardType="decimal-pad" placeholder="volitelné" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
              <TouchableOpacity style={styles.btnNarrow} onPress={photoCounter} disabled={busy}>
                <Text style={styles.btnText}>Vyfotit</Text>
              </TouchableOpacity>
            </View>
            {counterPhoto && <Image source={{ uri: `data:image/jpeg;base64,${counterPhoto.base64}` }} style={styles.photoSmall} resizeMode="contain" />}
          </>
        )}

        {source === 'pump' && (
          <>
            <Text style={styles.section}>PLATBA</Text>
            <View style={styles.chips}>{(Object.keys(PAYMENT_LABEL) as FuelPayment[]).map((p) => chip(p, payment, PAYMENT_LABEL[p], setPayment))}</View>
            {payment !== 'company_card' && <Text style={styles.hint}>Půjde do K PROPLACENÍ.</Text>}
          </>
        )}

        <View style={styles.row2}>
          <View style={styles.flex}>
            <Text style={styles.label}>Datum</Text>
            <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="RRRR-MM-DD" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>Čas</Text>
            <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          </View>
        </View>
        <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Poznámka" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />

        <TouchableOpacity style={styles.cta} onPress={save} disabled={busy}>
          <Text style={styles.ctaText}>ULOŽIT TANKOVÁNÍ</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  sc: { paddingHorizontal: 16, gap: 10, paddingBottom: 40 },
  section: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1.1, marginTop: 6 },
  label: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.card },
  computed: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(18), minHeight: 48, textAlignVertical: 'center', paddingTop: 12 },
  row2: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  chipTextOn: { color: colors.onAccent },
  btn: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  btnNarrow: { minHeight: 48, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  photo: { width: '100%', height: 180, borderRadius: radii.card, backgroundColor: colors.card },
  photoSmall: { width: '100%', height: 110, borderRadius: radii.card, backgroundColor: colors.card },
  cta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18), letterSpacing: 0.9 },
});
