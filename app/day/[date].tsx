// Detail dne (vizuální směr "A · Stavba").
//
// PRŮBĚH DNE - pobyty z lib/dayTimeline.ts (oprava 2, A3): úsek pobytu
// v tomhle dni, přejezdy jen mezi různými místy, soukromá místa tlumeně.
//
// PRÁCE A STROJE (oprava 2, D2) - žádný přepínač "upravit": "+ Přidat"
// -> nabídka strojů -> číselník s jednotkou -> OK = uloženo; klepnutí
// na položku -> úprava množství/jednotky + Smazat (components/
// WorkItemSheet.tsx). Výchozí položky se NIKDY neuloží samy - v
// prázdném dni se jen nabídnou v panelu "+ Přidat" (B2).
//
// Nastavení -> Zápisy se tu používá: výchozí položky, délka dne, krok
// číselníku a zaokrouhlení, příplatky, povinná poznámka.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import WorkItemSheet, { type WorkItemSheetMode } from '@/components/WorkItemSheet';
import {
  addDayRecord,
  deleteDayRecord,
  deleteVisit,
  getDayNote,
  getDayRecords,
  getSettings,
  getVisitsForDay,
  listCategories,
  setDayNote,
  updateDayRecord,
  updateVisitTimes,
} from '@/lib/db';
import { buildDayTimeline, localDayBounds, type TimelineStay } from '@/lib/dayTimeline';
import {
  formatDayHeaderSummary,
  formatDayHeaderTitle,
  formatKc,
  formatNumberCs,
  formatQuantity,
  todayIso,
  UNIT_RATE_LABEL,
} from '@/lib/format';
import { geocodeKey, nearLocalityLabel, resolveLocalities } from '@/lib/geocode';
import { holidayName, isWeekend } from '@/lib/holidays';
import type { AppSettings, DayWorkRecordWithCategory, RateUnit, VisitWithPlace, WorkCategory } from '@/lib/types';
import {
  applyRounding,
  dayDefaultsProposal,
  priceForRecord,
  recordAmountKc,
  surchargePctFor,
  type DefaultItemProposal,
} from '@/lib/workCalc';
import { colors, fonts, radii, fs } from '@/theme';

function msToHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isoToHHMM(iso: string): string {
  return msToHHMM(Date.parse(iso));
}

// Čas "HH:MM" na LOKÁLNÍ den daného okamžiku -> ISO (UTC). null = neplatný čas.
function withLocalTime(baseMs: number, hhmm: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  const d = new Date(baseMs);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
}

