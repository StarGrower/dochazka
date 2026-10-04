// Nastavení -> Moje údaje (etapa 4.4) - hlavička výkazu pro šéfa (jméno,
// IČO, adresa...). Odběratelé přijdou se zakázkami v etapě 5.

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import { getSettings, updateSettings } from '@/lib/db';
import type { AppSettings } from '@/lib/types';
import { colors, fonts, fs, radii } from '@/theme';

type ProfileField = 'profileName' | 'profileIco' | 'profileDic' | 'profileAddress' | 'profilePhone' | 'profileEmail';

const FIELDS: { key: ProfileField; label: string; placeholder: string; keyboard?: 'number-pad' | 'phone-pad' | 'email-address'; multiline?: boolean }[] = [
  { key: 'profileName', label: 'Jméno / firma', placeholder: 'Jan Novák' },
  { key: 'profileIco', label: 'IČO', placeholder: '12345678', keyboard: 'number-pad' },
  { key: 'profileDic', label: 'DIČ', placeholder: 'CZ12345678' },
  { key: 'profileAddress', label: 'Adresa', placeholder: 'Ulice 1, 123 45 Obec', multiline: true },
  { key: 'profilePhone', label: 'Telefon', placeholder: '+420 …', keyboard: 'phone-pad' },
  { key: 'profileEmail', label: 'E-mail', placeholder: 'jmeno@example.cz', keyboard: 'email-address' },
];

export default function MojeUdajeScreen() {
  const [values, setValues] = useState<Pick<AppSettings, ProfileField> | null>(null);

  const load = useCallback(async () => {
    const s = await getSettings();
    setValues({
      profileName: s.profileName,
      profileIco: s.profileIco,
      profileDic: s.profileDic,
      profileAddress: s.profileAddress,
      profilePhone: s.profilePhone,
      profileEmail: s.profileEmail,
    });
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!values) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="MOJE ÚDAJE" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Zobrazí se v hlavičce výkazu pro šéfa. Odběratelé přibudou se zakázkami.</Text>
        {FIELDS.map((f) => (
          <TextInput
            key={f.key}
            style={[styles.input, f.multiline && styles.inputMultiline]}
            value={values[f.key]}
            onChangeText={(t) => setValues((v) => (v ? { ...v, [f.key]: t } : v))}
            onBlur={() => updateSettings({ [f.key]: values[f.key].trim() })}
            placeholder={`${f.label} - např. ${f.placeholder}`}
            placeholderTextColor={colors.textMuted}
            keyboardType={f.keyboard ?? 'default'}
            autoCapitalize={f.keyboard === 'email-address' ? 'none' : 'sentences'}
            multiline={f.multiline}
            inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 10 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.card,
    minHeight: 48,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
});
