// Nastavení -> Zápisy -> Připomenutí (etapa 4.3). Typy lze kombinovat;
// vždy jen pro pracovní místa, jen v časovém okně a jen nezapsané pobyty.

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import NumPad from '@/components/NumPad';
import ScreenHeader from '@/components/ScreenHeader';
import ToggleRow from '@/components/ToggleRow';
import { getSettings, updateSettings } from '@/lib/db';
import { openIosSettings } from '@/lib/locationTracking';
import { ensureNotificationPermission, evaluateRemindersSafe } from '@/lib/reminders';
import type { AppSettings } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function PripominkyScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [eveningDraft, setEveningDraft] = useState('');

  const load = useCallback(async () => {
    const s = await getSettings();
    setSettings(s);
    setEveningDraft(toHHMM(s.reminderEveningMinutes));
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const patch = async (partial: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...partial } : s));
    await updateSettings(partial);
    evaluateRemindersSafe();
  };

  // Zapnutí typu připomenutí -> nejdřív oprávnění k upozorněním.
  const enable = async (partial: Partial<AppSettings>, value: boolean) => {
    if (value && !(await ensureNotificationPermission())) {
      Alert.alert('Upozornění nejsou povolená', 'Povol je v Nastavení iPhonu → Docházka → Oznámení.', [
        { text: 'Zrušit', style: 'cancel' },
        { text: 'Otevřít Nastavení', onPress: openIosSettings },
      ]);
      return;
    }
    await patch(partial);
  };

  const commitEvening = () => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(eveningDraft.trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      setEveningDraft(toHHMM(settings?.reminderEveningMinutes ?? 1140));
      return;
    }
    patch({ reminderEveningMinutes: Number(m[1]) * 60 + Number(m[2]) });
  };

  if (!settings) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="PŘIPOMENUTÍ" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Upozornění s návrhem zápisu (stroj naučený pro místo, hodiny po odečtení přestávky). Z upozornění jde rovnou zapsat
          podržením. Nikdy pro soukromá místa, jen nezapsané pobyty a jen v časovém okně záznamu.
        </Text>

        <ToggleRow
          label="Při odjezdu ze stavby"
          description="Po odjezdu z pracovního místa; když se vrátíš, zruší se"
          value={settings.reminderOnDeparture}
          onValueChange={(v) => enable({ reminderOnDeparture: v }, v)}
        />
        {settings.reminderOnDeparture && (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Jen po pobytu aspoň</Text>
              <NumPad
                value={settings.reminderMinStayMinutes}
                step={5}
                unitLabel="min"
                onChange={(v) => patch({ reminderMinStayMinutes: Math.max(0, Math.round(v)) })}
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Odeslat po</Text>
              <NumPad
                value={settings.reminderDelayMinutes}
                step={5}
                unitLabel="min"
                onChange={(v) => patch({ reminderDelayMinutes: Math.max(0, Math.round(v)) })}
              />
            </View>
          </>
        )}

        <ToggleRow
          label="Při příjezdu domů"
          description="Jedno upozornění se všemi nezapsanými pobyty dne"
          value={settings.reminderOnArriveHome}
          onValueChange={(v) => enable({ reminderOnArriveHome: v }, v)}
        />

        <ToggleRow
          label="Večerní souhrn"
          description="Jen pokud něco chybí"
          value={settings.reminderEvening}
          onValueChange={(v) => enable({ reminderEvening: v }, v)}
        />
        {settings.reminderEvening && (
          <View style={styles.row}>
            <Text style={styles.label}>Čas souhrnu</Text>
            <TextInput
              style={styles.timeInput}
              value={eveningDraft}
              onChangeText={setEveningDraft}
              onBlur={commitEvening}
              keyboardType="numbers-and-punctuation"
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          </View>
        )}

        <ToggleRow
          label="Jen pracovní dny"
          description="O víkendech a svátcích nepřipomínat"
          value={settings.remindersOnlyWorkdays}
          onValueChange={(v) => patch({ remindersOnlyWorkdays: v })}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), lineHeight: fs(17), marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
    minHeight: MIN_TOUCH,
  },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  timeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 72,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: 'center',
  },
});
