// Detail dne (vizuální směr "A · Stavba").
//
// PRŮBĚH DNE - pobyty z lib/dayTimeline.ts (oprava 2, A3): úsek pobytu
// v tomhle dni, přejezdy jen mezi různými místy, soukromá místa tlumeně.
//
// MAPA a PŘEJEZDY (etapa 3) - mapa nad průběhem dne (components/
// DayMap.tsx), přejezd "18 km · 22 min" (≈ = odhad); klepnutí na řádek
// zvýrazní pobyt/přejezd na mapě, "upravit" otevře úpravu (pobyt:
// časy; přejezd: components/TripSheet.tsx - km, soukromá jízda,
// vozidlo, PŘIDAT KM DO PRÁCE A STROJŮ).
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
import DayMap, { type DayMapRoute, type DayMapStop } from '@/components/DayMap';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import StaySheet, { type StayRow, type StaySheetTarget } from '@/components/StaySheet';
import TripSheet, { type TripEdit } from '@/components/TripSheet';
import WorkItemSheet, { type ItemAssignment, type WorkItemSheetMode } from '@/components/WorkItemSheet';
import {
  addDayRecord,
  deleteDayRecord,
  deleteTrip,
  deleteVisit,
  discardTripRoute,
  getDayNote,
  getDayRecords,
  getSettings,
  getTripsForDay,
  getVisitsForDay,
  listCategories,
  listPlaces,
  listRoutePointsForTrips,
  recordedPlacesForDate,
  setPlaceSuggestionLock,
  setDayNote,
  setTripsWorkRecord,
  updateDayRecord,
  updateTripUserFields,
  updateVisitTimes,
  type TripWithState,
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
import { tripKm } from '@/lib/tripPlan';
import { ME_ID, type AppSettings, type Order, type DayWorkRecordWithCategory, type Person, type Place, type RateUnit, type RoutePoint, type Trip, type VisitWithPlace, type WorkCategory } from '@/lib/types';
import { defectWarningFor } from '@/lib/machines';
import { autoOrderFor, listOrders, listPeople, setRecordOrder, setTripOrder } from '@/lib/orders';
import { evaluateRemindersSafe, proposalForStay, workStaysForDate } from '@/lib/reminders';
import { formatDurationHM } from '@/lib/stayProposal';
import { refreshTrips } from '@/lib/visits';
import {
  applyRounding,
  dayDefaultsProposal,
  priceForRecord,
  recordAmountKc,
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
  // `stay=<placeId>` - "Upravit v aplikaci" z připomenutí: otevřít okno Zapsat pobyt.
  const { date, add, stay } = useLocalSearchParams<{ date: string; add?: string; stay?: string }>();

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
  const [trips, setTrips] = useState<TripWithState[]>([]);
  const [tripPoints, setTripPoints] = useState<Map<number, RoutePoint[]>>(new Map());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tripEditTarget, setTripEditTarget] = useState<Trip | null>(null);
  const [recordedPlaces, setRecordedPlaces] = useState<Set<number>>(new Set());
  const [staySheetTarget, setStaySheetTarget] = useState<StaySheetTarget | null>(null);
  const [stayParamDone, setStayParamDone] = useState(false);
  const [orderOptions, setOrderOptions] = useState<{ id: number; name: string }[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);

  const load = useCallback(async () => {
    if (!date) return;
    // Otevření dne NIC nezapisuje (migrace v8) - zakázka se dopočítává.
    const ordersList = await listOrders();
    setAllOrders(ordersList);
    setOrderOptions(ordersList.filter((o) => o.status !== 'paid').map((o) => ({ id: o.id, name: o.name })));
    setPeople(await listPeople());
    setPlaces(await listPlaces());
    const [s, r, n, c, v, t] = await Promise.all([
      getSettings(),
      getDayRecords(date),
      getDayNote(date),
      listCategories(true),
      getVisitsForDay(date),
      getTripsForDay(date),
    ]);
    setTrips(t);
    setTripPoints(await listRoutePointsForTrips(t.map((trip) => trip.id)));
    setRecordedPlaces(await recordedPlacesForDate(date));
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

  // --- přejezdy (etapa 3) ---

  // Přejezd k řádku "Přejezd" v průběhu dne = největší časový překryv.
  const tripForTravel = (fromMs: number, toMs: number): TripWithState | null => {
    let best: { trip: TripWithState; overlap: number } | null = null;
    for (const trip of trips) {
      const overlap = Math.min(toMs, Date.parse(trip.endAt)) - Math.max(fromMs, Date.parse(trip.startAt));
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { trip, overlap };
    }
    return best?.trip ?? null;
  };

  // Přejezd patří ke dni, kdy začal (stejně jako v kalendáři).
  const dayTrips = trips.filter((t) => {
    const { startMs, endMs } = localDayBounds(date ?? '');
    const start = Date.parse(t.startAt);
    return start >= startMs && start < endMs;
  });
  const dayWorkKm = dayTrips.filter((t) => !t.isPrivate).reduce((sum, t) => sum + tripKm(t), 0);

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
    () => (settings && date ? dayDefaultsProposal(date, todayIso(), settings, categories, records.filter((r) => r.workerId === ME_ID).length) : []),
    [settings, date, categories, records]
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

  // Etapa 6: první zápis dne pro stroj s nevyřešenou závadou -> upozornit.
  const warnDefects = async (categoryIds: number[]) => {
    if (!date) return;
    const text = await defectWarningFor(date, categoryIds).catch(() => null);
    if (text) Alert.alert('Nevyřešená závada', text);
  };

  const workerById = (id: number) => people.find((p) => p.id === id) ?? null;
  const priceFor = (category: WorkCategory, unit: RateUnit, workerId: number) =>
    settings && date ? priceForRecord(date, category, unit, settings, workerById(workerId)) : { rateKc: 0, surchargePct: 0 };

  const handleAdd = async (category: WorkCategory, unit: RateUnit, quantity: number, a: ItemAssignment) => {
    if (!date || !settings) return;
    const suggested = sheetMode?.kind === 'add' && sheetMode.suggestedHours !== null && unit === 'hour' && a.workerId === ME_ID;
    await warnDefects([category.id]);
    await addDayRecord({
      date,
      categoryId: category.id,
      quantity,
      unit,
      ...priceFor(category, unit, a.workerId),
      source: suggested ? 'suggestion' : 'manual',
      placeId: a.placeId,
      orderId: a.orderId,
      workerId: a.workerId,
      timeFrom: a.timeFrom,
      timeTo: a.timeTo,
    });
    setSheetMode(null);
    await load();
  };

  const handleAddDefaults = async (items: DefaultItemProposal[]) => {
    if (!date || !settings) return;
    // Pojistka proti dvojímu uložení (rychlé dvojklepnutí / souběh).
    if ((await getDayRecords(date)).some((r) => r.workerId === ME_ID)) {
      setSheetMode(null);
      await load();
      return;
    }
    await warnDefects(items.map((i) => i.category.id));
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
  // Změna jednotky nebo pracovníka = nová sazba (u pracovníka i příplatek);
  // vyfakturovaná položka si sazbu nechá.
  const handleSaveRecord = async (record: DayWorkRecordWithCategory, unit: RateUnit, quantity: number, a: ItemAssignment) => {
    const category = categoryById.get(record.categoryId);
    const invoiced = record.invoiceBatchId !== null;
    let rateKc = record.rateKc;
    let surchargePct: number | undefined;
    if (category && !invoiced && a.workerId !== record.workerId) {
      ({ rateKc, surchargePct } = priceFor(category, unit, a.workerId));
    } else if (category && !invoiced && unit !== record.unit) {
      rateKc = priceFor(category, unit, a.workerId).rateKc;
    }
    await updateDayRecord(record.id, { quantity, unit, rateKc, surchargePct, placeId: a.placeId, workerId: a.workerId, timeFrom: a.timeFrom, timeTo: a.timeTo });
    if (!invoiced) {
      // volba v panelu: null = automaticky, jinak ruční (migrace v7)
      const before = record.orderManual ? record.orderId : null;
      if (a.orderId !== before) await setRecordOrder(record.id, a.orderId);
      // Jiné místo a zakázka nechaná být -> znovu automaticky podle místa.
      else if (a.placeId !== record.placeId) await setRecordOrder(record.id, null);
    }
    setSheetMode(null);
    await load();
  };

  const handleDeleteRecord = (record: DayWorkRecordWithCategory) => {
    if (record.invoiceBatchId !== null) {
      Alert.alert('Nejde smazat', 'Položka je vyfakturovaná v podkladu k faktuře. Smazat ji jde až po zrušení podkladu v detailu zakázky.');
      return;
    }
    Alert.alert('Smazat položku', `Smazat "${record.categoryName}" (${formatQuantity(record.quantity, record.unit)}) z tohoto dne?`, [
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
    hours = applyRounding(hours, settings);
    if (hours <= 0) {
      Alert.alert(
        'Nic k navržení',
        'Pro tenhle den nejsou žádné pobyty na pracovních místech v časovém okně záznamu (Nastavení → Poloha a trasy).'
      );
      return;
    }
    openAdd(Math.round(hours * 100) / 100);
  };

  const defaultVehicleId =
    categories.find((c) => c.defaultUnit === 'km')?.id ?? categories.find((c) => c.rates.km > 0)?.id ?? null;

  const saveTripEdit = async (trip: Trip, edit: TripEdit) => {
    await updateTripUserFields(trip.id, edit);
    if (edit.orderId !== (trip.orderManual ? trip.orderId : null)) await setTripOrder(trip.id, edit.orderId);
  };

  const handleSaveTrip = async (trip: Trip, edit: TripEdit) => {
    await saveTripEdit(trip, edit);
    setTripEditTarget(null);
    await load();
  };

  // Pracovní km dne (stejné vozidlo), které ještě nejsou v Práci a
  // strojích - pro "sečíst všechny přejezdy dne do jedné položky".
  const unaddedTripsFor = (vehicleId: number | null, current: Trip, currentEdit: TripEdit) =>
    dayTrips
      .map((t) => (t.id === current.id ? { ...t, ...currentEdit } : t))
      .filter(
        (t) =>
          !t.isPrivate && t.workRecordId === null && (t.vehicleCategoryId ?? defaultVehicleId) === vehicleId
      );

  // Bez automatického ukládání - položka vznikne až tímhle potvrzením.
  // Sazba a příplatek platné v okamžiku zápisu (stejně jako ruční položka).
  const handleAddTripToWork = async (trip: Trip, edit: TripEdit, wholeDay: boolean) => {
    if (!date || !settings) return;
    const vehicle = categoryById.get(edit.vehicleCategoryId ?? -1);
    if (!vehicle) return;
    await saveTripEdit(trip, edit);
    const included = wholeDay ? unaddedTripsFor(vehicle.id, trip, edit) : [{ ...trip, ...edit }];
    const km = Math.round(included.reduce((sum, t) => sum + tripKm(t), 0) * 10) / 10;
    const recordId = await addDayRecord({
      date,
      categoryId: vehicle.id,
      quantity: km,
      unit: 'km',
      ...priceForRecord(date, vehicle, 'km', settings),
      source: 'trip',
      tripId: wholeDay ? null : trip.id,
    });
    await setTripsWorkRecord(
      included.map((t) => t.id),
      recordId
    );
    setTripEditTarget(null);
    await load();
  };

  const handleDiscardRoute = (trip: Trip) => {
    Alert.alert('Zahodit trasu', 'Body trasy se od přejezdu odpojí a km se spočítají jako odhad. Pokračovat?', [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Zahodit',
        style: 'destructive',
        onPress: async () => {
          await discardTripRoute(trip.id);
          await refreshTrips(Date.parse(trip.startAt));
          setTripEditTarget(null);
          await load();
        },
      },
    ]);
  };

  const handleDeleteTrip = (trip: Trip) => {
    Alert.alert('Smazat přejezd', 'Přejezd zmizí z průběhu dne i ze součtu km.', [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          await deleteTrip(trip.id);
          setTripEditTarget(null);
          await load();
        },
      },
    ]);
  };

  const tripTitle = (trip: Trip): string => {
    const nameOf = (placeId: number | null) =>
      placeId === null ? 'neznámé místo' : (visits.find((v) => v.placeId === placeId)?.placeName ?? 'místo');
    return `${msToHHMM(Date.parse(trip.startAt))}–${msToHHMM(Date.parse(trip.endAt))} · ${nameOf(trip.fromPlaceId)} → ${nameOf(trip.toPlaceId)}`;
  };

  // --- zápis pobytu (etapa 4.3, okno podle předlohy) ---

  const openStaySheet = useCallback(
    async (placeId: number) => {
      if (!date || !settings) return;
      const stay = (await workStaysForDate(date)).find((s) => s.placeId === placeId);
      if (!stay) return;
      const proposal = await proposalForStay(stay, settings, categories);
      if (!proposal) return;
      const timeline = buildDayTimeline(visits, date, Date.now()).filter((i) => i.kind === 'stay');
      const badgeIndex = timeline.findIndex((i) => i.kind === 'stay' && i.visit.placeId === placeId);
      const end = stay.lastEndMs === null ? 'teď' : msToHHMM(stay.lastEndMs);
      setStaySheetTarget({
        placeId,
        placeName: stay.placeName,
        badge: String(badgeIndex + 1),
        timeLabel: `${msToHHMM(stay.firstStartMs)}–${end} · ${formatDurationHM(stay.durationMs)}`,
        proposal,
      });
    },
    [date, settings, categories, visits]
  );

  useEffect(() => {
    if (stay && settings && visits.length > 0 && !stayParamDone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStayParamDone(true);
      openStaySheet(Number(stay));
    }
  }, [stay, settings, visits, stayParamDone, openStaySheet]);

  const handleSaveStay = async (target: StaySheetTarget, rows: StayRow[], lockFirst: boolean) => {
    if (!date || !settings) return;
    await warnDefects(rows.map((r) => r.categoryId));
    for (const row of rows) {
      const category = categoryById.get(row.categoryId);
      if (!category) continue;
      await addDayRecord({
        date,
        categoryId: category.id,
        quantity: row.quantity,
        unit: row.unit,
        ...priceForRecord(date, category, row.unit, settings),
        source: 'manual',
        placeId: target.placeId,
      });
    }
    if (rows.length > 0) await setPlaceSuggestionLock(target.placeId, rows[0].categoryId, rows[0].unit, lockFirst);
    setStaySheetTarget(null);
    await load();
    // Pobyt je zapsaný -> zrušit jeho připomenutí.
    evaluateRemindersSafe();
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

  // Hlavička dne = moje hodiny (docházka); Kč za všechny položky dne.
  const totals = records.reduce(
    (acc, r) => {
      acc.kc += recordAmountKc(r);
      if (r.workerId === ME_ID) acc[r.unit] += r.quantity;
      else if (r.unit === 'hour') acc.othersHour += r.quantity;
      return acc;
    },
    { kc: 0, hour: 0, day: 0, km: 0, othersHour: 0 }
  );
  const totalsLabel = [
    totals.hour > 0 ? formatQuantity(totals.hour, 'hour') : null,
    totals.day > 0 ? formatQuantity(totals.day, 'day') : null,
    totals.km > 0 ? formatQuantity(totals.km, 'km') : null,
    totals.othersHour > 0 ? `kolegové ${formatQuantity(totals.othersHour, 'hour')}` : null,
  ]
    .filter(Boolean)
    .join('  +  ');

  const dayPlaceIds = [...new Set(visits.filter((v) => v.placeId !== null && !v.placeIsPrivate).map((v) => v.placeId as number))];

  // Položky seskupené podle místa - každá položka jen v JEDNÉ skupině:
  // s místem u něj; moje položka bez místa u jediného pracovního místa dne
  // (dopočteno, nic se nezapisuje); jinak "Podle mých pobytů".
  const placeName = (id: number | null) => (id === null ? 'Podle mých pobytů' : (places.find((p) => p.id === id)?.name ?? 'Smazané místo'));
  const displayPlace = (r: DayWorkRecordWithCategory): number | null =>
    r.placeId ?? (r.workerId === ME_ID && dayPlaceIds.length === 1 ? dayPlaceIds[0] : null);
  const groupOrder: (number | null)[] = [];
  for (const r of records) if (!groupOrder.includes(displayPlace(r))) groupOrder.push(displayPlace(r));
  const showGroups = groupOrder.length > 1 || (groupOrder.length === 1 && groupOrder[0] !== null);
  type ListRow = { kind: 'group'; key: string; title: string; kc: number } | { kind: 'record'; key: string; record: DayWorkRecordWithCategory };
  const listRows: ListRow[] = showGroups
    ? groupOrder.flatMap((pid) => {
        const items = records.filter((r) => displayPlace(r) === pid);
        return [
          { kind: 'group' as const, key: `g${pid ?? 'auto'}`, title: placeName(pid), kc: items.reduce((sum, r) => sum + recordAmountKc(r), 0) },
          ...items.map((r) => ({ kind: 'record' as const, key: String(r.id), record: r })),
        ];
      })
    : records.map((r) => ({ kind: 'record' as const, key: String(r.id), record: r }));

  // Zakázka se dopočítává (migrace v8): kam by položka spadla automaticky -
  // podle místa; bez místa podle mých pobytů (jen moje práce, jen když
  // dnešní pobyty patří jediné zakázce).
  const autoOrderName = (placeId: number | null, workerId: number): string | null => {
    if (placeId !== null) return autoOrderFor(allOrders, placeId, date)?.name ?? null;
    if (workerId !== ME_ID) return null;
    const names = new Set(dayPlaceIds.map((p) => autoOrderFor(allOrders, p, date)?.name).filter((n): n is string => !!n));
    return names.size === 1 ? [...names][0] : null;
  };
  const orderLabel = (orderId: number | null): string | null =>
    orderId !== null && orderId > 0 ? (allOrders.find((o) => o.id === orderId)?.name ?? null) : null;
  const recordOrderName = (r: DayWorkRecordWithCategory): string | null =>
    r.invoiceBatchId !== null || r.orderManual ? orderLabel(r.orderId) : autoOrderName(r.placeId, r.workerId);
  const tripOrderName = (t: Trip): string | null => {
    if (t.invoiceBatchId !== null || t.orderManual) return orderLabel(t.orderId);
    if (t.isPrivate || !date) return null;
    return (autoOrderFor(allOrders, t.toPlaceId, date) ?? autoOrderFor(allOrders, t.fromPlaceId, date))?.name ?? null;
  };

  if (!date || !settings) return null;

  const holiday = holidayName(date);
  const weekend = isWeekend(date);

  const mapStops: DayMapStop[] = stays.flatMap((stay) => {
    const v = stay.visit;
    const latitude = v.placeId !== null ? v.placeLatitude : v.unknownLatitude;
    const longitude = v.placeId !== null ? v.placeLongitude : v.unknownLongitude;
    if (latitude === null || longitude === null) return [];
    return [
      {
        key: `visit-${v.id}`,
        coordinate: { latitude, longitude },
        label: v.placeIsPrivate ? '⌂' : String(stays.indexOf(stay) + 1),
        muted: v.placeIsPrivate,
      },
    ];
  });
  const stopCoordOfPlace = (placeId: number | null, lat: number | null, lon: number | null) => {
    if (placeId !== null) {
      const v = visits.find((x) => x.placeId === placeId && x.placeLatitude !== null);
      return v ? { latitude: v.placeLatitude as number, longitude: v.placeLongitude as number } : null;
    }
    return lat !== null && lon !== null ? { latitude: lat, longitude: lon } : null;
  };
  const mapRoutes: DayMapRoute[] = trips.flatMap((trip) => {
    const from = stopCoordOfPlace(trip.fromPlaceId, trip.fromLatitude, trip.fromLongitude);
    const to = stopCoordOfPlace(trip.toPlaceId, trip.toLatitude, trip.toLongitude);
    const points = (tripPoints.get(trip.id) ?? []).map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
    const coordinates = [...(from ? [from] : []), ...points, ...(to ? [to] : [])];
    return coordinates.length >= 2 ? [{ key: `trip-${trip.id}`, coordinates, muted: trip.isPrivate }] : [];
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={formatDayHeaderTitle(date)}
        subtitle={formatDayHeaderSummary(totals.hour, dayWorkKm > 0 ? dayWorkKm : null)}
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
        data={listRows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <Text style={styles.sectionHeader}>PRŮBĚH DNE</Text>
            <DayMap stops={mapStops} routes={mapRoutes} selectedKey={selectedKey} />

            {stays.length === 0 ? (
              <View style={styles.mapPlaceholder}>
                <Text style={styles.mapPlaceholderText}>Zatím žádné zaznamenané pobyty pro tenhle den.</Text>
              </View>
            ) : (
              timeline.map((item, index) => {
                if (item.kind === 'travel') {
                  const trip = tripForTravel(item.fromMs, item.toMs);
                  const key = trip ? `trip-${trip.id}` : `travel-${index}`;
                  const kmLabel = trip
                    ? ` · ${trip.isEstimate && trip.kmOverride === null ? '≈ ' : ''}${formatNumberCs(Math.round(tripKm(trip) * 10) / 10)} km${
                        trip.roadStatus === 'pending' && trip.kmOverride === null ? ' (dopočítává se)' : ''
                      }`
                    : '';
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.travelRow, selectedKey === key && styles.travelRowSelected]}
                      onPress={() => setSelectedKey((k) => (k === key ? null : key))}
                    >
                      <View style={[styles.travelLine, trip?.isPrivate && styles.travelLinePrivate]} />
                      <Text style={styles.travelText}>
                        Přejezd{kmLabel} · {formatDurationMinutes(item.toMs - item.fromMs)}
                        {trip?.isPrivate ? ' · soukromá' : ''}
                        {trip?.workRecordId ? ' · v práci ✓' : ''}
                        {trip && !trip.isPrivate && allOrders.length > 0 ? ` · ${tripOrderName(trip) ?? 'bez zakázky'}` : ''}
                      </Text>
                      {trip && (
                        <TouchableOpacity onPress={() => setTripEditTarget(trip)} hitSlop={10}>
                          <Text style={styles.editChip}>upravit</Text>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                }
                const visit = item.visit;
                const muted = visit.placeIsPrivate;
                return (
                  <TouchableOpacity
                    key={visit.id}
                    style={[
                      styles.visitRow,
                      muted && styles.visitRowPrivate,
                      selectedKey === `visit-${visit.id}` && styles.visitRowSelected,
                    ]}
                    onPress={() => setSelectedKey((k) => (k === `visit-${visit.id}` ? null : `visit-${visit.id}`))}
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
                      {visit.placeId !== null && !visit.placeIsPrivate && !recordedPlaces.has(visit.placeId) && (
                        <TouchableOpacity onPress={() => openStaySheet(visit.placeId as number)} hitSlop={8}>
                          <Text style={styles.saveAsPlaceLink}>Zapsat pobyt ›</Text>
                        </TouchableOpacity>
                      )}
                      {visit.placeId === null && (
                        <TouchableOpacity onPress={() => handleSaveUnknownAsPlace(visit)} hitSlop={8}>
                          <Text style={styles.saveAsPlaceLink}>Uložit jako nové místo</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.visitRight}>
                      <Text style={styles.visitDuration}>
                        {visit.startUncertain && !item.startsBeforeDay
                          ? 'začátek neznámý'
                          : formatDurationMinutes(item.segEndMs - item.segStartMs)}
                      </Text>
                      <TouchableOpacity onPress={() => openEditVisit(visit)} hitSlop={10}>
                        <Text style={styles.editChip}>upravit</Text>
                      </TouchableOpacity>
                    </View>
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
        renderItem={({ item: row }) => {
          if (row.kind === 'group') {
            return (
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle} numberOfLines={1}>
                  {row.title}
                </Text>
                <Text style={styles.groupKc}>{formatKc(row.kc)}</Text>
              </View>
            );
          }
          const item = row.record;
          const worker = item.workerId !== ME_ID ? (people.find((p) => p.id === item.workerId)?.name ?? 'kolega') : null;
          return (
            <TouchableOpacity style={styles.row} onPress={() => setSheetMode({ kind: 'edit', record: item })}>
              <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
              <View style={styles.rowMain}>
                <Text style={styles.rowName}>
                  {item.categoryName}
                  {item.categoryDeleted ? ' (smazáno)' : ''}
                  {worker ? <Text style={styles.rowWorker}> · {worker}</Text> : null}
                </Text>
                <Text style={styles.rowRate}>
                  {formatQuantity(item.quantity, item.unit)} · {formatNumberCs(item.rateKc)} {UNIT_RATE_LABEL[item.unit]}
                  {item.surchargePct > 0 ? ` · +${formatNumberCs(item.surchargePct)} %` : ''}
                  {item.timeFrom && item.timeTo ? ` · ${item.timeFrom}–${item.timeTo}` : ''}
                  {item.placeId === null && showGroups && displayPlace(item) !== null ? ' · místo podle pobytu' : ''}
                </Text>
                {recordOrderName(item) ? (
                  <Text style={styles.orderTag} numberOfLines={1}>
                    {recordOrderName(item)}
                  </Text>
                ) : allOrders.length > 0 ? (
                  <Text style={styles.noOrderTag}>bez zakázky</Text>
                ) : null}
              </View>
              <Text style={styles.rowQuantity}>{formatKc(recordAmountKc(item))}</Text>
            </TouchableOpacity>
          );
        }}
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
        priceFor={priceFor}
        onClose={() => setSheetMode(null)}
        onAdd={handleAdd}
        onAddDefaults={handleAddDefaults}
        onSave={handleSaveRecord}
        orders={orderOptions}
        onDelete={handleDeleteRecord}
        places={places}
        dayPlaceIds={dayPlaceIds}
        people={people}
        onPlaceCreated={(place) => setPlaces((list) => [...list, place])}
        onPeopleChanged={async () => setPeople(await listPeople())}
        autoOrderName={autoOrderName}
      />

      <StaySheet
        target={staySheetTarget}
        categories={categories}
        settings={settings}
        onClose={() => setStaySheetTarget(null)}
        onSave={handleSaveStay}
      />

      <TripSheet
        trip={tripEditTarget}
        title={tripEditTarget ? tripTitle(tripEditTarget) : ''}
        vehicles={categories}
        defaultVehicleId={defaultVehicleId}
        dayWorkKmNotAdded={
          tripEditTarget
            ? unaddedTripsFor(tripEditTarget.vehicleCategoryId ?? defaultVehicleId, tripEditTarget, {
                kmOverride: tripEditTarget.kmOverride,
                isPrivate: tripEditTarget.isPrivate,
                vehicleCategoryId: tripEditTarget.vehicleCategoryId,
                orderId: tripEditTarget.orderManual ? tripEditTarget.orderId : null,
              }).reduce((sum, t) => sum + tripKm(t), 0)
            : 0
        }
        onClose={() => setTripEditTarget(null)}
        onSave={handleSaveTrip}
        onAddToWork={handleAddTripToWork}
        onDiscardRoute={handleDiscardRoute}
        onDelete={handleDeleteTrip}
        orders={orderOptions}
        autoOrderName={
          tripEditTarget && date
            ? (autoOrderFor(allOrders, tripEditTarget.toPlaceId, date) ?? autoOrderFor(allOrders, tripEditTarget.fromPlaceId, date))?.name ?? null
            : null
        }
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
  rowWorker: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  orderTag: {
    alignSelf: 'flex-start',
    color: '#7FA7C9',
    fontFamily: fonts.bodySemiBold,
    fontSize: fs(11),
    borderWidth: 1,
    borderColor: '#7FA7C9',
    borderRadius: 4,
    paddingHorizontal: 5,
    marginTop: 3,
    overflow: 'hidden',
  },
  noOrderTag: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11), fontStyle: 'italic', marginTop: 3 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, marginBottom: 4, gap: 8 },
  groupTitle: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(13), letterSpacing: 0.8, flex: 1 },
  groupKc: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
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
  travelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 17, paddingRight: 8, minHeight: 36, marginBottom: 4 },
  travelLine: { width: 2, height: 16, backgroundColor: colors.accent, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.accent },
  travelText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), flex: 1 },
  travelRowSelected: { backgroundColor: colors.card, borderRadius: radii.card },
  travelLinePrivate: { backgroundColor: colors.textMuted, borderColor: colors.textMuted },
  visitRowSelected: { borderWidth: 1, borderColor: colors.accent },
  visitRight: { alignItems: 'flex-end', gap: 6 },
  editChip: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(12) },
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
