// Připomenutí zápisu (etapa 4.3) - místní upozornění přes
// modules/dochazka-native (bez expo-notifications, viz
// ios/LocalNotifications.swift).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - připomenutí se nevyvolávají jednotlivými
// událostmi, ale po každém přepočtu pobytů a po každém zápisu se
// "požadovaný stav" upozornění na dnešek spočítá znovu
// (evaluateReminders): naplánovat nová, přeplánovat změněná, zrušit
// zbytečná (pobyt mezitím zapsaný, návrat na místo, "Dnes nezapisovat").
// Stav je v reminder_state, ať upozornění nechodí dvakrát.
//
// Pobyt = jedno pracovní místo za den (víc pobytů na stejném místě se
// sečte); "zapsaný" = v ten den existuje zápis s tímhle místem
// (day_work_records.place_id). Nikdy pro soukromá místa. Neznámá místa
// (rozhodnutí po etapě 4) až od delšího pobytu (výchozí 60 min) - zapsaný
// je pobyt, u kterého proběhl zápis z upozornění (stav 'written'); akce
// "Uložit jako pracovní místo" otevře uložení místa s názvem podle obce.

import { router, type Href } from 'expo-router';

import DochazkaNative, { type NotificationAction, type NotificationResponse } from '../modules/dochazka-native/src/DochazkaNative';
import {
  addDayRecord,
  addDebugLogEntry,
  getLatestVisit,
  getPlaceSuggestion,
  getSettings,
  getVisitsForDay,
  listCategories,
  listReminderStates,
  recordedPlacesForDate,
  setReminderState,
  type ReminderState,
} from './db';
import { buildDayTimeline, localDayBounds, type TimelineStay } from './dayTimeline';
import { geocodeKey, nearLocalityLabel, resolveLocalities } from './geocode';
import { distanceMeters } from './geo';
import { formatNumberCs, formatQuantity, todayIso } from './format';
import { isWorkday } from './holidays';
import { formatDurationHM, proposeStayRecord, type StayProposal } from './stayProposal';
import type { AppSettings, VisitWithPlace, WorkCategory } from './types';
import { runExclusive } from './visits';
import { priceForRecord } from './workCalc';

// Pobyt na pracovním místě za den (víc pobytů na místě sečtených).
export interface WorkStay {
  date: string;
  placeId: number | null; // null = neznámé místo
  key: string; // "<placeId>" nebo "u<lat>,<lon>" (klíč připomenutí)
  latitude: number | null; // neznámé místo
  longitude: number | null;
  placeName: string;
  firstStartMs: number;
  lastEndMs: number | null; // null = pořád na místě
  durationMs: number;
}

