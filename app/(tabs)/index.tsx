// Krok 1 - kalendář (vizuální směr "A · Stavba"): měsíční přehled, u
// každého dne součet hodin. Vlastní mřížka (components/MonthGrid.tsx),
// vlastní měsíční header (šipky + VERZÁLKOVÝ název měsíce), tři
// souhrnné karty a velké tlačítko "+ ZAPSAT DNEŠEK".
//
// "najeto km" karta je zatím vždy 0 - přejezdy/km přibudou až v etapě 3
// (záznam polohy), tahle karta je tu teď jen jako připravený rámeček
// pro budoucí data, ne proto, že by něco počítala.

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import MonthGrid from '@/components/MonthGrid';
import { getMonthSummary, getSettings } from '@/lib/db';
import { formatHours, monthNameUpper, todayIso } from '@/lib/format';
import type { MonthDaySummary } from '@/lib/types';
import { colors, fonts, radii, MIN_TOUCH } from '@/theme';

export default function CalendarScreen() {
  const today = todayIso();

  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [summary, setSummary] = useState<Record<string, MonthDaySummary>>({});
  const [startOnMonday, setStartOnMonday] = useState(true);

  const load = useCallback(async () => {
    const [data, settings] = await Promise.all([
      getMonthSummary(visibleMonth.year, visibleMonth.month),
      getSettings(),
    ]);
    setSummary(data);
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
    return { hours, workDays };
  }, [summary]);

  const goToMonth = (delta: number) => {
    setVisibleMonth((current) => {
      const d = new Date(current.year, current.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
        <SummaryCard label="NAJETO KM" value="0 km" />
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

      <TouchableOpacity style={styles.ctaButton} onPress={() => router.push(`/day/${today}`)}>
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
  monthArrowText: { color: colors.text, fontSize: 22, fontFamily: fonts.body, marginTop: -2 },
  monthTitleBlock: { alignItems: 'center' },
  monthTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: 22, letterSpacing: 1 },
  monthYear: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 13, marginTop: 2 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  summaryValue: { color: colors.text, fontFamily: fonts.headingBold, fontSize: 18 },
  summaryValueAccent: { color: colors.accent },
  summaryLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
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
    fontSize: 16,
    letterSpacing: 1,
  },
});
