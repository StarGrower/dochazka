// Detail dne (vizuální směr "A · Stavba"). Mapa a "PRŮBĖH DNE"
// (zastávky/přejezdy) ze zadání patří do etapy 3 (potřebují záznam
// polohy) - místo mrtvého UI je tu jen stručná poznámka, že to přibude
// později. "PRÁCE A STROJE" je etapa 1 obsah, restylovaná podle zadání
// + přepínač "upravit"/"hotovo" v záhlaví (vlastní rozhodnutí): výchozí
// pohled jsou čisté karty beze vstupů (jak design popisuje), teprve
// "upravit" odhalí NumPad, mazání a tlačítko pro přidání položky.
//
// ČÁST 3 (Nastavení -> Zápisy) se tu SKUTEČNĚ používá:
// - výchozí položky nového dne (applyDayDefaultsIfNeeded, jen 1. návštěva)
// - krok číselníku a zaokrouhlení (NumPad, viz lib/workCalc.ts)
// - poznámka povinná (varování při odchodu, pokud je prázdná)
// - hmatová odezva (NumPad kroky, uložení)

import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import NumPad from '@/components/NumPad';
import ScreenHeader from '@/components/ScreenHeader';
import {
  addDayRecord,
  deleteDayRecord,
  getDayNote,
  getDayRecords,
  getSettings,
  listCategories,
  setDayNote,
  updateDayRecordQuantity,
} from '@/lib/db';
import { formatDayHeaderSummary, formatDayHeaderTitle, formatKc } from '@/lib/format';
import { tapHaptic } from '@/lib/haptics';
import type { AppSettings, DayWorkRecordWithCategory, WorkCategory } from '@/lib/types';
import { applyDayDefaultsIfNeeded, applyRounding } from '@/lib/workCalc';
import { colors, fonts, radii } from '@/theme';

