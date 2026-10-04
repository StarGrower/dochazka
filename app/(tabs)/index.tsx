// Krok 1 - kalendář (vizuální směr "A · Stavba"): měsíční přehled, u
// každého dne součet hodin. Vlastní mřížka (components/MonthGrid.tsx),
// vlastní měsíční header (šipky + VERZÁLKOVÝ název měsíce), tři
// souhrnné karty a velké tlačítko "+ ZAPSAT DNEŠEK".
//
// "najeto km" karta = pracovní přejezdy měsíce (etapa 3; soukromé jízdy
// a smazané přejezdy ne) - podle dne, kdy přejezd začal.

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import HealthBanner from '@/components/HealthBanner';
import MonthGrid from '@/components/MonthGrid';
import { isBackupConfigured } from '@/lib/backup';
import { getInternalValue, getMonthSummary, getMonthTripKm, getSettings, isDatabaseEmpty, setInternalValue } from '@/lib/db';
import { runHealthChecks, type HealthCheck } from '@/lib/health';
import { formatHours, monthNameUpper, todayIso } from '@/lib/format';
import type { MonthDaySummary } from '@/lib/types';
import { colors, fonts, radii, MIN_TOUCH, fs } from '@/theme';

export default function CalendarScreen() {
  const today = todayIso();

  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [summary, setSummary] = useState<Record<string, MonthDaySummary>>({});
  const [startOnMonday, setStartOnMonday] = useState(true);
  const [tripKmByDay, setTripKmByDay] = useState<Record<string, number>>({});
  const [problems, setProblems] = useState<HealthCheck[]>([]);
  const [offerRestore, setOfferRestore] = useState(false);

  const load = useCallback(async () => {
    const [data, settings, km] = await Promise.all([
      getMonthSummary(visibleMonth.year, visibleMonth.month),
      getSettings(),
      getMonthTripKm(visibleMonth.year, visibleMonth.month),
    ]);
    setSummary(data);
    setTripKmByDay(km);
    // Etapa 4.2: stav záznamu (proužek) a 4.1: nový telefon -> nabídka obnovy.
    runHealthChecks()
      .then((r) => setProblems(r.checks.filter((c) => c.level !== 'ok')))
      .catch(() => {});
    if (!isBackupConfigured() && (await isDatabaseEmpty()) && !(await getInternalValue('restore_offer_dismissed'))) {
      setOfferRestore(true);
    } else {
      setOfferRestore(false);
    }
    setStartOnMonday(settings.weekStartsMonday);
  }, [visibleMonth]);

  // Znovu načíst při každém návratu na tenhle tab (např. po úpravě
  // hodin v detailu dne) - ne jen při změně měsíce.
  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const monthTotal = useMemo(() => {
    let hours = 0;
    let workDays = 0;
    for (const key in summary) {
      hours += summary[key].hours;
      workDays += 1;
    }
    const km = Object.values(tripKmByDay).reduce((sum, v) => sum + v, 0);
    return { hours, km, workDays };
  }, [summary, tripKmByDay]);

  const goToMonth = (delta: number) => {
    setVisibleMonth((current) => {
      const d = new Date(current.year, current.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
      {problems.length > 0 && <HealthBanner problem={problems[0]} count={problems.length} />}
      {offerRestore && (
        <View style={styles.restoreCard}>
          <Text style={styles.restoreTitle}>Máš zálohu z jiného telefonu?</Text>
          <View style={styles.restoreButtons}>
            <TouchableOpacity style={styles.restoreButton} onPress={() => router.push('/settings/zaloha')}>
              <Text style={styles.restoreButtonText}>OBNOVIT</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.restoreDismiss}
              onPress={async () => {
                await setInternalValue('restore_offer_dismissed', '1');
                setOfferRestore(false);
              }}
            >
              <Text style={styles.restoreDismissText}>Ne, začít znovu</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <View style={styles.monthHeader}>
        <TouchableOpacity style={styles.monthArrow} onPress={() => goToMonth(-1)}>
          <Text style={styles.monthArrowText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.monthTitleBlock}>
          <Text style={styles.monthTitle}>{monthNameUpper(visibleMonth.month)}</Text>
          <Text style={styles.monthYear}>{visibleMonth.year}</Text>
        </View>
        <TouchableOpacity style={styles.monthArrow} onPress={() => goToMonth(1)}>
          <Text style={styles.monthArrowText}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard label="ODPRACOVÁNO" value={formatHours(monthTotal.hours)} accent />
        <SummaryCard label="NAJETO KM" value={`${Math.round(monthTotal.km)} km`} />
        <SummaryCard label="PRACOVNÍCH DNÍ" value={String(monthTotal.workDays)} />
      </View>

      <MonthGrid
        year={visibleMonth.year}
        month={visibleMonth.month}
        summary={summary}
        todayIso={today}
        onSelectDay={(iso) => router.push(`/day/${iso}`)}
        startOnMonday={startOnMonday}
      />

      {/* add=1: Detail dne rovnou otevře přidání položky (s návrhem výchozích položek, B2). */}
      <TouchableOpacity style={styles.ctaButton} onPress={() => router.push(`/day/${today}?add=1`)}>
        <Text style={styles.ctaButtonText}>+ ZAPSAT DNEŠEK</Text>
      </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={[styles.summaryValue, accent && styles.summaryValueAccent]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  restoreCard: { backgroundColor: colors.card, borderRadius: radii.card, borderWidth: 1, borderColor: colors.accent, padding: 14, marginBottom: 12 },
  restoreTitle: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15), marginBottom: 10 },
  restoreButtons: { flexDirection: 'row', gap: 10 },
  restoreButton: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  restoreButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
  restoreDismiss: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  restoreDismissText: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: 16, paddingBottom: 32 },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  monthArrow: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthArrowText: { color: colors.text, fontSize: fs(22), fontFamily: fonts.body, marginTop: -2 },
  monthTitleBlock: { alignItems: 'center' },
  monthTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(22), letterSpacing: 1 },
  monthYear: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginTop: 2 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  summaryValue: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(18) },
  summaryValueAccent: { color: colors.accent },
  summaryLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemiBold,
    fontSize: fs(10),
    marginTop: 4,
    textAlign: 'center',
  },
  ctaButton: {
    marginTop: 16,
    height: 54,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    color: colors.onAccent,
    fontFamily: fonts.headingBold,
    fontSize: fs(16),
    letterSpacing: 1,
  },
});
