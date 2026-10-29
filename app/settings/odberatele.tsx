// Nastavení -> Moje údaje (etapa 4.4) - hlavička výkazu i faktury (jméno,
// IČO, adresa...). Fakturace: číslo účtu (kontrola mod 11, IBAN pro QR
// Platbu), výchozí splatnost, plátce DPH a text o zápisu v rejstříku.

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import SafeScreen from '@/components/SafeScreen';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import ToggleRow from '@/components/ToggleRow';
import { czIban, formatCzAccount, formatIban, parseCzAccount } from '@/lib/bankAccount';
import { getSettings, updateSettings } from '@/lib/db';
import type { AppSettings } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type ProfileField = 'profileName' | 'profileIco' | 'profileDic' | 'profileAddress' | 'profilePhone' | 'profileEmail';
type Values = Pick<AppSettings, ProfileField | 'bankAccount' | 'registryText' | 'vatPayer'> & { dueDays: string };

const FIELDS: { key: ProfileField; label: string; placeholder: string; keyboard?: 'number-pad' | 'phone-pad' | 'email-address'; multiline?: boolean }[] = [
  { key: 'profileName', label: 'Jméno / firma', placeholder: 'Jan Novák' },
  { key: 'profileIco', label: 'IČO', placeholder: '12345678', keyboard: 'number-pad' },
  { key: 'profileDic', label: 'DIČ', placeholder: 'CZ12345678' },
  { key: 'profileAddress', label: 'Adresa', placeholder: 'Ulice 1, 123 45 Obec', multiline: true },
  { key: 'profilePhone', label: 'Telefon', placeholder: '+420 …', keyboard: 'phone-pad' },
  { key: 'profileEmail', label: 'E-mail', placeholder: 'jmeno@example.cz', keyboard: 'email-address' },
];

const DUE_CHOICES = [7, 14, 30];

export default function MojeUdajeScreen() {
  const [values, setValues] = useState<Values | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await getSettings();
    setValues({
      profileName: s.profileName,
      profileIco: s.profileIco,
      profileDic: s.profileDic,
      profileAddress: s.profileAddress,
      profilePhone: s.profilePhone,
      profileEmail: s.profileEmail,
      bankAccount: s.bankAccount,
      registryText: s.registryText,
      vatPayer: s.vatPayer,
      dueDays: String(s.defaultDueDays),
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

  // Neplatný účet se neuloží (zůstane poslední platný) - na faktuře by
  // byl špatný IBAN i QR Platba.
  const saveAccount = async () => {
    const raw = values.bankAccount.trim();
    if (!raw) {
      setAccountError(null);
      await updateSettings({ bankAccount: '' });
      return;
    }
    const r = parseCzAccount(raw);
    if ('error' in r) {
      setAccountError(r.error);
      return;
    }
    setAccountError(null);
    const normalized = formatCzAccount(r.account);
    setValues((v) => (v ? { ...v, bankAccount: normalized } : v));
    await updateSettings({ bankAccount: normalized });
  };

  const saveDueDays = async (text: string) => {
    const n = Math.round(Number(text));
    const days = text !== '' && Number.isFinite(n) && n >= 0 && n <= 365 ? n : 14;
    setValues((v) => (v ? { ...v, dueDays: String(days) } : v));
    await updateSettings({ defaultDueDays: days });
  };

  const parsed = values.bankAccount.trim() ? parseCzAccount(values.bankAccount) : null;
  const iban = parsed && 'account' in parsed ? czIban(parsed.account) : null;

  return (
    <SafeScreen style={styles.container}>
      <ScreenHeader title="MOJE ÚDAJE" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Zobrazí se v hlavičce výkazu a jako dodavatel na faktuře.</Text>
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

        <Text style={styles.section}>FAKTURACE</Text>
        <Text style={styles.label}>Číslo účtu</Text>
        <TextInput
          style={[styles.input, accountError !== null && styles.inputError]}
          value={values.bankAccount}
          onChangeText={(t) => {
            setAccountError(null);
            setValues((v) => (v ? { ...v, bankAccount: t } : v));
          }}
          onBlur={saveAccount}
          placeholder="[předčíslí-]číslo/kód banky"
          placeholderTextColor={colors.textMuted}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        {accountError !== null ? (
          <Text style={styles.error}>{accountError}</Text>
        ) : iban ? (
          <Text style={styles.hint}>IBAN {formatIban(iban)} - pro QR Platbu na faktuře.</Text>
        ) : (
          <Text style={styles.hint}>Bez čísla účtu bude faktura bez QR Platby.</Text>
        )}

        <Text style={styles.label}>Výchozí splatnost (dny)</Text>
        <View style={styles.dueRow}>
          <TextInput
            style={[styles.input, styles.dueInput]}
            value={values.dueDays}
            onChangeText={(t) => setValues((v) => (v ? { ...v, dueDays: t.replace(/\D/g, '') } : v))}
            onBlur={() => saveDueDays(values.dueDays)}
            keyboardType="number-pad"
            maxLength={3}
            inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
          />
          {DUE_CHOICES.map((d) => {
            const on = values.dueDays === String(d);
            return (
              <TouchableOpacity key={d} style={[styles.chip, on && styles.chipOn]} onPress={() => saveDueDays(String(d))}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{d} dní</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ToggleRow
          label="Plátce DPH"
          description={values.vatPayer ? 'Na faktuře nebude věta o neplátcovství.' : 'Na faktuře bude „Nejsem plátce DPH.“'}
          value={values.vatPayer}
          onValueChange={(v) => {
            setValues((x) => (x ? { ...x, vatPayer: v } : x));
            updateSettings({ vatPayer: v });
          }}
        />

        <Text style={styles.label}>Zápis v rejstříku</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={values.registryText}
          onChangeText={(t) => setValues((v) => (v ? { ...v, registryText: t } : v))}
          onBlur={() => updateSettings({ registryText: values.registryText.trim() })}
          placeholder="Fyzická osoba zapsaná v živnostenském rejstříku, …"
          placeholderTextColor={colors.textMuted}
          multiline
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <Text style={styles.hint}>Tiskne se drobně pod dodavatelem - doplň název živnostenského úřadu.</Text>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 10 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 4 },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: fs(13), marginBottom: 4 },
  section: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1.1, marginTop: 14 },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14), marginTop: 4 },
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
  inputError: { borderColor: colors.danger },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dueInput: { width: 72, textAlign: 'center' },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  chipTextOn: { color: colors.onAccent },
});
