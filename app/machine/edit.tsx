// Nový stroj (ze šablony) / úprava karty stroje (etapa 6). Sazby za
// hodinu, den a km zůstávají v Nastavení → Stroje a kategorie.

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import { formatNumberCs, todayIso } from '@/lib/format';
import {
  COUNTER_LABEL,
  createMachine,
  getMachine,
  listTemplates,
  saveMachineCard,
  saveTemplateFromMachine,
  type CounterUnit,
  type MachineCard,
  type MachineTemplate,
} from '@/lib/machines';
import DochazkaNative from '../../modules/dochazka-native/src/DochazkaNative';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

const parseNum = (t: string) => {
  const v = Number(t.replace(/\s/g, '').replace(',', '.'));
  return t.trim() && Number.isFinite(v) ? v : null;
};

export default function MachineEditScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : null;
  const [machine, setMachine] = useState<MachineCard | null>(null);
  const [templates, setTemplates] = useState<MachineTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [unit, setUnit] = useState<CounterUnit>('mth');
  const [startValue, setStartValue] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [bluetooth, setBluetooth] = useState('');

  const load = useCallback(async () => {
    setTemplates(await listTemplates());
    if (editId === null) return;
    const m = await getMachine(editId);
    if (!m) return;
    setMachine(m);
    setName(m.name);
    setManufacturer(m.manufacturer);
    setModel(m.model);
    setSerial(m.serialNumber);
    setYear(m.yearBuilt ? String(m.yearBuilt) : '');
    setPlate(m.plate);
    setUnit(m.counterUnit);
    setStartValue(m.counterStartValue !== null ? formatNumberCs(m.counterStartValue) : '');
    setStartDate(m.counterStartDate ?? todayIso());
    setBluetooth(m.bluetoothName);
    setTemplateId(m.templateId);
  }, [editId]);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const pickTemplate = (t: MachineTemplate | null) => {
    setTemplateId(t?.id ?? null);
    if (t) {
      setUnit(t.counterUnit);
      if (!name.trim()) setName(t.name);
    }
  };

  const readBluetooth = () => {
    let route = '';
    try {
      route = DochazkaNative.bluetoothAudioRoute();
    } catch {
      route = '';
    }
    if (route) setBluetooth(route);
    else Alert.alert('Nic nepřipojeno', 'Telefon teď není připojený k Bluetooth audiu vozidla. Připoj se v autě a zkus to znovu.');
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Chybí název', 'Zadej název stroje.');
      return;
    }
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      Alert.alert('Datum', 'Datum zadej jako RRRR-MM-DD.');
      return;
    }
    let id = editId;
    if (id === null) {
      id = await createMachine(name.trim(), templates.find((t) => t.id === templateId) ?? null, unit);
    }
    await saveMachineCard(id, {
      name: name.trim(),
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      serialNumber: serial.trim(),
      yearBuilt: parseNum(year),
      plate: plate.trim(),
      counterUnit: unit,
      counterStartValue: parseNum(startValue),
      counterStartDate: startDate || null,
      templateId,
      bluetoothName: bluetooth.trim(),
    });
    if (editId === null) router.replace(`/machine/${id}`);
    else router.back();
  };

  const saveAsTemplate = () =>
    Alert.prompt?.('Uložit jako šablonu', 'Název šablony (servisní plán stroje se uloží pro další stroje)', async (t) => {
      if (!t?.trim() || editId === null) return;
      await saveTemplateFromMachine(editId, t.trim());
      Alert.alert('Uloženo', `Šablona „${t.trim()}“ je k dispozici u nového stroje.`);
      await load();
    });

  const field = (label: string, value: string, set: (t: string) => void, opts: { placeholder?: string; numeric?: boolean } = {}) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={set}
        placeholder={opts.placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={opts.numeric ? 'decimal-pad' : 'default'}
        inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={editId === null ? 'NOVÝ STROJ' : 'KARTA STROJE'} subtitle={machine?.name} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.sc} keyboardShouldPersistTaps="handled">
        {editId === null && (
          <>
            <Text style={styles.section}>ŠABLONA</Text>
            <View style={styles.chips}>
              <TouchableOpacity style={[styles.chip, templateId === null && styles.chipOn]} onPress={() => pickTemplate(null)}>
                <Text style={[styles.chipText, templateId === null && styles.chipTextOn]}>Bez šablony</Text>
              </TouchableOpacity>
              {templates.map((t) => (
                <TouchableOpacity key={t.id} style={[styles.chip, templateId === t.id && styles.chipOn]} onPress={() => pickTemplate(t)}>
                  <Text style={[styles.chipText, templateId === t.id && styles.chipTextOn]}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {templateId !== null && (
              <Text style={styles.hint}>
                Servisní plán: {templates.find((t) => t.id === templateId)?.plan.map((p) => p.name).join(', ') || '—'}. Intervaly upravíš na kartě stroje.
              </Text>
            )}
          </>
        )}

        <Text style={styles.section}>KARTA</Text>
        {field('Název', name, setName, { placeholder: 'Např. Bagr JCB' })}
        {field('Výrobce', manufacturer, setManufacturer)}
        {field('Model / typ', model, setModel)}
        {field('Výrobní číslo', serial, setSerial)}
        <View style={styles.row2}>
          <View style={styles.flex}>{field('Rok výroby', year, setYear, { numeric: true })}</View>
          <View style={styles.flex}>{field('SPZ', plate, setPlate)}</View>
        </View>

        <SegmentedControl
          label="Počitadlo"
          options={[
            { label: 'Motohodiny', value: 'mth' },
            { label: 'Kilometry', value: 'km' },
            { label: 'Žádné', value: 'none' },
          ]}
          value={unit}
          onChange={setUnit}
        />
        {unit !== 'none' && (
          <>
            <View style={styles.row2}>
              <View style={styles.flex}>{field(`Počáteční stav (${COUNTER_LABEL[unit]})`, startValue, setStartValue, { numeric: true })}</View>
              <View style={styles.flex}>{field('K datu', startDate, setStartDate, { placeholder: 'RRRR-MM-DD' })}</View>
            </View>
            <Text style={styles.hint}>
              Odhad stavu = počáteční stav / poslední zadaný + {unit === 'km' ? 'km z přejezdů' : 'zapsané hodiny práce'} × naučený poměr.
            </Text>
          </>
        )}

        {unit === 'km' && (
          <>
            {field('Bluetooth vozidla', bluetooth, setBluetooth, { placeholder: 'Název Bluetooth audia v autě' })}
            <TouchableOpacity style={styles.btn} onPress={readBluetooth}>
              <Text style={styles.btnText}>Načíst právě připojené</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>Podle Bluetooth appka navrhne vozidlo jízdy v knize jízd (jen návrh).</Text>
          </>
        )}

        <TouchableOpacity style={styles.cta} onPress={save}>
          <Text style={styles.ctaText}>{editId === null ? 'VYTVOŘIT STROJ' : 'ULOŽIT'}</Text>
        </TouchableOpacity>
        {editId !== null && (
          <View style={styles.row2}>
            <TouchableOpacity style={styles.btn} onPress={saveAsTemplate}>
              <Text style={styles.btnText}>Uložit jako šablonu</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => router.push('/settings/categories')}>
              <Text style={styles.btnText}>Sazby stroje</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  sc: { paddingHorizontal: 16, gap: 10, paddingBottom: 40 },
  section: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1.1, marginTop: 8 },
  field: { gap: 4 },
  label: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.card },
  row2: { flexDirection: 'row', gap: 8 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  chipTextOn: { color: colors.onAccent },
  btn: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  btnText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  cta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18), letterSpacing: 0.9 },
});