interface StayPayload {
  kind: 'stay' | 'day';
  date: string;
  placeId?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  locality?: string | null;
  categoryId?: number;
  unit?: string;
  quantity?: number;
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// `includeUnknown` - i neznámá místa (víc pobytů do 300 m = jedno místo).
export async function workStaysForDate(date: string, nowMs = Date.now(), includeUnknown = false): Promise<WorkStay[]> {
  const visits = await getVisitsForDay(date);
  const stays = buildDayTimeline(visits, date, nowMs).filter(
    (i): i is TimelineStay<VisitWithPlace> =>
      i.kind === 'stay' &&
      !i.visit.placeIsPrivate &&
      !i.visit.startUncertain &&
      (i.visit.placeId !== null || (includeUnknown && i.visit.unknownLatitude !== null && i.visit.unknownLongitude !== null))
  );
  const groups: WorkStay[] = [];
  for (const s of stays) {
    const v = s.visit;
    const endMs = s.ongoing ? null : s.segEndMs;
    const existing = groups.find((g) =>
      v.placeId !== null
        ? g.placeId === v.placeId
        : g.placeId === null &&
          g.latitude !== null &&
          g.longitude !== null &&
          distanceMeters(g.latitude, g.longitude, v.unknownLatitude as number, v.unknownLongitude as number) <= 300
    );
    if (existing) {
      existing.durationMs += s.segEndMs - s.segStartMs;
      existing.lastEndMs = endMs;
      continue;
    }
    groups.push({
      date,
      placeId: v.placeId,
      key: v.placeId !== null ? String(v.placeId) : `u${(v.unknownLatitude as number).toFixed(3)},${(v.unknownLongitude as number).toFixed(3)}`,
      latitude: v.placeId === null ? v.unknownLatitude : null,
      longitude: v.placeId === null ? v.unknownLongitude : null,
      placeName: v.placeName ?? 'Neznámé místo',
      firstStartMs: s.segStartMs,
      lastEndMs: endMs,
      durationMs: s.segEndMs - s.segStartMs,
    });
  }
  return groups.sort((a, b) => a.firstStartMs - b.firstStartMs);
}

export async function proposalForStay(stay: WorkStay, settings: AppSettings, categories: WorkCategory[]): Promise<StayProposal | null> {
  const suggestion = stay.placeId !== null ? await getPlaceSuggestion(stay.placeId) : null;
  return proposeStayRecord(stay.durationMs, suggestion, settings, categories);
}

// Místo "Stavba X" -> "Odjezd ze stavby X" (jako v předloze), jinak "Odjezd: <místo>".
function departureTitle(placeName: string): string {
  const m = /^stavba\s+(.+)$/i.exec(placeName.trim());
  return m ? `Odjezd ze stavby ${m[1]}` : `Odjezd: ${placeName}`;
}

function proposalText(p: StayProposal): string {
  return `${p.category.name} ${formatQuantity(p.quantity, p.unit)}`;
}

function windowBounds(date: string, settings: AppSettings): { start: number; end: number } {
  const dayStart = localDayBounds(date).startMs;
  const start = new Date(dayStart);
  start.setMinutes(settings.trackingStartMinutes);
  const end = new Date(dayStart);
  end.setMinutes(settings.trackingEndMinutes);
  return { start: start.getTime(), end: end.getTime() };
}

function remindersEnabled(s: AppSettings): boolean {
  return s.reminderOnDeparture || s.reminderOnArriveHome || s.reminderEvening;
}

function schedule(id: string, title: string, body: string, fireAtMs: number, actions: NotificationAction[], payload: StayPayload) {
  DochazkaNative.scheduleNotification(id, title, body, fireAtMs, actions, JSON.stringify(payload));
}

// Volat v runExclusive (po přepočtu pobytů, po zápisu, při startu appky).
export async function evaluateReminders(): Promise<void> {
  const settings = await getSettings();
  const date = todayIso();
  const states = new Map((await listReminderStates('')).filter((s) => s.key.includes(`|${date}`)).map((s) => [s.key, s]));
  const now = Date.now();

  const desired = new Map<string, { title: string; body: string; fireAt: number; actions: NotificationAction[]; payload: StayPayload }>();
  const dayDismissed = states.get(`day|${date}`)?.state === 'dismissed';

  if (remindersEnabled(settings) && !dayDismissed && (!settings.remindersOnlyWorkdays || isWorkday(date))) {
    const categories = await listCategories();
    const recorded = await recordedPlacesForDate(date);
    const win = windowBounds(date, settings);
    const depKey = (st: WorkStay) => `dep|${date}|${st.key}`;
    const stays = (await workStaysForDate(date, now, true)).filter(
      (st) =>
        (st.placeId === null || !recorded.has(st.placeId)) &&
        states.get(depKey(st))?.state !== 'written' &&
        st.firstStartMs < win.end &&
        (st.lastEndMs ?? now) > win.start
    );
    const proposals = new Map<string, StayProposal | null>();
    for (const st of stays) proposals.set(st.key, await proposalForStay(st, settings, categories));
    // Neznámá místa -> "Neznámé místo · u <obec>" (bez sítě jen "Neznámé místo").
    const unknownPoints = stays.flatMap((st) => (st.latitude !== null && st.longitude !== null ? [{ latitude: st.latitude, longitude: st.longitude }] : []));
    const localities = unknownPoints.length > 0 ? await resolveLocalities(unknownPoints).catch(() => new Map<string, string>()) : new Map<string, string>();
    const localityOf = (st: WorkStay) => (st.latitude !== null && st.longitude !== null ? localities.get(geocodeKey(st.latitude, st.longitude)) ?? null : null);
    for (const st of stays) {
      const locality = localityOf(st);
      if (st.placeId === null && locality) st.placeName = `Neznámé místo · ${nearLocalityLabel(locality)}`;
    }

    // Po odjezdu z pracovního místa.
    if (settings.reminderOnDeparture) {
      for (const s of stays) {
        const minStay = s.placeId === null ? settings.reminderUnknownMinStayMinutes : settings.reminderMinStayMinutes;
        if (s.lastEndMs === null || s.durationMs < minStay * 60000) continue;
        const key = depKey(s);
        const state = states.get(key);
        if (state && state.state !== 'scheduled') continue; // už odesláno / večer
        const p = proposals.get(s.key);
        // iOS ukáže nejvýš 4 akce - u neznámého místa místo "Upravit"
        // "Uložit jako pracovní místo" (taky otevře appku).
        const actions: NotificationAction[] = [
          ...(p ? [{ id: 'write', title: `Zapsat: ${proposalText(p)}` }] : []),
          s.placeId === null
            ? { id: 'saveplace', title: 'Uložit jako pracovní místo', foreground: true }
            : { id: 'edit', title: 'Upravit v aplikaci', foreground: true },
          { id: 'evening', title: 'Připomenout večer' },
          { id: 'skip', title: 'Dnes nezapisovat', destructive: true },
        ];
        desired.set(key, {
          title: s.placeId === null ? `Odjezd: ${s.placeName}` : departureTitle(s.placeName),
          body:
            `${hhmm(s.firstStartMs)}–${hhmm(s.lastEndMs)} · ${formatDurationHM(s.durationMs)} na místě` +
            (p ? `\nNávrh: ${proposalText(p)}${settings.autoSubtractBreak ? ` (−${settings.breakMinutes} min přestávka)` : ''}. Podrž pro rychlý zápis.` : ''),
          fireAt: s.lastEndMs + settings.reminderDelayMinutes * 60000,
          actions,
          payload: {
            kind: 'stay',
            date,
            placeId: s.placeId,
            latitude: s.latitude,
            longitude: s.longitude,
            locality: localityOf(s),
            categoryId: p?.category.id,
            unit: p?.unit,
            quantity: p?.quantity,
          },
        });
      }
    }

    // Souhrny: pracovní místa vždy, neznámá jen po dost dlouhém pobytu.
    const finished = stays.filter(
      (st) => st.lastEndMs !== null && (st.placeId !== null || st.durationMs >= settings.reminderUnknownMinStayMinutes * 60000)
    );
    const summary = (list: WorkStay[]) =>
      list.map((s) => `${s.placeName} ${hhmm(s.firstStartMs)}–${hhmm(s.lastEndMs ?? now)}` + (proposals.get(s.key) ? ` · ${proposalText(proposals.get(s.key) as StayProposal)}` : '')).join('\n');
    const dayActions: NotificationAction[] = [
      { id: 'edit', title: 'Otevřít a zapsat', foreground: true },
      { id: 'skip', title: 'Dnes nezapisovat', destructive: true },
    ];

    // Po příjezdu domů - jedno upozornění se všemi nezapsanými pobyty.
    if (settings.reminderOnArriveHome && finished.length > 0) {
      const latest = await getLatestVisit();
      const key = `home|${date}`;
      if (latest?.placeIsHome && latest.endAt === null && Date.parse(latest.startAt) >= localDayBounds(date).startMs && !states.has(key)) {
        desired.set(key, {
          title: `Doma - nezapsáno: ${finished.length === 1 ? finished[0].placeName : `${finished.length} pobyty`}`,
          body: summary(finished),
          fireAt: now,
          actions: dayActions,
          payload: { kind: 'day', date },
        });
      }
    }

    // Večerní souhrn (jen když něco chybí) + "Připomenout večer" u pobytu.
    const snoozed = finished.filter((st) => states.get(depKey(st))?.state === 'evening');
    const eveningList = settings.reminderEvening ? finished : snoozed;
    const eveningAt = new Date(localDayBounds(date).startMs);
    eveningAt.setMinutes(settings.reminderEveningMinutes);
    if (eveningList.length > 0 && eveningAt.getTime() > now) {
      desired.set(`eve|${date}`, {
        title: `Nezapsané pobyty: ${eveningList.length}`,
        body: summary(eveningList),
        fireAt: eveningAt.getTime(),
        actions: dayActions,
        payload: { kind: 'day', date },
      });
    }
  }

  // Sladit s tím, co je naplánované.
  for (const [key, n] of desired) {
    const state = states.get(key);
    if (state?.state === 'scheduled' && state.fireAt && Date.parse(state.fireAt) <= now) {
      await setReminderState(key, 'sent', state.fireAt, state.payload); // už doručeno
      continue;
    }
    const payloadText = JSON.stringify(n.payload) + n.body;
    if (state?.state === 'scheduled' && state.payload === payloadText) continue; // beze změny
    schedule(key, n.title, n.body, n.fireAt, n.actions, n.payload);
    await setReminderState(key, 'scheduled', new Date(n.fireAt).toISOString(), payloadText);
  }
  for (const [key, state] of states) {
    if (state.state !== 'scheduled' || desired.has(key)) continue;
    if (state.fireAt && Date.parse(state.fireAt) <= now) {
      await setReminderState(key, 'sent', state.fireAt, state.payload);
    } else {
      // Zapsáno, návrat na místo, vypnuto, "Dnes nezapisovat" -> zrušit.
      DochazkaNative.cancelNotification(key);
      await setReminderState(key, 'dismissed', null, state.payload);
    }
  }
}

export function evaluateRemindersSafe(): Promise<void> {
  return runExclusive(() => evaluateReminders()).catch(() => {});
}

// --- odpovědi na upozornění ---

async function handleResponse(r: NotificationResponse): Promise<string | null> {
  let payload: StayPayload | null = null;
  try {
    payload = JSON.parse(r.data) as StayPayload;
  } catch {
    payload = null;
  }
  if (!payload || !payload.date) return null;
  const { date } = payload;

  await addDebugLogEntry({
    timestamp: new Date().toISOString(),
    eventType: 'reminder',
    detail: `připomenutí ${r.notificationId}: akce "${r.actionId}"`,
    batteryLevel: null,
    latitude: null,
    longitude: null,
  });

  switch (r.actionId) {
    case 'write': {
      if (payload.kind !== 'stay' || !payload.categoryId || payload.quantity === undefined) break;
      // Mezitím zapsané (třeba v appce nebo druhým klepnutím) - nezapisovat dvakrát.
      if (payload.placeId && (await recordedPlacesForDate(date)).has(payload.placeId)) break;
      const states = await listReminderStates(r.notificationId);
      if (states.some((st) => st.key === r.notificationId && st.state === 'written')) break;
      const settings = await getSettings();
      const category = (await listCategories()).find((c) => c.id === payload.categoryId);
      if (!category) break;
      const unit = (payload.unit as 'hour' | 'day' | 'km') ?? 'hour';
      await addDayRecord({
        date,
        categoryId: category.id,
        quantity: payload.quantity,
        unit,
        ...priceForRecord(date, category, unit, settings),
        source: 'reminder',
        placeId: payload.placeId ?? null,
      });
      await setReminderState(r.notificationId, 'written', null, '');
      await addDebugLogEntry({
        timestamp: new Date().toISOString(),
        eventType: 'reminder',
        detail: `zapsáno z upozornění: ${category.name} ${formatNumberCs(payload.quantity)} (${date})`,
        batteryLevel: null,
        latitude: null,
        longitude: null,
      });
      break;
    }
    case 'evening':
      await setReminderState(r.notificationId, 'evening', null, '');
      break;
    case 'skip':
      await setReminderState(`day|${date}`, 'dismissed', null, '');
      break;
    case 'saveplace': {
      if (payload.latitude == null || payload.longitude == null) return `/day/${date}`;
      const name = payload.locality ? `Stavba ${payload.locality}` : '';
      return `/settings/place-edit?lat=${payload.latitude}&lon=${payload.longitude}&name=${encodeURIComponent(name)}&rebuildFrom=${encodeURIComponent(`${date}T00:00:00.000Z`)}`;
    }
    case 'edit':
    case 'open':
      return payload.placeId ? `/day/${date}?stay=${payload.placeId}` : `/day/${date}`;
  }
  return null;
}

let pendingOpen: string | null = null;

// Vyzvedne odpovědi z nativní fronty, zpracuje je a přepočítá připomenutí.
export function processNotificationResponses(): Promise<void> {
  return runExclusive(async () => {
    let responses: NotificationResponse[] = [];
    try {
      responses = DochazkaNative.drainNotificationResponses();
    } catch {
      return;
    }
    for (const r of responses) {
      const href = await handleResponse(r);
      if (href) pendingOpen = href;
    }
    if (responses.length > 0) await evaluateReminders();
  }).then(() => {
    openPendingDay();
  });
}

// "Upravit v aplikaci" -> Detail dne s oknem Zapsat pobyt.
let navigationReady = false;

export function setNavigationReady(): void {
  navigationReady = true;
  openPendingDay();
}

function openPendingDay(): void {
  if (!navigationReady || !pendingOpen) return;
  const href = pendingOpen;
  pendingOpen = null;
  router.push(href as Href);
}

let listenerRegistered = false;

export function initReminders(): void {
  if (listenerRegistered) return;
  listenerRegistered = true;
  try {
    DochazkaNative.addListener('onNotificationResponse', () => {
      processNotificationResponses().catch(() => {});
    });
  } catch {
    // nativní modul chybí (Expo Go)
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const status = await DochazkaNative.getNotificationPermission();
    if (status === 'granted') return true;
    return await DochazkaNative.requestNotificationPermission();
  } catch {
    return false;
  }
}

export type { ReminderState };
