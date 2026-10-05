// Vlastní měsíční mřížka (vizuální směr "A · Stavba") - nahrazuje
// dřívější react-native-calendars (odinstalováno): požadovaný vzhled
// (plná karta vs. čárkovaný okraj, dny jiného měsíce na 35 %, žluté
// dnešní pozadí) je natolik mimo běžné theme API té knihovny, že vlastní
// výpočet měsíční mřížky (pár desítek řádků) je jednodušší než proti
// knihovně bojovat.

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { formatHours, weekdayShort } from '@/lib/format';
import { holidayName, isWeekend } from '@/lib/holidays';
import type { MonthDaySummary } from '@/lib/types';
import { colors, fonts, radii, fs } from '@/theme';

interface MonthGridProps {
  year: number;
  month: number; // 1-12
  summary: Record<string, MonthDaySummary>;
  todayIso: string;
  onSelectDay: (iso: string) => void;
  // Nastavení -> Aplikace -> "První den týdne pondělí" (viz
  // app/settings/aplikace.tsx) - jediné místo, kde tohle nastavení
  // skutečně něco ovlivňuje.
  startOnMonday: boolean;
}

interface Cell {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
}

function toIso(year: number, month: number, day: number): string {
  const d = new Date(year, month - 1, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildCells(year: number, month: number, startOnMonday: boolean): Cell[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  // Po=0..Ne=6 (startOnMonday), nebo Ne=0..So=6 (!startOnMonday, stejně
  // jako syrové Date.getDay()).
  const leading = startOnMonday ? (firstOfMonth.getDay() + 6) % 7 : firstOfMonth.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: Cell[] = [];

  // Konec předchozího měsíce - doplnění prvního (nekompletního) týdne.
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  for (let i = leading; i > 0; i--) {
    const day = prevMonthDays - i + 1;
    const d = new Date(year, month - 2, day);
    cells.push({ iso: toIso(d.getFullYear(), d.getMonth() + 1, day), day, inCurrentMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: toIso(year, month, day), day, inCurrentMonth: true });
  }

  // Začátek dalšího měsíce - doplnění posledního týdne na celých 7.
  while (cells.length % 7 !== 0) {
    const day = cells.length - (leading + daysInMonth) + 1;
    const d = new Date(year, month, day);
    cells.push({ iso: toIso(d.getFullYear(), d.getMonth() + 1, d.getDate()), day: d.getDate(), inCurrentMonth: false });
  }

  return cells;
}

export default function MonthGrid({ year, month, summary, todayIso, onSelectDay, startOnMonday }: MonthGridProps) {
  const cells = buildCells(year, month, startOnMonday);
  const rows: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View>
      <View style={styles.weekdayRow}>
        {Array.from({ length: 7 }, (_, i) => (
          <Text key={i} style={styles.weekdayLabel}>
            {weekdayShort(startOnMonday ? i : (i + 6) % 7).toUpperCase()}
          </Text>
        ))}
      </View>

      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.weekRow}>
          {row.map((cell) => {
            const daySummary = summary[cell.iso];
            const hasRecord = !!daySummary && (daySummary.hours > 0 || daySummary.days > 0 || daySummary.km > 0);
            const isToday = cell.iso === todayIso;
            // Oprava 2, D1: víkend tlumeně, státní svátek červeně (+ proužek);
            // zapisovat do nich jde normálně.
            const holiday = holidayName(cell.iso) !== null;
            const weekend = isWeekend(cell.iso);

            return (
              <TouchableOpacity
                key={cell.iso}
                style={[
                  styles.dayCell,
                  !cell.inCurrentMonth && styles.dayCellOtherMonth,
                  cell.inCurrentMonth && !hasRecord && !isToday && styles.dayCellEmpty,
                  cell.inCurrentMonth && hasRecord && !isToday && styles.dayCellFilled,
                  isToday && styles.dayCellToday,
                ]}
                onPress={() => onSelectDay(cell.iso)}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    weekend && styles.dayNumberWeekend,
                    holiday && styles.dayNumberHoliday,
                    isToday && styles.dayNumberToday,
                  ]}
                >
                  {cell.day}
                </Text>
                {holiday && <View style={[styles.holidayBar, isToday && styles.holidayBarToday]} />}
                {hasRecord && daySummary.hours > 0 && (
                  <Text style={[styles.dayHours, isToday && styles.dayHoursToday]}>
                    {formatHours(daySummary.hours, true)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  weekdayRow: { flexDirection: 'row', marginBottom: 6 },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    color: colors.textMuted,
    fontFamily: fonts.bodySemiBold,
    fontSize: fs(11),
  },
  weekRow: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  dayCell: {
    flex: 1,
    minHeight: 66,
    borderRadius: radii.calendarDay,
    alignItems: 'center',
    paddingTop: 8,
  },
  dayCellEmpty: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  dayCellFilled: {
    backgroundColor: colors.card,
  },
  dayCellOtherMonth: { opacity: 0.35 },
  dayCellToday: { backgroundColor: colors.accent },
  dayNumber: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14) },
  dayNumberToday: { color: colors.onAccent, fontFamily: fonts.bodySemiBold },
  dayNumberWeekend: { color: colors.textMuted },
  dayNumberHoliday: { color: colors.danger, fontFamily: fonts.bodySemiBold },
  holidayBar: { width: 14, height: 2, borderRadius: 1, backgroundColor: colors.danger, marginTop: 2 },
  holidayBarToday: { backgroundColor: colors.onAccent },
  dayHours: {
    color: colors.accent,
    fontFamily: fonts.headingBold,
    fontSize: fs(13),
    marginTop: 4,
  },
  dayHoursToday: { color: colors.onAccent },
});
