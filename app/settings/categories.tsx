// Nastavení -> Stroje a kategorie (ČÁST 3 - přesunuto z dřívějšího
// app/(tabs)/nastaveni.tsx, + ČÁST 1 oprava klávesnice přes
// BottomSheetModal/KeyboardDoneAccessory, + ČÁST 2 vlastní barva přes
// ColorPicker, + nové pole "kind" (typ stroj/práce).
//
// Oprava 2: sazby Kč/h, Kč/den a Kč/km zároveň, jedna výchozí (C1);
// vlastní příplatek za víkend/svátek - prázdné pole = výchozí z
// Nastavení -> Zápisy, 0 = bez příplatku (C2). Obsah panelu se roluje
// (je delší než obrazovka) a klepnutí mimo pole zavře klávesnici (C3).

import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import ColorPicker, { isValidHex } from '@/components/ColorPicker';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import NumPad from '@/components/NumPad';
import ScreenHeader from '@/components/ScreenHeader';
import {
  addRecentCustomColor,
  createCategory,
  deleteCategory,
  getSettings,
  listCategories,
  updateCategory,
} from '@/lib/db';
import { formatKc, formatNumberCs, UNIT_RATE_LABEL } from '@/lib/format';
import type { AppSettings, CategoryKind, RateUnit, WorkCategory } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { categoryPalette, colors, fonts, paletteColorAt, radii, MIN_TOUCH, fs } from '@/theme';

type EditingState = {
  id: number | null;
  name: string;
  rates: Record<RateUnit, number>;
  defaultUnit: RateUnit;
  // Textová pole příplatků: '' = výchozí z Nastavení (null v DB).
  weekendDraft: string;
  holidayDraft: string;
  color: string;
  kind: CategoryKind;
};

const UNITS: RateUnit[] = ['hour', 'day', 'km'];
const UNIT_LONG: Record<RateUnit, string> = { hour: 'Kč / hodinu', day: 'Kč / den', km: 'Kč / km' };

function pctToDraft(pct: number | null): string {
  return pct === null ? '' : formatNumberCs(pct);
}

// '' -> null (výchozí); neplatné číslo -> undefined (chyba).
function draftToPct(draft: string): number | null | undefined {
  if (draft.trim() === '') return null;
  const value = Number(draft.replace(',', '.'));
  return Number.isNaN(value) || value < 0 ? undefined : value;
}

// Krok 10 Kč - sazby se obvykle zadávají v desítkách/stovkách, ne po
// 0,25 jako hodiny (viz zadání ČÁST 3 bod 3 - "stejné ovládání",
// nemusí to být stejný KROK).
const RATE_STEP_KC = 10;

function emptyEditing(): EditingState {
  return {
    id: null,
    name: '',
    rates: { hour: 0, day: 0, km: 0 },
    defaultUnit: 'hour',
    weekendDraft: '',
    holidayDraft: '',
    color: paletteColorAt(0),
    kind: 'machine',
  };
}

// "850 Kč/h · 12 Kč/km" - výchozí sazba první, nulové vynechat.
function ratesSummary(c: WorkCategory): string {
  const ordered = [c.defaultUnit, ...UNITS.filter((u) => u !== c.defaultUnit)];
  const parts = ordered.filter((u) => u === c.defaultUnit || c.rates[u] > 0).map((u) => `${formatKc(c.rates[u])}/${UNIT_RATE_LABEL[u].split('/')[1]}`);
  return parts.join(' · ');
}

