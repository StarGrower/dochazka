// Odběratelé (fakturace) - seznam ze stejné tabulky jako zakázky (etapa 5),
// takže odběratelé zakázek tu jsou hned. Jméno/firma, adresa, IČO, DIČ
// (nepovinné), poznámka; přidat, upravit, smazat (měkce - vystavené
// faktury mají údaje odběratele ve snímku).

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import { deleteClient, listClients, saveClient } from '@/lib/orders';
import type { Client } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type Draft = Omit<Client, 'id'> & { id: number | null };

const EMPTY: Draft = { id: null, name: '', address: '', ico: '', dic: '', note: '' };

const FIELDS: { key: keyof Omit<Client, 'id'>; placeholder: string; multiline?: boolean; numeric?: boolean }[] = [
  { key: 'name', placeholder: 'Jméno / firma' },
  { key: 'address', placeholder: 'Adresa (ulice, PSČ obec)', multiline: true },
  { key: 'ico', placeholder: 'IČO', numeric: true },
  { key: 'dic', placeholder: 'DIČ (nepovinné)' },
  { key: 'note', placeholder: 'Poznámka (nepovinné)' },
];

export default function ClientsScreen() {
  const [clients, setClients] = useState<Client[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setClients(await listClients());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      Alert.alert('Chybí jméno', 'Zadej jméno nebo název firmy odběratele.');
      return;
    }
    await saveClient({ ...draft, name: draft.name.trim(), address: draft.address.trim(), ico: draft.ico.trim(), dic: draft.dic.trim(), note: draft.note.trim() });
    setDraft(null);
    await load();
  };

  const remove = () => {
    if (!draft?.id) return;
    const id = draft.id;
    Alert.alert('Smazat odběratele?', 'Zakázky a vystavené faktury si jeho údaje nechají.', [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          await deleteClient(id);
          setDraft(null);
          await load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="ODBĚRATELÉ" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>Stejný seznam jako u zakázek. Vybírá se na faktuře, nový jde přidat i přímo z faktury.</Text>
        <View style={styles.group}>
          {clients.length === 0 && <Text style={styles.empty}>Zatím žádný odběratel.</Text>}
          {clients.map((c, i) => (
            <TouchableOpacity key={c.id} style={[styles.row, i > 0 && styles.rowBorder]} onPress={() => setDraft({ ...c })}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.sub}>{[c.address.replace(/\n/g, ', '), c.ico ? `IČO ${c.ico}` : '', c.dic ? `DIČ ${c.dic}` : ''].filter(Boolean).join(' · ') || 'bez údajů'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.add} onPress={() => setDraft({ ...EMPTY })}>
          <Text style={styles.addText}>+ Nový odběratel</Text>
        </TouchableOpacity>
      </ScrollView>

      <BottomSheetModal
        visible={draft !== null}
        onClose={() => setDraft(null)}
        footer={
          <View style={styles.footerRow}>
            {draft?.id ? (
              <TouchableOpacity style={styles.footerCancel} onPress={remove}>
                <Text style={styles.deleteText}>Smazat</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.footerCancel} onPress={() => setDraft(null)}>
                <Text style={styles.footerCancelText}>Zrušit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.footerCta} onPress={save}>
              <Text style={styles.ctaText}>ULOŽIT</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.modalTitle}>{draft?.id ? 'UPRAVIT ODBĚRATELE' : 'NOVÝ ODBĚRATEL'}</Text>
        {draft &&
          FIELDS.map((f) => (
            <TextInput
              key={f.key}
              style={[styles.input, f.multiline && styles.inputMultiline]}
              value={draft[f.key]}
              onChangeText={(t) => setDraft((d) => (d ? { ...d, [f.key]: t } : d))}
              placeholder={f.placeholder}
              placeholderTextColor={colors.textMuted}
              keyboardType={f.numeric ? 'number-pad' : 'default'}
              multiline={f.multiline}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          ))}
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  group: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), padding: 14 },
  row: { paddingHorizontal: 14, paddingVertical: 10, minHeight: 54, justifyContent: 'center' },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  sub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginTop: 2 },
  add: { minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  addText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  modalTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.background, marginTop: 8 },
  inputMultiline: { minHeight: 72, paddingTop: 12, textAlignVertical: 'top' },
  footerRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  footerCta: { flex: 1, height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  footerCancel: { height: 52, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  footerCancelText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  deleteText: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(19), letterSpacing: 0.95 },
});
