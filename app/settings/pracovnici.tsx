// Nastavení → Pracovníci (doplněk etapy 5): kolegové u položek práce a
// řidiči v knize jízd. Volitelná výchozí sazba (jen u práce - stroj se
// fakturuje sazbou stroje) a "Fakturovat" (vypnuto = jen evidence hodin).
// Změna se týká jen nových položek - uložené sazby se nepřepočítají.

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import ToggleRow from '@/components/ToggleRow';
import { formatKc, formatNumberCs } from '@/lib/format';
import { deletePerson, listPeople, savePerson } from '@/lib/orders';
import type { Person } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type Draft = { id: number | null; isMe: boolean; name: string; hour: string; day: string; billable: boolean };

const parseRate = (t: string) => {
  const v = Number(t.replace(/\s/g, '').replace(',', '.'));
  return t.trim() && Number.isFinite(v) && v >= 0 ? v : null;
};

export default function WorkersScreen() {
  const [people, setPeople] = useState<Person[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setPeople(await listPeople());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const open = (p: Person | null) =>
    setDraft(
      p
        ? { id: p.id, isMe: p.isMe, name: p.name, hour: p.rateHourKc !== null ? formatNumberCs(p.rateHourKc) : '', day: p.rateDayKc !== null ? formatNumberCs(p.rateDayKc) : '', billable: p.billable }
        : { id: null, isMe: false, name: '', hour: '', day: '', billable: true }
    );

  const save = async () => {
    if (!draft || !draft.name.trim()) {
      Alert.alert('Chybí jméno', 'Zadej jméno pracovníka.');
      return;
    }
    await savePerson({ id: draft.id, name: draft.name.trim(), rateHourKc: parseRate(draft.hour), rateDayKc: parseRate(draft.day), billable: draft.billable });
    setDraft(null);
    await load();
  };

  const remove = () => {
    if (!draft?.id || draft.isMe) return;
    Alert.alert('Odebrat pracovníka', `Odebrat ${draft.name}? Jeho dosavadní zápisy zůstanou.`, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Odebrat',
        style: 'destructive',
        onPress: async () => {
          await deletePerson(draft.id as number);
          setDraft(null);
          await load();
        },
      },
    ]);
  };

  const rateLabel = (p: Person) => {
    if (!p.billable) return 'jen evidence (0 Kč)';
    const rates = [p.rateHourKc !== null ? `${formatKc(p.rateHourKc)}/h` : null, p.rateDayKc !== null ? `${formatKc(p.rateDayKc)}/den` : null].filter(Boolean);
    return rates.length ? rates.join(' · ') : 'sazba práce';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="PRACOVNÍCI" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.sc}>
        <Text style={styles.hint}>
          Pracovníka vybereš u položky práce v Detailu dne (kolega, jen stroj) a jako řidiče v knize jízd. Připomenutí a „Navrhnout z pobytů“ jsou jen pro tebe.
        </Text>
        <View style={styles.tb}>
          {people.map((p, i) => (
            <TouchableOpacity key={p.id} style={[styles.row, i === 0 && styles.rowFirst]} onPress={() => open(p)}>
              <Text style={styles.name}>
                {p.name}
                {p.isMe ? ' (já)' : ''}
              </Text>
              <Text style={styles.rate}>{rateLabel(p)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.add} onPress={() => open(null)}>
          <Text style={styles.addText}>+ Přidat pracovníka</Text>
        </TouchableOpacity>
      </ScrollView>

      <BottomSheetModal
        visible={draft !== null}
        onClose={() => setDraft(null)}
        footer={
          <View style={styles.buttons}>
            {draft?.id != null && !draft.isMe ? (
              <TouchableOpacity style={styles.secondary} onPress={remove}>
                <Text style={styles.deleteText}>Odebrat</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.secondary} onPress={() => setDraft(null)}>
                <Text style={styles.cancelText}>Zrušit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.primary} onPress={save}>
              <Text style={styles.primaryText}>ULOŽIT</Text>
            </TouchableOpacity>
          </View>
        }
      >
        {draft && (
          <>
            <Text style={styles.modalTitle}>{draft.id ? 'PRACOVNÍK' : 'NOVÝ PRACOVNÍK'}</Text>
            <Text style={styles.label}>Jméno</Text>
            <TextInput style={styles.input} value={draft.name} onChangeText={(t) => setDraft((d) => (d ? { ...d, name: t } : d))} placeholder="Jméno" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
            <ToggleRow
              label="Fakturovat"
              description="Vypnuto = hodiny jen v přehledu Lidé a ve výkazu, 0 Kč"
              value={draft.billable}
              onValueChange={(v) => setDraft((d) => (d ? { ...d, billable: v } : d))}
            />
            {draft.billable && (
              <>
                <Text style={styles.label}>Výchozí sazba (prázdné = sazba práce)</Text>
                <View style={styles.row2}>
                  <TextInput style={[styles.input, styles.flex]} value={draft.hour} onChangeText={(t) => setDraft((d) => (d ? { ...d, hour: t } : d))} placeholder="Kč/h" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
                  <TextInput style={[styles.input, styles.flex]} value={draft.day} onChangeText={(t) => setDraft((d) => (d ? { ...d, day: t } : d))} placeholder="Kč/den" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
                </View>
                <Text style={styles.hint}>Platí jen pro práci. Stroj se fakturuje sazbou stroje, ať ho řídí kdokoli. Uložené položky se nepřepočítají.</Text>
              </>
            )}
          </>
        )}
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  sc: { paddingHorizontal: 16, gap: 12, paddingBottom: 40 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 6 },
  tb: { backgroundColor: colors.card, borderRadius: radii.card, paddingHorizontal: 12 },
  row: { minHeight: 56, justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8 },
  rowFirst: { borderTopWidth: 0 },
  name: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  rate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 2 },
  add: { minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  addText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  modalTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1 },
  label: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 12 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.background, marginTop: 6 },
  row2: { flexDirection: 'row', gap: 8 },
  buttons: { flexDirection: 'row', gap: 12 },
  cancelText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  secondary: { flex: 1, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: colors.danger, fontFamily: fonts.body, fontSize: fs(15) },
  primary: { flex: 1, height: MIN_TOUCH, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
});
