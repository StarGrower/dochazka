// Nastavení -> Zápisy (ČÁST 3). Tahle nastavení se SKUTEČNĚ používají
// při zápisu dne (viz lib/workCalc.ts a app/day/[date].tsx) - ne jen
// uložená a nevyužitá.
//
// Oprava 2: délka dne 0 = proměnná pracovní doba (B1); výchozí položky
// jen jako návrh, volitelně jen v pracovní dny (B2); výchozí příplatky
// za víkend/svátek pro všechny stroje (C2).

import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { router, useFocusEffect } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import ToggleRow from '@/components/ToggleRow';
import { getSettings, listCategories, updateSettings } from '@/lib/db';
import type { AppSettings, WorkCategory } from '@/lib/types';
import { colors, fonts, radii, fs } from '@/theme';

export default function ZapisySettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [categories, setCategories] = useState<WorkCategory[]>([]);
  const [dayLengthDraft, setDayLengthDraft] = useState('');
  const [breakDraft, setBreakDraft] = useState('');
  const [weekendDraft, setWeekendDraft] = useState('');
  const [holidayDraft, setHolidayDraft] = useState('');

  const load = useCallback(async () => {
    const [s, cats] = await Promise.all([getSettings(), listCategories()]);
    setSettings(s);
    setCategories(cats);
    setDayLengthDraft(String(s.defaultDayLengthHours));
    setBreakDraft(String(s.breakMinutes));
    setWeekendDraft(String(s.weekendSurchargePct));
    setHolidayDraft(String(s.holidaySurchargePct));
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const patch = async (partial: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...partial } : s));
    await updateSettings(partial);
  };

  const commitDayLength = async () => {
    const value = Number(dayLengthDraft.replace(',', '.'));
    if (!Number.isNaN(value) && value >= 0 && value <= 24) await patch({ defaultDayLengthHours: value });
    else setDayLengthDraft(String(settings?.defaultDayLengthHours ?? 8));
  };

  const commitBreak = async () => {
    const value = Number(breakDraft.replace(',', '.'));
    if (!Number.isNaN(value) && value >= 0) await patch({ breakMinutes: value });
    else setBreakDraft(String(settings?.breakMinutes ?? 30));
  };

  const commitPct = async (draft: string, field: 'weekendSurchargePct' | 'holidaySurchargePct', setDraft: (v: string) => void) => {
    const value = Number(draft.replace(',', '.'));
    if (!Number.isNaN(value) && value >= 0) await patch({ [field]: value });
    else setDraft(String(settings?.[field] ?? 0));
  };

  const toggleDefaultCategory = async (id: number) => {
    if (!settings) return;
    const has = settings.defaultCategoryIds.includes(id);
    const next = has
      ? settings.defaultCategoryIds.filter((x) => x !== id)
      : [...settings.defaultCategoryIds, id];
    await patch({ defaultCategoryIds: next });
  };

  if (!settings) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="ZÁPISY" />

      <FlatList
        data={categories}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Výchozí délka pracovního dne</Text>
              <View style={styles.inlineInputRow}>
                <TextInput
                  style={styles.inlineInput}
                  value={dayLengthDraft}
                  onChangeText={setDayLengthDraft}
                  onBlur={commitDayLength}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                />
                <Text style={styles.unit}>h</Text>
              </View>
            </View>
            <Text style={styles.hint}>
              {settings.defaultDayLengthHours === 0
                ? '0 = proměnná pracovní doba - hodiny se nepředvyplňují, berou se z pobytů nebo ručního zápisu.'
                : 'Předvyplní se u nové hodinové položky. 0 = proměnná pracovní doba.'}
            </Text>

            <SegmentedControl
              label="Zaokrouhlení času"
              value={settings.roundingMinutes}
              onChange={(v) => patch({ roundingMinutes: v })}
              options={[
                { label: 'Bez', value: 0 },
                { label: '15 min', value: 15 },
                { label: '30 min', value: 30 },
                { label: '1 h', value: 60 },
              ]}
            />

            <SegmentedControl
              label="Krok číselníku"
              value={settings.numpadStepHours}
              onChange={(v) => patch({ numpadStepHours: v })}
              options={[
                { label: '0,25 h', value: 0.25 },
                { label: '0,5 h', value: 0.5 },
                { label: '1 h', value: 1 },
              ]}
            />

            <ToggleRow
              label="Automaticky odečítat přestávku"
              value={settings.autoSubtractBreak}
              onValueChange={(v) => patch({ autoSubtractBreak: v })}
            />
            {settings.autoSubtractBreak && (
              <View style={styles.row}>
                <Text style={styles.label}>Délka přestávky</Text>
                <View style={styles.inlineInputRow}>
                  <TextInput
                    style={styles.inlineInput}
                    value={breakDraft}
                    onChangeText={setBreakDraft}
                    onBlur={commitBreak}
                    keyboardType="number-pad"
                    inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                  />
                  <Text style={styles.unit}>min</Text>
                </View>
              </View>
            )}

            <ToggleRow
              label="Poznámka ke dni povinná"
              value={settings.dayNoteRequired}
              onValueChange={(v) => patch({ dayNoteRequired: v })}
            />

            <TouchableOpacity style={styles.row} onPress={() => router.push('/settings/pripominky')}>
              <Text style={styles.label}>Připomenutí zápisu</Text>
              <Text style={styles.unit}>po odjezdu, doma, večer ›</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeader}>PŘÍPLATKY (VÝCHOZÍ PRO VŠECHNY STROJE)</Text>
            <Text style={styles.sectionDescription}>
              U konkrétního stroje jde zadat vlastní % (Stroje a kategorie). Svátek o víkendu = obojí se sčítá.
            </Text>
            <View style={styles.row}>
              <Text style={styles.label}>Víkend</Text>
              <View style={styles.inlineInputRow}>
                <TextInput
                  style={styles.inlineInput}
                  value={weekendDraft}
                  onChangeText={setWeekendDraft}
                  onBlur={() => commitPct(weekendDraft, 'weekendSurchargePct', setWeekendDraft)}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                />
                <Text style={styles.unit}>%</Text>
              </View>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Svátek</Text>
              <View style={styles.inlineInputRow}>
                <TextInput
                  style={styles.inlineInput}
                  value={holidayDraft}
                  onChangeText={setHolidayDraft}
                  onBlur={() => commitPct(holidayDraft, 'holidaySurchargePct', setHolidayDraft)}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                />
                <Text style={styles.unit}>%</Text>
              </View>
            </View>

            <Text style={styles.sectionHeader}>VÝCHOZÍ POLOŽKY NOVÉHO DNE</Text>
            <Text style={styles.sectionDescription}>
              Nic se neukládá samo - vybrané stroje se nabídnou jako návrh, když začneš zapisovat prázdný den (+ Přidat
              / ZAPSAT DNEŠEK). Budoucí dny se nepředvyplňují.
            </Text>
            <ToggleRow
              label="Jen v pracovní dny"
              description="O víkendech a svátcích výchozí položky nenabízet"
              value={settings.defaultsOnlyWorkdays}
              onValueChange={(v) => patch({ defaultsOnlyWorkdays: v })}
            />
          </>
        }
        renderItem={({ item }) => {
          const selected = settings.defaultCategoryIds.includes(item.id);
          return (
            <TouchableOpacity style={styles.categoryRow} onPress={() => toggleDefaultCategory(item.id)}>
              <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
              <Text style={styles.categoryName}>{item.name}</Text>
              {selected && <SymbolView name="checkmark" tintColor={colors.accent} size={18} />}
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inlineInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 56,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: 'center',
  },
  unit: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: fs(12),
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 4,
  },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: -4, marginBottom: 10 },
  sectionDescription: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 10 },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  colorSwatch: { width: 14, height: 14, borderRadius: 3 },
  categoryName: { flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: fs(15) },
});
