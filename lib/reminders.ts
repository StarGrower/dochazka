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
// (day_work_records.place_id). Nikdy pro soukromá a neznámá místa.

import { router } from 'expo-router';

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
import { formatNumberCs, formatQuantity, todayIso } from './format';
import { isWorkday } from './holidays';
import { formatDurationHM, proposeStayRecord, type StayProposal } from './stayProposal';
import type { AppSettings, VisitWithPlace, WorkCategory } from './types';
import { runExclusive } from './visits';
import { priceForRecord } from './workCalc';

// Pobyt na pracovním místě za den (víc pobytů na místě sečtených).
export interface WorkStay {
  date: string;
  placeId: number;
  placeName: string;
  firstStartMs: number;
  lastEndMs: number | null; // null = pořád na místě
  durationMs: number;
}

interface StayPayload {
  kind: 'stay' | 'day';
  date: string;
  placeId?: number;
  categoryId?: number;
  unit?: string;
  quantity?: number;
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export async function workStaysForDate(date: string, nowMs = Date.now()): Promise<WorkStay[]> {
  const visits = await getVisitsForDay(date);
  const stays = buildDayTimeline(visits, date, nowMs).filter(
    (i): i is TimelineStay<VisitWithPlace> =>
      i.kind === 'stay' && i.visit.placeId !== null && !i.visit.placeIsPrivate && !i.visit.startUncertain
  );
  const byPlace = new Map<number, WorkStay>();
  for (const s of stays) {
    const placeId = s.visit.placeId as number;
    const existing = byPlace.get(placeId);
    const endMs = s.ongoing ? null : s.segEndMs;
    if (!existing) {
      byPlace.set(placeId, {
        date,
        placeId,
        placeName: s.visit.placeName ?? 'Místo',
        firstStartMs: s.segStartMs,
        lastEndMs: endMs,
        durationMs: s.segEndMs - s.segStartMs,
      });
    } else {
      existing.durationMs += s.segEndMs - s.segStartMs;
      existing.lastEndMs = endMs;
    }
  }
  return [...byPlace.values()].sort((a, b) => a.firstStartMs - b.firstStartMs);
}

export async function proposalForStay(stay: WorkStay, settings: AppSettings, categories: WorkCategory[]): Promise<StayProposal | null> {
  return proposeStayRecord(stay.durationMs, await getPlaceSuggestion(stay.placeId), settings, categories);
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
    const stays = (await workStaysForDate(date, now)).filter(
      (s) => !recorded.has(s.placeId) && s.firstStartMs < win.end && (s.lastEndMs ?? now) > win.start
    );
    const proposals = new Map<number, StayProposal | null>();
    for (const s of stays) proposals.set(s.placeId, await proposalForStay(s, settings, categories));

    // Po odjezdu z pracovního místa.
    if (settings.reminderOnDeparture) {
      for (const s of stays) {
        if (s.lastEndMs === null || s.durationMs < settings.reminderMinStayMinutes * 60000) continue;
        const key = `dep|${date}|${s.placeId}`;
        const state = states.get(key);
        if (state && state.state !== 'scheduled') continue; // už odesláno / večer
        const p = proposals.get(s.placeId);
        const actions: NotificationAction[] = [
          ...(p ? [{ id: 'write', title: `Zapsat: ${proposalText(p)}` }] : []),
          { id: 'edit', title: 'Upravit v aplikaci', foreground: true },
          { id: 'evening', title: 'Připomenout večer' },
          { id: 'skip', title: 'Dnes nezapisovat', destructive: true },
        ];
        desired.set(key, {
          title: departureTitle(s.placeName),
          body:
            `${hhmm(s.firstStartMs)}–${hhmm(s.lastEndMs)} · ${formatDurationHM(s.durationMs)} na místě` +
            (p ? `\nNávrh: ${proposalText(p)}${settings.autoSubtractBreak ? ` (−${settings.breakMinutes} min přestávka)` : ''}. Podrž pro rychlý zápis.` : ''),
          fireAt: s.lastEndMs + settings.reminderDelayMinutes * 60000,
          actions,
          payload: { kind: 'stay', date, placeId: s.placeId, categoryId: p?.category.id, unit: p?.unit, quantity: p?.quantity },
        });
      }
    }

    const finished = stays.filter((s) => s.lastEndMs !== null);
    const summary = (list: WorkStay[]) =>
      list.map((s) => `${s.placeName} ${hhmm(s.firstStartMs)}–${hhmm(s.lastEndMs ?? now)}` + (proposals.get(s.placeId) ? ` · ${proposalText(proposals.get(s.placeId) as StayProposal)}` : '')).join('\n');
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
    const snoozed = finished.filter((s) => states.get(`dep|${date}|${s.placeId}`)?.state === 'evening');
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

async function handleResponse(r: NotificationResponse): Promise<{ openDay: string | null; placeId: number | null }> {
  let payload: StayPayload | null = null;
  try {
    payload = JSON.parse(r.data) as StayPayload;
  } catch {
    payload = null;
  }
  if (!payload) return { openDay: null, placeId: null };
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
      if (payload.kind !== 'stay' || !payload.placeId || !payload.categoryId || payload.quantity === undefined) break;
      // Mezitím zapsané (třeba v appce) - nezapisovat dvakrát.
      if ((await recordedPlacesForDate(date)).has(payload.placeId)) break;
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
        placeId: payload.placeId,
      });
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
    case 'edit':
    case 'open':
      return { openDay: date, placeId: payload.placeId ?? null };
  }
  return { openDay: null, placeId: null };
}

let pendingOpen: { date: string; placeId: number | null } | null = null;

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
      const result = await handleResponse(r);
      if (result.openDay) pendingOpen = { date: result.openDay, placeId: result.placeId };
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
  const { date, placeId } = pendingOpen;
  pendingOpen = null;
  router.push(placeId ? `/day/${date}?stay=${placeId}` : `/day/${date}`);
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