export default function CategoriesSettingsScreen() {
  const [categories, setCategories] = useState<WorkCategory[]>([]);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const load = useCallback(async () => {
    const [cats, s] = await Promise.all([listCategories(), getSettings()]);
    setCategories(cats);
    setRecentColors(s.recentCustomColors);
    setSettings(s);
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openAdd = () => setEditing(emptyEditing());
  const openEdit = (c: WorkCategory) =>
    setEditing({
      id: c.id,
      name: c.name,
      rates: { ...c.rates },
      defaultUnit: c.defaultUnit,
      weekendDraft: pctToDraft(c.weekendPct),
      holidayDraft: pctToDraft(c.holidayPct),
      color: c.color,
      kind: c.kind,
    });

  const handleSave = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      Alert.alert('Chybí název', 'Zadej název kategorie nebo stroje.');
      return;
    }
    if (!isValidHex(editing.color)) {
      Alert.alert('Neplatná barva', 'Zadej platný hex kód barvy.');
      return;
    }
    const weekendPct = draftToPct(editing.weekendDraft);
    const holidayPct = draftToPct(editing.holidayDraft);
    if (weekendPct === undefined || holidayPct === undefined) {
      Alert.alert('Neplatný příplatek', 'Příplatek zadej jako číslo v %, nebo pole nech prázdné (= výchozí).');
      return;
    }
    setSaving(true);
    try {
      const fields = {
        name,
        rates: editing.rates,
        defaultUnit: editing.defaultUnit,
        weekendPct,
        holidayPct,
        color: editing.color,
        kind: editing.kind,
      };
      if (editing.id === null) {
        await createCategory(fields);
      } else {
        await updateCategory(editing.id, fields);
      }
      if (!(categoryPalette as readonly string[]).includes(editing.color)) {
        await addRecentCustomColor(editing.color);
      }
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (c: WorkCategory) => {
    Alert.alert(
      'Smazat kategorii',
      `Smazat "${c.name}"? Dřívější záznamy ve dnech zůstanou zachované.`,
      [
        { text: 'Zrušit', style: 'cancel' },
        {
          text: 'Smazat',
          style: 'destructive',
          onPress: async () => {
            await deleteCategory(c.id);
            await load();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="STROJE A KATEGORIE" />

      <FlatList
        data={categories}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => openEdit(item)}>
            <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
            <SymbolView
              name={item.kind === 'machine' ? 'wrench.and.screwdriver' : 'hand.raised'}
              tintColor={colors.textMuted}
              size={16}
            />
            <View style={styles.rowMain}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowRate}>{ratesSummary(item)}</Text>
            </View>
            <Pressable hitSlop={12} onPress={() => handleDelete(item)}>
              <Text style={styles.deleteLabel}>Smazat</Text>
            </Pressable>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Zatím žádné kategorie.</Text>}
      />

      <TouchableOpacity style={styles.addButton} onPress={openAdd}>
        <Text style={styles.addButtonText}>+ PŘIDAT KATEGORII / STROJ</Text>
      </TouchableOpacity>

      <BottomSheetModal visible={editing !== null} onClose={() => setEditing(null)}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.modalTitle}>{editing?.id === null ? 'NOVÁ KATEGORIE / STROJ' : 'UPRAVIT'}</Text>

        <Text style={styles.fieldLabel}>Název</Text>
        <TextInput
          style={styles.input}
          value={editing?.name ?? ''}
          onChangeText={(t) => setEditing((e) => (e ? { ...e, name: t } : e))}
          placeholder="např. Tatra"
          placeholderTextColor={colors.textMuted}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />

        <Text style={styles.fieldLabel}>Typ</Text>
        <View style={styles.segmentRow}>
          <SegmentButton
            label="Stroj"
            active={editing?.kind === 'machine'}
            onPress={() => setEditing((e) => (e ? { ...e, kind: 'machine' } : e))}
          />
          <SegmentButton
            label="Práce"
            active={editing?.kind === 'labor'}
            onPress={() => setEditing((e) => (e ? { ...e, kind: 'labor' } : e))}
          />
        </View>

        <Text style={styles.fieldLabel}>Sazby (výchozí jednotku vyber klepnutím vlevo)</Text>
        {editing &&
          UNITS.map((u) => (
            <View key={u} style={styles.rateRow}>
              <TouchableOpacity
                style={[styles.defaultUnitButton, editing.defaultUnit === u && styles.defaultUnitButtonActive]}
                onPress={() => setEditing((e) => (e ? { ...e, defaultUnit: u } : e))}
              >
                <Text style={[styles.defaultUnitText, editing.defaultUnit === u && styles.defaultUnitTextActive]}>
                  {UNIT_LONG[u]}
                </Text>
                {editing.defaultUnit === u && <Text style={styles.defaultUnitBadge}>VÝCHOZÍ</Text>}
              </TouchableOpacity>
              <NumPad
                value={editing.rates[u]}
                step={u === 'km' ? 1 : RATE_STEP_KC}
                unitLabel="Kč"
                onChange={(next) => setEditing((e) => (e ? { ...e, rates: { ...e.rates, [u]: next } } : e))}
              />
            </View>
          ))}

        <Text style={styles.fieldLabel}>Příplatky (prázdné = výchozí, 0 = bez příplatku)</Text>
        {editing && (
          <>
            <SurchargeRow
              label="Víkend"
              draft={editing.weekendDraft}
              defaultPct={settings.weekendSurchargePct}
              onChange={(t) => setEditing((e) => (e ? { ...e, weekendDraft: t } : e))}
            />
            <SurchargeRow
              label="Svátek"
              draft={editing.holidayDraft}
              defaultPct={settings.holidaySurchargePct}
              onChange={(t) => setEditing((e) => (e ? { ...e, holidayDraft: t } : e))}
            />
          </>
        )}

        <Text style={styles.fieldLabel}>Barva</Text>
        {editing && (
          <ColorPicker
            value={editing.color}
            onChange={(hex) => setEditing((e) => (e ? { ...e, color: hex } : e))}
            recentColors={recentColors}
          />
        )}

        <View style={styles.modalButtons}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setEditing(null)}>
            <Text style={styles.cancelButtonText}>Zrušit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
            <Text style={styles.saveButtonText}>{saving ? 'UKLÁDÁM...' : 'ULOŽIT'}</Text>
          </TouchableOpacity>
        </View>
        </ScrollView>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

// "Víkend: výchozí (25 %)" / "Víkend: 40 % (vlastní)" (zadání C2).
function SurchargeRow({
  label,
  draft,
  defaultPct,
  onChange,
}: {
  label: string;
  draft: string;
  defaultPct: number;
  onChange: (text: string) => void;
}) {
  const custom = draft.trim() !== '';
  return (
    <View style={styles.rateRow}>
      <Text style={styles.surchargeLabel}>
        {label}: {custom ? `${draft} % (vlastní)` : `výchozí (${formatNumberCs(defaultPct)} %)`}
      </Text>
      <View style={styles.surchargeInputRow}>
        <TextInput
          style={styles.surchargeInput}
          value={draft}
          onChangeText={onChange}
          placeholder={formatNumberCs(defaultPct)}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <Text style={styles.surchargeUnit}>%</Text>
      </View>
    </View>
  );
}

function SegmentButton({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.segmentButton, active && styles.segmentButtonActive]} onPress={onPress}>
      <Text style={[styles.segmentButtonText, active && styles.segmentButtonTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingHorizontal: 16, paddingTop: 8 },
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
  colorSwatch: { width: 16, height: 16, borderRadius: 4 },
  rowMain: { flex: 1 },
  rowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  rowRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 2 },
  deleteLabel: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  empty: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.body, marginTop: 24 },
  addButton: {
    height: 54,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
  modalTitle: {
    color: colors.text,
    fontFamily: fonts.headingBold,
    fontSize: fs(17),
    letterSpacing: 1,
    marginBottom: 16,
  },
  fieldLabel: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(12), marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  defaultUnitButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  defaultUnitButtonActive: { borderColor: colors.accent },
  defaultUnitText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  defaultUnitTextActive: { color: colors.text, fontFamily: fonts.bodySemiBold },
  defaultUnitBadge: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(9), letterSpacing: 1, marginTop: 2 },
  surchargeLabel: { color: colors.text, fontFamily: fonts.body, fontSize: fs(13), flex: 1 },
  surchargeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  surchargeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 8,
    paddingVertical: 6,
    width: 64,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: 'center',
  },
  surchargeUnit: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  segmentButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentButtonText: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14) },
  segmentButtonTextActive: { color: colors.onAccent, fontFamily: fonts.bodySemiBold },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelButton: { flex: 1, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  saveButton: {
    flex: 1,
    height: MIN_TOUCH,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
});
