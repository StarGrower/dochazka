// Nastavení -> Stroje a kategorie (ČÁST 3 - přesunuto z dřívějšího
// app/(tabs)/nastaveni.tsx, + ČÁST 1 oprava klávesnice přes
// BottomSheetModal/KeyboardDoneAccessory, + ČÁST 2 vlastní barva přes
// ColorPicker, + nové pole "kind" (typ stroj/práce).

import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
import { formatKc } from '@/lib/format';
import { tapHaptic } from '@/lib/haptics';
import type { CategoryKind, RateType, WorkCategory } from '@/lib/types';
import { categoryPalette, colors, fonts, paletteColorAt, radii, MIN_TOUCH } from '@/theme';

type EditingState = {
  id: number | null;
  name: string;
  rateType: RateType;
  rateKc: number;
  color: string;
  kind: CategoryKind;
};

// Krok 10 Kč - sazby se obvykle zadávají v desítkách/stovkách, ne po
// 0,25 jako hodiny (viz zadání ČÁST 3 bod 3 - "stejné ovládání",
// nemusí to být stejný KROK).
const RATE_STEP_KC = 10;

function emptyEditing(): EditingState {
  return { id: null, name: '', rateType: 'hourly', rateKc: 0, color: paletteColorAt(0), kind: 'machine' };
}

export default function CategoriesSettingsScreen() {
  const [categories, setCategories] = useState<WorkCategory[]>([]);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);

  const load = useCallback(async () => {
    const [cats, settings] = await Promise.all([listCategories(), getSettings()]);
    setCategories(cats);
    setRecentColors(settings.recentCustomColors);
    setHapticsEnabled(settings.hapticsEnabled);
  }, []);

  useFocusEffect(() => {
    load();
  });

  const openAdd = () => setEditing(emptyEditing());
  const openEdit = (c: WorkCategory) =>
    setEditing({ id: c.id, name: c.name, rateType: c.rateType, rateKc: c.rateKc, color: c.color, kind: c.kind });

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
    setSaving(true);
    try {
      if (editing.id === null) {
        await createCategory(name, editing.rateType, editing.rateKc, editing.color, editing.kind);
      } else {
        await updateCategory(editing.id, {
          name,
          rateType: editing.rateType,
          rateKc: editing.rateKc,
          color: editing.color,
          kind: editing.kind,
        });
      }
      if (!(categoryPalette as readonly string[]).includes(editing.color)) {
        await addRecentCustomColor(editing.color);
      }
      tapHaptic(hapticsEnabled);
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
            tapHaptic(hapticsEnabled);
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
              <Text style={styles.rowRate}>
                {formatKc(item.rateKc)} / {item.rateType === 'hourly' ? 'hodinu' : 'den'}
              </Text>
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

        <Text style={styles.fieldLabel}>Sazba</Text>
        <View style={styles.segmentRow}>
          <SegmentButton
            label="Kč / hodinu"
            active={editing?.rateType === 'hourly'}
            onPress={() => setEditing((e) => (e ? { ...e, rateType: 'hourly' } : e))}
          />
          <SegmentButton
            label="Kč / den"
            active={editing?.rateType === 'daily'}
            onPress={() => setEditing((e) => (e ? { ...e, rateType: 'daily' } : e))}
          />
        </View>
        {editing && (
          <NumPad
            value={editing.rateKc}
            step={RATE_STEP_KC}
            unitLabel="Kč"
            onChange={(next) => setEditing((e) => (e ? { ...e, rateKc: next } : e))}
            hapticsEnabled={hapticsEnabled}
          />
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
      </BottomSheetModal>
    </SafeAreaView>
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
  rowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15 },
  rowRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  deleteLabel: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: 13 },
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
  addButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: 15, letterSpacing: 1 },
  modalTitle: {
    color: colors.text,
    fontFamily: fonts.headingBold,
    fontSize: 17,
    letterSpacing: 1,
    marginBottom: 16,
  },
  fieldLabel: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  segmentButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentButtonText: { color: colors.text, fontFamily: fonts.body, fontSize: 14 },
  segmentButtonTextActive: { color: colors.onAccent, fontFamily: fonts.bodySemiBold },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelButton: { flex: 1, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 15 },
  saveButton: {
    flex: 1,
    height: MIN_TOUCH,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: 15, letterSpacing: 1 },
});
