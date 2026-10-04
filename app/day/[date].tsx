// Detail dne (vizuální směr "A · Stavba"). Mapa a "PRŮBĚH DNE"
// (zastávky/přejezdy) ze zadání patří do etapy 3 (potřebují záznam
// polohy) - místo mrtvého UI je tu jen stručná poznámka, že to přibude
// později. "PRÁCE A STROJE" je etapa 1 obsah, restylovaná podle zadání
// + přepínač "upravit"/"hotovo" v záhlaví (vlastní rozhodnutí): výchozí
// pohled jsou čisté karty beze vstupů (jak design popisuje), teprve
// "upravit" odhalí NumPad, mazání a tlačítko pro přidání položky.
//
// ČÁST 3 (Nastavení -> Zápisy) se tu SKUTEČNĚ používá:
// - výchozí položky nového dne (applyDayDefaultsIfNeeded, jen 1. návštěva)
// - krok číselníku a zaokrouhlení (NumPad, viz lib/workCalc.ts)
// - poznámka povinná (varování při odchodu, pokud je prázdná)
// - hmatová odezva (NumPad kroky, uložení)

import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import NumPad from '@/components/NumPad';
import ScreenHeader from '@/components/ScreenHeader';
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
  updateDayRecordQuantity,
  updateVisitTimes,
} from '@/lib/db';
import { buildDayTimeline, localDayBounds, type TimelineStay } from '@/lib/dayTimeline';
import { formatDayHeaderSummary, formatDayHeaderTitle, formatKc } from '@/lib/format';
import { tapHaptic } from '@/lib/haptics';
import type { AppSettings, DayWorkRecordWithCategory, VisitWithPlace, WorkCategory } from '@/lib/types';
import { applyDayDefaultsIfNeeded, applyRounding } from '@/lib/workCalc';
import { colors, fonts, radii } from '@/theme';

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

// Úsek pobytu v tomhle dni - "0:00" / "24:00" u pobytu přes půlnoc,
// "probíhá" u dnešního probíhajícího, "?" u neznámého začátku.
function stayTimeLabel(stay: TimelineStay<VisitWithPlace>): string {
  const from = stay.startsBeforeDay ? '0:00' : stay.visit.startUncertain ? '?' : msToHHMM(stay.segStartMs);
  const to = stay.ongoing ? 'probíhá' : stay.endsAfterDay ? '24:00' : msToHHMM(stay.segEndMs);
  return `${from}–${to}`;
}

