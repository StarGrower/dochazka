// Nastavení -> Aplikace (ČÁST 3).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - "formát času 24h" a "velikost písma" se
// ukládají a přepínač funguje, ale VIZUÁLNÍ efekt zatím nemají: appka
// nikde nezobrazuje čas hodin:minut (není z čeho 12/24h formátovat) a
// důsledné zavedení škálování písma by znamenalo upravit fontSize ve
// všech obrazovkách najednou - raději žádný efekt než poloviční
// (některé obrazovky by škálovaly, jiné ne, což by vypadalo jako bug).
// Až přijde reálný důvod (etapa 3 časy příjezdu/odjezdu), doplní se.
// "První den týdne" SKUTEČNĚ ovládá kalendářní mřížku (MonthGrid).
// "Hmatová odezva" je zapojená v Detailu dne (NumPad, uložení).

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import ToggleRow from '@/components/ToggleRow';
import { getSettings, updateSettings, wipeAllData } from '@/lib/db';
import type { AppSettings } from '@/lib/types';
import { colors, fonts, radii, MIN_TOUCH } from '@/theme';

export default function AplikaceSettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const load = useCallback(async () => {
    setSettings(await getSettings());
  }, []);

  useFocusEffect(() => {
    load();
  });

  const patch = async (partial: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...partial } : s));
    await updateSettings(partial);
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

        <ToggleRow
          label="Hmatová odezva při klepnutí"
          value={settings.hapticsEnabled}
          onValueChange={(v) => patch({ hapticsEnabled: v })}
        />

        <SegmentedControl
          label="Velikost písma"
          value={settings.fontScale}
          onChange={(v) => patch({ fontScale: v })}
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
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15 },
  value: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
  badge: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: 10, letterSpacing: 0.5 },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: 12,
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
  dangerButtonText: { color: colors.danger, fontFamily: fonts.headingBold, fontSize: 14, letterSpacing: 1 },
});
