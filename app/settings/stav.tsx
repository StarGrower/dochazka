// Nastavení -> Stav záznamu (etapa 4.2) - seznam kontrol OK / varování /
// chyba a poslední zachycená událost polohy. Klepnutí na problém vede do
// Nastavení iPhonu nebo na příslušnou obrazovku appky.

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, type Href } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import { runHealthChecks, type HealthAction, type HealthLevel, type HealthReport } from '@/lib/health';
import { openIosSettings } from '@/lib/locationTracking';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

export const LEVEL_COLOR: Record<HealthLevel, string> = { ok: '#4CAF78', warn: colors.accent, error: colors.danger };
const LEVEL_LABEL: Record<HealthLevel, string> = { ok: 'OK', warn: 'POZOR', error: 'PROBLÉM' };

export function openHealthAction(action: HealthAction): void {
  if (action === 'ios-settings') openIosSettings();
  else if (action) router.push(action as Href);
}

export default function StavZaznamuScreen() {
  const [report, setReport] = useState<HealthReport | null>(null);

  const load = useCallback(async () => {
    setReport(await runHealthChecks());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const lastEvent = report?.lastEventAt ? new Date(report.lastEventAt) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="STAV ZÁZNAMU" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.label}>POSLEDNÍ ZACHYCENÁ UDÁLOST POLOHY</Text>
          <Text style={styles.big}>
            {lastEvent
              ? `${lastEvent.getDate()}. ${lastEvent.getMonth() + 1}. ${lastEvent.getHours()}:${String(lastEvent.getMinutes()).padStart(2, '0')}`
              : 'zatím žádná'}
          </Text>
        </View>
        {report?.checks.map((c) => (
          <TouchableOpacity key={c.id} style={styles.row} disabled={!c.action} onPress={() => openHealthAction(c.action)}>
            <View style={[styles.badge, { backgroundColor: LEVEL_COLOR[c.level] }]}>
              <Text style={styles.badgeText}>{LEVEL_LABEL[c.level]}</Text>
            </View>
            <View style={styles.main}>
              <Text style={styles.title}>{c.title}</Text>
              <Text style={styles.detail}>{c.detail}</Text>
            </View>
            {c.action && <Text style={styles.chevron}>›</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 8 },
  card: { backgroundColor: colors.card, borderRadius: radii.card, padding: 14, marginBottom: 4 },
  label: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(11), letterSpacing: 1 },
  big: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(24), marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: radii.card, padding: 12, minHeight: MIN_TOUCH },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, minWidth: 64, alignItems: 'center' },
  badgeText: { color: colors.background, fontFamily: fonts.headingBold, fontSize: fs(11), letterSpacing: 0.5 },
  main: { flex: 1 },
  title: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  detail: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: fs(22) },
});