function formatDurationMinutes(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// Úsek pobytu v tomhle dni - "0:00" / "24:00" u pobytu přes půlnoc,
// "probíhá" u dnešního probíhajícího, "?" u neznámého začátku.
function stayTimeLabel(stay: TimelineStay<VisitWithPlace>): string {
  const from = stay.startsBeforeDay ? '0:00' : stay.visit.startUncertain ? '?' : msToHHMM(stay.segStartMs);
  const to = stay.ongoing ? 'probíhá' : stay.endsAfterDay ? '24:00' : msToHHMM(stay.segEndMs);
  return `${from}–${to}`;
}

export default function DayDetailScreen() {
  // `add=1` - otevřeno z "+ ZAPSAT DNEŠEK" (kalendář): rovnou nabídnout přidání.
  const { date, add } = useLocalSearchParams<{ date: string; add?: string }>();

  const [records, setRecords] = useState<DayWorkRecordWithCategory[]>([]);
  const [note, setNote] = useState('');
  const [allCategories, setAllCategories] = useState<WorkCategory[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sheetMode, setSheetMode] = useState<WorkItemSheetMode | null>(null);
  const [visits, setVisits] = useState<VisitWithPlace[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [visitEditTarget, setVisitEditTarget] = useState<VisitWithPlace | null>(null);
  const [visitStartDraft, setVisitStartDraft] = useState('');
  const [visitEndDraft, setVisitEndDraft] = useState('');
  const [autoAddDone, setAutoAddDone] = useState(false);
  const [localities, setLocalities] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    if (!date) return;
    const [s, r, n, c, v] = await Promise.all([
      getSettings(),
      getDayRecords(date),
      getDayNote(date),
      listCategories(true),
      getVisitsForDay(date),
    ]);
    setSettings(s);
    setRecords(r);
    setNote(n);
    setAllCategories(c);
    setVisits(v);
    setNowMs(Date.now());
    // "Neznámé místo · u Tábora" (F2) - obec se doplní dodatečně.
    const unknown = v.flatMap((visit) =>
      visit.placeId === null && visit.unknownLatitude !== null && visit.unknownLongitude !== null
        ? [{ latitude: visit.unknownLatitude, longitude: visit.unknownLongitude }]
        : []
    );
    if (unknown.length > 0) {
      resolveLocalities(unknown)
        .then(setLocalities)
        .catch(() => {});
    }
  }, [date]);

  const visitName = (visit: VisitWithPlace): string => {
    if (visit.placeName) return visit.placeName;
    if (visit.unknownLatitude === null || visit.unknownLongitude === null) return 'Neznámé místo';
    const locality = localities.get(geocodeKey(visit.unknownLatitude, visit.unknownLongitude));
    return locality ? `Neznámé místo · ${nearLocalityLabel(locality)}` : 'Neznámé místo';
  };

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const categories = useMemo(() => allCategories.filter((c) => !c.isDeleted), [allCategories]);
  const categoryById = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories]);
  const proposals = useMemo(
    () => (settings && date ? dayDefaultsProposal(date, todayIso(), settings, categories, records.length) : []),
    [settings, date, categories, records.length]
  );

  const openAdd = useCallback(
    (suggestedHours: number | null = null) => setSheetMode({ kind: 'add', suggestedHours, proposals }),
    [proposals]
  );

  // "+ ZAPSAT DNEŠEK" -> panel přidání hned po načtení (jen jednou).
  useEffect(() => {
    if (add === '1' && settings && !autoAddDone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAutoAddDone(true);
      openAdd();
    }
  }, [add, settings, autoAddDone, openAdd]);

  // --- položky práce ---

  const handleAdd = async (category: WorkCategory, unit: RateUnit, quantity: number) => {
    if (!date || !settings) return;
    const suggested = sheetMode?.kind === 'add' && sheetMode.suggestedHours !== null && unit === 'hour';
    await addDayRecord({
      date,
      categoryId: category.id,
      quantity,
      unit,
      ...priceForRecord(date, category, unit, settings),
      source: suggested ? 'suggestion' : 'manual',
    });
    setSheetMode(null);
    await load();
  };

  const handleAddDefaults = async (items: DefaultItemProposal[]) => {
    if (!date || !settings) return;
    // Pojistka proti dvojímu uložení (rychlé dvojklepnutí / souběh).
    if ((await getDayRecords(date)).length > 0) {
      setSheetMode(null);
      await load();
      return;
    }
    for (const item of items) {
      await addDayRecord({
        date,
        categoryId: item.category.id,
        quantity: item.quantity,
        unit: item.unit,
        ...priceForRecord(date, item.category, item.unit, settings),
        source: 'default',
      });
    }
    setSheetMode(null);
    await load();
  };

  // Změna jednotky vezme sazbu té jednotky z AKTUÁLNÍHO ceníku; uložený
  // příplatek položky zůstává.
  const handleSaveRecord = async (record: DayWorkRecordWithCategory, unit: RateUnit, quantity: number) => {
    const category = categoryById.get(record.categoryId);
    const rateKc = unit === record.unit || !category ? record.rateKc : category.rates[unit];
    await updateDayRecord(record.id, { quantity, unit, rateKc });
    setSheetMode(null);
    await load();
  };

  const handleDeleteRecord = (record: DayWorkRecordWithCategory) => {
    Alert.alert('Smazat položku', `Smazat "${record.categoryName}" z tohoto dne?`, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          await deleteDayRecord(record.id);
          setSheetMode(null);
          await load();
        },
      },
    ]);
  };

  // --- pobyty ---

  const timeline = date ? buildDayTimeline(visits, date, nowMs) : [];
  const stays = timeline.filter((i): i is TimelineStay<VisitWithPlace> => i.kind === 'stay');

  const openEditVisit = (visit: VisitWithPlace) => {
    setVisitEditTarget(visit);
    setVisitStartDraft(visit.startUncertain ? '' : isoToHHMM(visit.startAt));
    setVisitEndDraft(visit.endAt ? isoToHHMM(visit.endAt) : '');
  };

  // Čas se mění v rámci PŮVODNÍHO dne začátku/konce (pobyt přes
  // půlnoc se upravuje ze kteréhokoliv dne správně); nezměněné pole
  // zachová původní hodnotu přesně.
  const commitVisitTimes = async () => {
    if (!visitEditTarget || !date) return;
    const target = visitEditTarget;
    const originalStartDraft = target.startUncertain ? '' : isoToHHMM(target.startAt);
    const originalEndDraft = target.endAt ? isoToHHMM(target.endAt) : '';
    const viewDayStart = localDayBounds(date).startMs;

    let startIso: string | null = target.startAt;
    if (visitStartDraft.trim() !== originalStartDraft) {
      startIso = withLocalTime(target.startUncertain ? viewDayStart : Date.parse(target.startAt), visitStartDraft);
    }
    if (startIso === null) {
      Alert.alert('Neplatný čas', 'Zadej čas "od" ve formátu HH:MM.');
      return;
    }

    let endIso: string | null = target.endAt;
    if (visitEndDraft.trim() !== originalEndDraft) {
      if (!visitEndDraft.trim()) {
        endIso = null;
      } else {
        endIso = withLocalTime(target.endAt ? Date.parse(target.endAt) : viewDayStart, visitEndDraft);
        if (endIso === null) {
          Alert.alert('Neplatný čas', 'Zadej čas "do" ve formátu HH:MM, nebo pole smaž (pobyt probíhá).');
          return;
        }
      }
    }
    if (endIso !== null && endIso <= startIso) {
      Alert.alert('Neplatný čas', 'Konec pobytu musí být po jeho začátku.');
      return;
    }
    await updateVisitTimes(target.id, startIso, endIso);
    setVisitEditTarget(null);
    await load();
  };

  const handleDeleteVisit = () => {
    if (!visitEditTarget) return;
    const target = visitEditTarget;
    Alert.alert('Smazat pobyt', 'Opravdu smazat tenhle pobyt?', [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          await deleteVisit(target.id);
          setVisitEditTarget(null);
          await load();
        },
      },
    ]);
  };

  const handleSaveUnknownAsPlace = (visit: VisitWithPlace) => {
    if (visit.unknownLatitude === null || visit.unknownLongitude === null) return;
    router.push(
      `/settings/place-edit?lat=${visit.unknownLatitude}&lon=${visit.unknownLongitude}&rebuildFrom=${encodeURIComponent(visit.startAt)}`
    );
  };

  // Zadání ČÁST B bod 7 / oprava 2 - jen pobyty mimo soukromá místa,
  // jen úsek v TOMHLE dni a jen v časovém okně záznamu (Nastavení ->
  // Poloha a trasy), s odečtením přestávky a zaokrouhlením podle
  // Nastavení -> Zápisy (stejná pravidla jako ruční číselník).
  // Neznámá místa se počítají (typicky nová stavba) - kde to nesedí,
  // pobyt jde smazat nebo místo uložit jako soukromé.
  const handleSuggestFromVisits = () => {
    if (!settings || !date) return;
    const dayStart = localDayBounds(date).startMs;
    const windowStart = new Date(dayStart);
    windowStart.setMinutes(settings.trackingStartMinutes);
    const windowEnd = new Date(dayStart);
    windowEnd.setMinutes(settings.trackingEndMinutes);
    const trackingDay = settings.trackingDays.includes(new Date(dayStart).getDay());

    let totalMs = 0;
    if (trackingDay) {
      for (const stay of stays) {
        if (stay.visit.placeIsPrivate || stay.visit.startUncertain) continue;
        const from = Math.max(stay.segStartMs, windowStart.getTime());
        const to = Math.min(stay.segEndMs, windowEnd.getTime());
        if (to > from) totalMs += to - from;
      }
    }
    let hours = totalMs / 3600000;
    if (settings.autoSubtractBreak) hours = Math.max(0, hours - settings.breakMinutes / 60);
    hours = applyRounding(hours, settings.roundingMinutes);
    if (hours <= 0) {
      Alert.alert(
        'Nic k navržení',
        'Pro tenhle den nejsou žádné pobyty na pracovních místech v časovém okně záznamu (Nastavení → Poloha a trasy).'
      );
      return;
    }
    openAdd(Math.round(hours * 100) / 100);
  };

  // --- poznámka ---

  const saveNote = async () => {
    if (!date) return;
    await setDayNote(date, note);
  };

  const noteMissing = !!settings?.dayNoteRequired && note.trim() === '';

  const handleBack = async () => {
    await saveNote(); // pro jistotu, kdyby pole ještě mělo fokus
    if (noteMissing) {
      Alert.alert('Chybí poznámka', 'Nastavení vyžaduje poznámku ke dni. Opravdu odejít bez ní?', [
        { text: 'Zpět k zápisu', style: 'cancel' },
        { text: 'Odejít', onPress: () => router.back() },
      ]);
      return;
    }
    router.back();
  };

  const totals = records.reduce(
    (acc, r) => {
      acc.kc += recordAmountKc(r);
      acc[r.unit] += r.quantity;
      return acc;
    },
    { kc: 0, hour: 0, day: 0, km: 0 }
  );
  const totalsLabel = [
    totals.hour > 0 ? formatQuantity(totals.hour, 'hour') : null,
    totals.day > 0 ? formatQuantity(totals.day, 'day') : null,
    totals.km > 0 ? formatQuantity(totals.km, 'km') : null,
  ]
    .filter(Boolean)
    .join('  +  ');

  if (!date || !settings) return null;

  const holiday = holidayName(date);
  const weekend = isWeekend(date);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={formatDayHeaderTitle(date)}
        subtitle={formatDayHeaderSummary(totals.hour, totals.km > 0 ? totals.km : null)}
        onBack={handleBack}
      />
      {(holiday || weekend) && (
        <View style={[styles.dayBadge, holiday ? styles.dayBadgeHoliday : styles.dayBadgeWeekend]}>
          <Text style={[styles.dayBadgeText, holiday ? styles.dayBadgeTextHoliday : null]}>
            {holiday ? `Státní svátek · ${holiday}` : 'Víkend'}
          </Text>
        </View>
      )}

      <FlatList
        data={records}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <Text style={styles.sectionHeader}>PRŮBĚH DNE</Text>

            {stays.length === 0 ? (
              <View style={styles.mapPlaceholder}>
                <Text style={styles.mapPlaceholderText}>Zatím žádné zaznamenané pobyty pro tenhle den.</Text>
              </View>
            ) : (
              timeline.map((item, index) => {
                if (item.kind === 'travel') {
                  return (
                    <View key={`travel-${index}`} style={styles.travelRow}>
                      <View style={styles.travelLine} />
                      <Text style={styles.travelText}>Přejezd · {formatDurationMinutes(item.toMs - item.fromMs)}</Text>
                    </View>
                  );
                }
                const visit = item.visit;
                const muted = visit.placeIsPrivate;
                return (
                  <TouchableOpacity
                    key={visit.id}
                    style={[styles.visitRow, muted && styles.visitRowPrivate]}
                    onPress={() => openEditVisit(visit)}
                  >
                    <View style={[styles.visitBadge, muted && styles.visitBadgePrivate]}>
                      <Text style={[styles.visitBadgeText, muted && styles.visitBadgeTextPrivate]}>
                        {muted ? '⌂' : stays.indexOf(item) + 1}
                      </Text>
                    </View>
                    <View style={styles.rowMain}>
                      <Text style={[styles.rowName, muted && styles.textPrivate]}>{visitName(visit)}</Text>
                      <Text style={styles.rowRate}>{stayTimeLabel(item)}</Text>
                      {item.uncertainEnd && (
                        <TouchableOpacity onPress={() => openEditVisit(visit)} hitSlop={8}>
                          <Text style={styles.uncertainText}>
                            Nejistý konec (bez odjezdu od {shortDate(Date.parse(visit.startAt))}) · Doplnit konec
                          </Text>
                        </TouchableOpacity>
                      )}
                      {visit.placeId === null && (
                        <TouchableOpacity onPress={() => handleSaveUnknownAsPlace(visit)} hitSlop={8}>
                          <Text style={styles.saveAsPlaceLink}>Uložit jako nové místo</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.visitDuration}>
                      {visit.startUncertain && !item.startsBeforeDay
                        ? 'začátek neznámý'
                        : formatDurationMinutes(item.segEndMs - item.segStartMs)}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity
              style={[styles.addRowButton, stays.length === 0 && styles.addRowButtonDisabled]}
              onPress={handleSuggestFromVisits}
              disabled={stays.length === 0}
            >
              <Text style={styles.addRowButtonText}>NAVRHNOUT Z POBYTŮ</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeader}>PRÁCE A STROJE</Text>
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => setSheetMode({ kind: 'edit', record: item })}>
            <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
            <View style={styles.rowMain}>
              <Text style={styles.rowName}>
                {item.categoryName}
                {item.categoryDeleted ? ' (smazáno)' : ''}
              </Text>
              <Text style={styles.rowRate}>
                {formatQuantity(item.quantity, item.unit)} · {formatNumberCs(item.rateKc)} {UNIT_RATE_LABEL[item.unit]}
                {item.surchargePct > 0 ? ` · +${formatNumberCs(item.surchargePct)} %` : ''}
              </Text>
            </View>
            <Text style={styles.rowQuantity}>{formatKc(recordAmountKc(item))}</Text>
          </TouchableOpacity>
        )}
        ListFooterComponent={
          <>
            <TouchableOpacity style={styles.addRowButton} onPress={() => openAdd()}>
              <Text style={styles.addRowButtonText}>+ Přidat stroj nebo práci</Text>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Poznámka{settings.dayNoteRequired ? ' *' : ''}</Text>
            <TextInput
              style={[styles.noteInput, noteMissing && styles.noteInputRequired]}
              value={note}
              onChangeText={setNote}
              onBlur={saveNote}
              multiline
              placeholder={settings.dayNoteRequired ? 'Poznámka je povinná' : 'Volitelná poznámka ke dni'}
              placeholderTextColor={colors.textMuted}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          </>
        }
        ListEmptyComponent={<Text style={styles.empty}>Zatím žádné položky pro tenhle den.</Text>}
      />

      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>{totalsLabel}</Text>
        <Text style={styles.summaryKc}>{formatKc(totals.kc)}</Text>
      </View>

      <WorkItemSheet
        mode={sheetMode}
        categories={categories}
        categoryById={categoryById}
        settings={settings}
        surchargePctFor={(category) => surchargePctFor(date, category, settings)}
        onClose={() => setSheetMode(null)}
        onAdd={handleAdd}
        onAddDefaults={handleAddDefaults}
        onSave={handleSaveRecord}
        onDelete={handleDeleteRecord}
      />

      <BottomSheetModal visible={visitEditTarget !== null} onClose={() => setVisitEditTarget(null)}>
        <Text style={styles.modalTitle}>UPRAVIT POBYT</Text>
        {visitEditTarget && (
          <>
            <Text style={styles.fieldLabel}>{visitName(visitEditTarget)}</Text>
            <Text style={styles.rowRate}>
              {visitEditTarget.startUncertain ? 'začátek neznámý' : `od ${shortDate(Date.parse(visitEditTarget.startAt))}`}
              {visitEditTarget.endAt ? ` · do ${shortDate(Date.parse(visitEditTarget.endAt))}` : ' · bez odjezdu'}
            </Text>
            <View style={styles.timeRow}>
              <Text style={styles.rowName}>Od</Text>
              <TextInput
                style={styles.timeInput}
                value={visitStartDraft}
                onChangeText={setVisitStartDraft}
                placeholder={visitEditTarget.startUncertain ? 'neznámý' : '08:00'}
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
              />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.rowName}>Do</Text>
              <TextInput
                style={styles.timeInput}
                value={visitEndDraft}
                onChangeText={setVisitEndDraft}
                placeholder="prázdné = probíhá"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
                inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
              />
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={handleDeleteVisit}>
                <Text style={styles.deleteVisitText}>Smazat pobyt</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={commitVisitTimes}>
                <Text style={styles.saveButtonText}>ULOŽIT</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  dayBadge: {
    alignSelf: 'center',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 8,
  },
  dayBadgeWeekend: { backgroundColor: colors.border },
  dayBadgeHoliday: { backgroundColor: colors.danger },
  dayBadgeText: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(12) },
  dayBadgeTextHoliday: { color: colors.text },
  mapPlaceholder: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 16,
  },
  mapPlaceholderText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), textAlign: 'center' },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: fs(12),
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  colorSwatch: { width: 14, height: 14, borderRadius: 3 },
  rowMain: { flex: 1 },
  rowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  rowRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 2 },
  rowQuantity: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(16) },
  empty: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.body, marginVertical: 16 },
  addRowButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radii.card,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  addRowButtonText: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  addRowButtonDisabled: { opacity: 0.4 },
  fieldLabel: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: fs(12),
    letterSpacing: 1,
    marginBottom: 8,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fs(15),
    fontFamily: fonts.body,
    minHeight: 60,
    textAlignVertical: 'top',
    color: colors.text,
    backgroundColor: colors.card,
  },
  noteInputRequired: { borderColor: colors.danger },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  summaryText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(14) },
  summaryKc: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(18) },
  modalTitle: {
    color: colors.text,
    fontFamily: fonts.headingBold,
    fontSize: fs(16),
    letterSpacing: 1,
    marginBottom: 12,
  },
  cancelButton: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  travelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 17, marginBottom: 4 },
  travelLine: { width: 2, height: 16, backgroundColor: colors.accent, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.accent },
  travelText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11) },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 4,
    gap: 10,
  },
  visitBadge: {
    width: 22,
    height: 22,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitBadgeText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(12) },
  // Soukromá místa (domov...) - tlumeně, ikona domku místo čísla (A4).
  visitRowPrivate: { opacity: 0.6 },
  visitBadgePrivate: { backgroundColor: colors.border },
  visitBadgeTextPrivate: { color: colors.textMuted },
  textPrivate: { color: colors.textMuted },
  uncertainText: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(11), marginTop: 2 },
  visitDuration: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  saveAsPlaceLink: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(11), marginTop: 2 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  timeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 140,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: 'center',
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  deleteVisitText: { color: colors.danger, fontFamily: fonts.body, fontSize: fs(15) },
  saveButton: {
    flex: 1,
    height: 44,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
});