function formatDurationMinutes(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function DayDetailScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();

  const [records, setRecords] = useState<DayWorkRecordWithCategory[]>([]);
  const [note, setNote] = useState('');
  const [categories, setCategories] = useState<WorkCategory[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [visits, setVisits] = useState<VisitWithPlace[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [visitEditTarget, setVisitEditTarget] = useState<VisitWithPlace | null>(null);
  const [visitStartDraft, setVisitStartDraft] = useState('');
  const [visitEndDraft, setVisitEndDraft] = useState('');
  // Předvyplněné množství pro NOVOU položku z "NAVRHNOUT Z POBYTŮ" -
  // zadání "Návrh nic neuloží, dokud ho nepotvrdím": číslo se jen
  // připraví, skutečně se uloží až výběrem kategorie v pickeru.
  const [suggestedQuantity, setSuggestedQuantity] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!date) return;
    const loadedSettings = await getSettings();
    setSettings(loadedSettings);
    // Výchozí položky nového dne - jen při první (prázdné) návštěvě,
    // viz lib/workCalc.ts.
    await applyDayDefaultsIfNeeded(date, loadedSettings);

    const [r, n, c, v] = await Promise.all([
      getDayRecords(date),
      getDayNote(date),
      listCategories(),
      getVisitsForDay(date),
    ]);
    setRecords(r);
    setNote(n);
    setCategories(c);
    setVisits(v);
    setNowMs(Date.now());
  }, [date]);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleQuantityChange = async (recordId: number, quantity: number) => {
    setRecords((current) => current.map((r) => (r.id === recordId ? { ...r, quantity } : r)));
    await updateDayRecordQuantity(recordId, quantity);
  };

  const handleAddCategory = async (categoryId: number) => {
    if (!date) return;
    tapHaptic(!!settings?.hapticsEnabled);
    await addDayRecord(date, categoryId, suggestedQuantity ?? 0);
    setSuggestedQuantity(null);
    setPickerOpen(false);
    await load();
  };

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
  // Nastavení -> Zápisy (stejná pravidla jako ruční NumPad).
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
    setSuggestedQuantity(Math.round(hours * 100) / 100);
    setPickerOpen(true);
  };

  const handleDeleteRecord = (record: DayWorkRecordWithCategory) => {
    Alert.alert('Smazat položku', `Smazat "${record.categoryName}" z tohoto dne?`, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          tapHaptic(!!settings?.hapticsEnabled);
          await deleteDayRecord(record.id);
          await load();
        },
      },
    ]);
  };

  const handleNoteBlur = async () => {
    if (!date) return;
    await setDayNote(date, note);
  };

  const noteMissing = !!settings?.dayNoteRequired && note.trim() === '';

  const handleBack = () => {
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
      acc.kc += r.quantity * r.rateKc;
      if (r.rateType === 'hourly') acc.hours += r.quantity;
      else acc.days += r.quantity;
      return acc;
    },
    { kc: 0, hours: 0, days: 0 }
  );

  // Kategorie, co ještě nejsou dnes použité - v pickeru nemá smysl
  // nabízet duplicitní přidání téhož stroje dvakrát.
  const usedIds = new Set(records.map((r) => r.categoryId));
  const pickerOptions = categories.filter((c) => !usedIds.has(c.id));

  const timeline = date ? buildDayTimeline(visits, date, nowMs) : [];
  const stays = timeline.filter((i): i is TimelineStay<VisitWithPlace> => i.kind === 'stay');

  if (!date || !settings) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={formatDayHeaderTitle(date)}
        subtitle={formatDayHeaderSummary(totals.hours, null)}
        onBack={handleBack}
        right={
          <TouchableOpacity onPress={() => setEditMode((v) => !v)} hitSlop={8}>
            <Text style={styles.editToggleText}>{editMode ? 'HOTOVO' : 'UPRAVIT'}</Text>
          </TouchableOpacity>
        }
      />

      <FlatList
        data={records}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <Text style={styles.sectionHeader}>PRŮBĚH DNE</Text>
            <Text style={styles.mapPlaceholderText}>Mapa přijde v etapě 3 - zatím jen seznam pobytů.</Text>

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
                      <Text style={styles.travelText}>
                        Přejezd · {formatDurationMinutes(item.toMs - item.fromMs)}
                      </Text>
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
                      <Text style={[styles.rowName, muted && styles.textPrivate]}>
                        {visit.placeName ?? 'Neznámé místo'}
                      </Text>
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
          <View style={styles.row}>
            <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
            <View style={styles.rowMain}>
              <View style={styles.rowNameLine}>
                <Text style={styles.rowName}>
                  {item.categoryName}
                  {item.categoryDeleted ? ' (smazáno)' : ''}
                </Text>
                {item.rateType === 'daily' && (
                  <View style={styles.dailyBadge}>
                    <Text style={styles.dailyBadgeText}>DENNÍ</Text>
                  </View>
                )}
              </View>
              {editMode && (
                <Text style={styles.rowRate}>
                  {formatKc(item.rateKc)} / {item.rateType === 'hourly' ? 'hodinu' : 'den'}
                </Text>
              )}
            </View>

            {editMode ? (
              <>
                <NumPad
                  value={item.quantity}
                  step={item.rateType === 'hourly' ? settings.numpadStepHours : 0.5}
                  unitLabel={item.rateType === 'hourly' ? 'h' : 'd'}
                  onChange={(next) => handleQuantityChange(item.id, next)}
                  roundTypedValue={
                    item.rateType === 'hourly' ? (v) => applyRounding(v, settings.roundingMinutes) : undefined
                  }
                  hapticsEnabled={settings.hapticsEnabled}
                />
                <TouchableOpacity onPress={() => handleDeleteRecord(item)} hitSlop={10}>
                  <Text style={styles.deleteLabel}>Smazat</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.rowQuantity}>
                {item.quantity} {item.rateType === 'hourly' ? 'h' : item.quantity === 1 ? 'den' : 'dní'}
              </Text>
            )}
          </View>
        )}
        ListFooterComponent={
          <>
            {editMode && (
              <TouchableOpacity style={styles.addRowButton} onPress={() => setPickerOpen(true)}>
                <Text style={styles.addRowButtonText}>+ Přidat stroj nebo práci</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.fieldLabel}>
              Poznámka{settings.dayNoteRequired ? ' *' : ''}
            </Text>
            <TextInput
              style={[styles.noteInput, noteMissing && styles.noteInputRequired]}
              value={note}
              onChangeText={setNote}
              onBlur={handleNoteBlur}
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
        <Text style={styles.summaryText}>
          {totals.hours > 0 ? `${formatNumber(totals.hours)} h` : ''}
          {totals.hours > 0 && totals.days > 0 ? '  +  ' : ''}
          {totals.days > 0 ? `${formatNumber(totals.days)} d` : ''}
        </Text>
        <Text style={styles.summaryKc}>{formatKc(totals.kc)}</Text>
      </View>

      <BottomSheetModal
        visible={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setSuggestedQuantity(null);
        }}
      >
        <Text style={styles.modalTitle}>PŘIDAT POLOŽKU</Text>
        {suggestedQuantity !== null && (
          <Text style={styles.suggestionHint}>
            Navrženo {suggestedQuantity} h z pobytů - vyber kategorii, do které se mají přidat.
          </Text>
        )}
        <FlatList
          data={pickerOptions}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.pickerRow} onPress={() => handleAddCategory(item.id)}>
              <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
              <Text style={styles.pickerRowName}>{item.name}</Text>
              <Text style={styles.pickerRowRate}>
                {formatKc(item.rateKc)} / {item.rateType === 'hourly' ? 'hodinu' : 'den'}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Všechny kategorie jsou už pro tenhle den přidané.</Text>
          }
        />
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => {
            setPickerOpen(false);
            setSuggestedQuantity(null);
          }}
        >
          <Text style={styles.cancelButtonText}>Zavřít</Text>
        </TouchableOpacity>
      </BottomSheetModal>

      <BottomSheetModal visible={visitEditTarget !== null} onClose={() => setVisitEditTarget(null)}>
        <Text style={styles.modalTitle}>UPRAVIT POBYT</Text>
        {visitEditTarget && (
          <>
            <Text style={styles.fieldLabel}>{visitEditTarget.placeName ?? 'Neznámé místo'}</Text>
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

function formatNumber(n: number): string {
  return (Math.round(n * 100) / 100).toString().replace('.', ',');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  editToggleText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: 13, letterSpacing: 0.5 },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  mapPlaceholder: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 16,
  },
  mapPlaceholderText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, textAlign: 'center' },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: 12,
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
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15 },
  rowRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  dailyBadge: {
    backgroundColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dailyBadgeText: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: 9, letterSpacing: 0.5 },
  rowQuantity: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: 16 },
  deleteLabel: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: 13, marginLeft: 4 },
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
  addRowButtonText: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: 14 },
  fieldLabel: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
  },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
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
  summaryText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
  summaryKc: { color: colors.text, fontFamily: fonts.headingBold, fontSize: 18 },
  modalTitle: {
    color: colors.text,
    fontFamily: fonts.headingBold,
    fontSize: 16,
    letterSpacing: 1,
    marginBottom: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerRowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15, flex: 1 },
  pickerRowRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
  cancelButton: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  cancelButtonText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 15 },
  addRowButtonDisabled: { opacity: 0.4 },
  travelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 17, marginBottom: 4 },
  travelLine: { width: 2, height: 16, backgroundColor: colors.accent, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.accent },
  travelText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 11 },
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
  visitBadgeText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: 12 },
  // Soukromá místa (domov...) - tlumeně, ikona domku místo čísla (A4).
  visitRowPrivate: { opacity: 0.6 },
  visitBadgePrivate: { backgroundColor: colors.border },
  visitBadgeTextPrivate: { color: colors.textMuted },
  textPrivate: { color: colors.textMuted },
  uncertainText: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: 11, marginTop: 2 },
  visitDuration: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12 },
  saveAsPlaceLink: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: 11, marginTop: 2 },
  suggestionHint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginBottom: 12 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  timeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 140,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: 'center',
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  deleteVisitText: { color: colors.danger, fontFamily: fonts.body, fontSize: 15 },
  saveButton: {
    flex: 1,
    height: 44,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: 15, letterSpacing: 1 },
});
