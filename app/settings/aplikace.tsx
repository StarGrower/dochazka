// Nastavení -> Aplikace (ČÁST 3).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - "formát času 24h" se ukládá, ale vizuální
// efekt zatím nemá (časy pobytů jsou vždy 24h; 12h formát v české
// appce nedává smysl - doplní se, kdyby byl důvod).
// "Velikost písma" (oprava 2, E) SKUTEČNĚ škáluje písmo na všech
// obrazovkách (theme.ts -> fs); po přepnutí se appka znovu načte.
// "První den týdne" SKUTEČNĚ ovládá kalendářní mřížku (MonthGrid).
// "Hmatová odezva" byla v opravě 2 úplně odstraněna (zadání E).

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { reloadAppAsync } from 'expo';
import Constants from 'expo-constants';
import Storage from 'expo-sqlite/kv-store';
import { router, useFocusEffect } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import ToggleRow from '@/components/ToggleRow';
import { getSettings, updateSettings, wipeAllData } from '@/lib/db';
import type { AppSettings, FontScale } from '@/lib/types';
import { colors, fonts, radii, MIN_TOUCH, fs, FONT_SCALE_STORAGE_KEY } from '@/theme';

export default function AplikaceSettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const load = useCallback(async () => {
    setSettings(await getSettings());
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

  // Styly vznikají při startu (viz theme.ts) - nová velikost písma se
  // projeví až po znovunačtení appky.
  const handleFontScale = async (value: FontScale) => {
    if (!settings || value === settings.fontScale) return;
    await patch({ fontScale: value });
    try {
      Storage.setItemSync(FONT_SCALE_STORAGE_KEY, value);
    } catch {
      // bez kv-store zůstane písmo normální - nic dalšího se nerozbije
    }
    await reloadAppAsync('velikost písma').catch(() => {
      Alert.alert('Velikost písma', 'Změna se projeví po zavření a znovuotevření appky.');
    });
  };

  const handleWipe = () => {
    Alert.alert(
      'Smazat všechna data',
      'Tahle akce je nevratná - zmizí všechny dny, kategorie i nastavení.',
      [
        { text: 'Zrušit', style: 'cancel' },
        {
          text: 'Pokračovat',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Opravdu smazat úplně vše?',
              'Poslední varování - tohle se nedá vzít zpět.',
              [
                { text: 'Zrušit', style: 'cancel' },
                {
                  text: 'Smazat vše',
                  style: 'destructive',
                  onPress: async () => {
                    await wipeAllData();
                    try {
                      Storage.setItemSync(FONT_SCALE_STORAGE_KEY, 'normal');
                    } catch {
                      // viz handleFontScale
                    }
                    router.replace('/');
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  if (!settings) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="APLIKACE" />

      <ScrollView contentContainerStyle={styles.content}>
        <ToggleRow label="Formát času 24 h" value={settings.timeFormat24h} onValueChange={(v) => patch({ timeFormat24h: v })} />

        <ToggleRow
          label="První den týdne pondělí"
          description="Vypnuté = týden začíná nedělí"
          value={settings.weekStartsMonday}
          onValueChange={(v) => patch({ weekStartsMonday: v })}
        />

        <SegmentedControl
          label="Velikost písma"
          value={settings.fontScale}
          onChange={handleFontScale}
          options={[
            { label: 'Normální', value: 'normal' },
            { label: 'Větší', value: 'large' },
          ]}
        />

        <Text style={styles.sectionHeader}>POLOHA - LADĚNÍ</Text>
        <ToggleRow
          label="Ladicí deník"
          description="Zapisuje události záznamu polohy pro testování v terénu"
          value={settings.debugLogEnabled}
          onValueChange={(v) => patch({ debugLogEnabled: v })}
        />
        <TouchableOpacity style={styles.row} onPress={() => router.push('/settings/debug-log')}>
          <Text style={styles.label}>Zobrazit ladicí deník</Text>
          <Text style={styles.value}>›</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>DATA</Text>
        <View style={styles.rowDisabled}>
          <Text style={styles.label}>Záloha a obnova dat</Text>
          <Text style={styles.badge}>PŘIPRAVUJEME</Text>
        </View>

        <TouchableOpacity style={styles.dangerButton} onPress={handleWipe}>
          <Text style={styles.dangerButtonText}>SMAZAT VŠECHNA DATA</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>O APLIKACI</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Verze</Text>
          <Text style={styles.value}>{Constants.expoConfig?.version ?? '-'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
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
  rowDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    opacity: 0.5,
  },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  value: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(14) },
  badge: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(10), letterSpacing: 0.5 },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: fs(12),
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
  },
  dangerButton: {
    height: MIN_TOUCH,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  dangerButtonText: { color: colors.danger, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1 },
});