export default function DayDetailScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();

  const [records, setRecords] = useState<DayWorkRecordWithCategory[]>([]);
  const [note, setNote] = useState('');
  const [categories, setCategories] = useState<WorkCategory[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const load = useCallback(async () => {
    if (!date) return;
    const loadedSettings = await getSettings();
    setSettings(loadedSettings);
    // Výchozí položky nového dne - jen při první (prázdné) návštěvě,
    // viz lib/workCalc.ts.
    await applyDayDefaultsIfNeeded(date, loadedSettings);

    const [r, n, c] = await Promise.all([getDayRecords(date), getDayNote(date), listCategories()]);
    setRecords(r);
    setNote(n);
    setCategories(c);
  }, [date]);

  useFocusEffect(() => {
    load();
  });

  const handleQuantityChange = async (recordId: number, quantity: number) => {
    setRecords((current) => current.map((r) => (r.id === recordId ? { ...r, quantity } : r)));
    await updateDayRecordQuantity(recordId, quantity);
  };

  const handleAddCategory = async (categoryId: number) => {
    if (!date) return;
    tapHaptic(!!settings?.hapticsEnabled);
    await addDayRecord(date, categoryId, 0);
    setPickerOpen(false);
    await load();
  };

  const handleDeleteRecord = (record: DayWorkRecordWithCategory) => {
    Alert.alert('Smazat položku', `Smazat "${record.categoryName}" z tohoto dne?`, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          tapHaptic(!!settings?.hapticsEnabled);
          await deleteDayRecord(record.id);
          await load();
        },
      },
    ]);
  };

  const handleNoteBlur = async () => {
    if (!date) return;
    await setDayNote(date, note);
  };

  const noteMissing = !!settings?.dayNoteRequired && note.trim() === '';

  const handleBack = () => {
    if (noteMissing) {
      Alert.alert('Chybí poznámka', 'Nastavení vyžaduje poznámku ke dni. Opravdu odejít bez ní?', [
        { text: 'Zpět k zápisu', style: 'cancel' },
        { text: 'Odejít', onPress: () => router.back() },
      ]);
      return;
    }
    router.back();
  };

  const totals = records.reduce(
    (acc, r) => {
      acc.kc += r.quantity * r.rateKc;
      if (r.rateType === 'hourly') acc.hours += r.quantity;
      else acc.days += r.quantity;
      return acc;
    },
    { kc: 0, hours: 0, days: 0 }
  );

  // Kategorie, co ještě nejsou dnes použité - v pickeru nemá smysl
  // nabízet duplicitní přidání téhož stroje dvakrát.
  const usedIds = new Set(records.map((r) => r.categoryId));
  const pickerOptions = categories.filter((c) => !usedIds.has(c.id));

  if (!date || !settings) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={formatDayHeaderTitle(date)}
        subtitle={formatDayHeaderSummary(totals.hours, null)}
        onBack={handleBack}
        right={
          <TouchableOpacity onPress={() => setEditMode((v) => !v)} hitSlop={8}>
            <Text style={styles.editToggleText}>{editMode ? 'HOTOVO' : 'UPRAVIT'}</Text>
          </TouchableOpacity>
        }
      />

      <FlatList
        data={records}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapPlaceholderText}>
                Mapa a průběh dne (zastávky, přejezdy) budou v etapě 3 - potřebují záznam polohy.
              </Text>
            </View>
            <Text style={styles.sectionHeader}>PRÁCE A STROJE</Text>
          </>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
            <View style={styles.rowMain}>
              <View style={styles.rowNameLine}>
                <Text style={styles.rowName}>
                  {item.categoryName}
                  {item.categoryDeleted ? ' (smazáno)' : ''}
                </Text>
                {item.rateType === 'daily' && (
                  <View style={styles.dailyBadge}>
                    <Text style={styles.dailyBadgeText}>DENNÍ</Text>
                  </View>
                )}
              </View>
              {editMode && (
                <Text style={styles.rowRate}>
                  {formatKc(item.rateKc)} / {item.rateType === 'hourly' ? 'hodinu' : 'den'}
                </Text>
              )}
            </View>

            {editMode ? (
              <>
                <NumPad
                  value={item.quantity}
                  step={item.rateType === 'hourly' ? settings.numpadStepHours : 0.5}
                  unitLabel={item.rateType === 'hourly' ? 'h' : 'd'}
                  onChange={(next) => handleQuantityChange(item.id, next)}
                  roundTypedValue={
                    item.rateType === 'hourly' ? (v) => applyRounding(v, settings.roundingMinutes) : undefined
                  }
                  hapticsEnabled={settings.hapticsEnabled}
                />
                <TouchableOpacity onPress={() => handleDeleteRecord(item)} hitSlop={10}>
                  <Text style={styles.deleteLabel}>Smazat</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.rowQuantity}>
                {item.quantity} {item.rateType === 'hourly' ? 'h' : item.quantity === 1 ? 'den' : 'dní'}
              </Text>
            )}
          </View>
        )}
        ListFooterComponent={
          <>
            {editMode && (
              <TouchableOpacity style={styles.addRowButton} onPress={() => setPickerOpen(true)}>
                <Text style={styles.addRowButtonText}>+ Přidat stroj nebo práci</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.fieldLabel}>
              Poznámka{settings.dayNoteRequired ? ' *' : ''}
            </Text>
            <TextInput
              style={[styles.noteInput, noteMissing && styles.noteInputRequired]}
              value={note}
              onChangeText={setNote}
              onBlur={handleNoteBlur}
              multiline
              placeholder={settings.dayNoteRequired ? 'Poznámka je povinná' : 'Volitelná poznámka ke dni'}
              placeholderTextColor={colors.textMuted}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          </>
        }
        ListEmptyComponent={<Text style={styles.empty}>Zatím žádné položky pro tenhle den.</Text>}
      />

      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {totals.hours > 0 ? `${formatNumber(totals.hours)} h` : ''}
          {totals.hours > 0 && totals.days > 0 ? '  +  ' : ''}
          {totals.days > 0 ? `${formatNumber(totals.days)} d` : ''}
        </Text>
        <Text style={styles.summaryKc}>{formatKc(totals.kc)}</Text>
      </View>

      <BottomSheetModal visible={pickerOpen} onClose={() => setPickerOpen(false)}>
        <Text style={styles.modalTitle}>PŘIDAT POLOŽKU</Text>
        <FlatList
          data={pickerOptions}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.pickerRow} onPress={() => handleAddCategory(item.id)}>
              <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
              <Text style={styles.pickerRowName}>{item.name}</Text>
              <Text style={styles.pickerRowRate}>
                {formatKc(item.rateKc)} / {item.rateType === 'hourly' ? 'hodinu' : 'den'}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Všechny kategorie jsou už pro tenhle den přidané.</Text>
          }
        />
        <TouchableOpacity style={styles.cancelButton} onPress={() => setPickerOpen(false)}>
          <Text style={styles.cancelButtonText}>Zavřít</Text>
        </TouchableOpacity>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

function formatNumber(n: number): string {
  return (Math.round(n * 100) / 100).toString().replace('.', ',');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  editToggleText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: 13, letterSpacing: 0.5 },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  mapPlaceholder: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 16,
  },
  mapPlaceholderText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textAlign: 'center' },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  colorSwatch: { width: 14, height: 14, borderRadius: 3 },
  rowMain: { flex: 1 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15 },
  rowRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  dailyBadge: {
    backgroundColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dailyBadgeText: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: 9, letterSpacing: 0.5 },
  rowQuantity: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: 16 },
  deleteLabel: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: 13, marginLeft: 4 },
  empty: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.body, marginVertical: 16 },
  addRowButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radii.card,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  addRowButtonText: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: 14 },
  fieldLabel: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: fonts.body,
    minHeight: 60,
    textAlignVertical: 'top',
    color: colors.text,
    backgroundColor: colors.card,
  },
  noteInputRequired: { borderColor: colors.danger },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  summaryText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
  summaryKc: { color: colors.text, fontFamily: fonts.headingBold, fontSize: 18 },
  modalTitle: {
    color: colors.text,
    fontFamily: fonts.headingBold,
    fontSize: 16,
    letterSpacing: 1,
    marginBottom: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerRowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15, flex: 1 },
  pickerRowRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
  cancelButton: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  cancelButtonText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 15 },
});
