// Orchestrace záznamu polohy (etapa 2, ČÁST B; oprava 2) - spojuje
// nativní modul VisitMonitor (CLVisit + significant location changes,
// úsporný režim) a expo-location geofencing/continuous updates. Každá
// událost se jen ULOŽÍ (lib/db.ts -> location_events, bez duplicit) a
// pobyty se z událostí přepočítají (lib/visits.ts). Definice background
// tasků samotných (musí být v globálním scope) je v
// lib/backgroundTasks.ts - ten na tyhle funkce jen volá.

import * as Location from 'expo-location';
import { Linking } from 'react-native';

import { getBatteryLevelSafe } from './battery';
import {
  addDebugLogEntry,
  getInternalValue,
  getSettings,
  insertLocationEvents,
  insertLocationPoint,
  insertRoutePoint,
  listPlaces,
  normalizeIso,
  setInternalValue,
  type NewLocationEvent,
} from './db';
import { distanceMeters } from './geo';
import { evaluateTripSession, stopTripTrackingIfRunning } from './tripTracking';
import { rebuildVisits, runExclusive } from './visits';
import VisitMonitorModule from '../modules/visit-monitor/src/VisitMonitorModule';
import type {
  PendingEvent,
  SignificantLocationChangeEvent,
  VisitEvent,
} from '../modules/visit-monitor/src/VisitMonitor.types';
import type { AppSettings, DebugEventType } from './types';
import type { LocationEventKind } from './visitEngine';

export const GEOFENCE_TASK_NAME = 'dochazka-geofence-task';
export const CONTINUOUS_LOCATION_TASK_NAME = 'dochazka-continuous-location-task';

// iOS dovolí sledovat max 20 geofence oblastí najednou - rezerva pod
// limitem, ať i při zaokrouhlení/souběhu appka nikdy nenarazí na chybu.
const MAX_GEOFENCE_REGIONS = 18;

// --- oprávnění (zadání ČÁST B bod 1 - "nejdřív Při používání, pak Vždy") ---

export async function ensureLocationPermissions(): Promise<{
  foregroundGranted: boolean;
  backgroundGranted: boolean;
}> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    return { foregroundGranted: false, backgroundGranted: false };
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  return { foregroundGranted: true, backgroundGranted: background.status === 'granted' };
}

export async function getLocationPermissionStatus(): Promise<{
  foregroundGranted: boolean;
  backgroundGranted: boolean;
}> {
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  return {
    foregroundGranted: foreground.status === 'granted',
    backgroundGranted: background.status === 'granted',
  };
}

export function openIosSettings(): void {
  Linking.openSettings();
}

// --- časové okno záznamu ---
//
// NETRIVIÁLNÍ ROZHODNUTÍ (oprava 2) - okno se vyhodnocuje vždy podle
// ČASU UDÁLOSTI (ne zpracování) a už NEFILTRUJE pobyty: CLVisit/geofence
// dodá iOS tak jako tak (žádná baterie navíc) a zahozený odjezd mimo
// okno nechával pobyty neuzavřené (pátek 20:34 - sobota). Okno teď
// určuje (1) kdy průběžný režim sbírá body a (2) jaká část pobytů na
// pracovních místech se počítá do "NAVRHNOUT Z POBYTŮ".

export function isWithinTrackingWindow(settings: AppSettings, at: Date): boolean {
  if (!settings.trackingDays.includes(at.getDay())) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return minutes >= settings.trackingStartMinutes && minutes <= settings.trackingEndMinutes;
}

// --- geofencing (úsporný režim) ---
//
// NETRIVIÁLNÍ ROZHODNUTÍ (oprava 2, A1) - geofence se registrují JEN
// když se změní sada sledovaných míst (otisk v interních hodnotách).
// Každé `startGeofencingAsync` totiž iOS odpoví hlášením aktuálního
// stavu všech oblastí ("jsi venku"/"jsi uvnitř") - dřív se registrovalo
// při každém startu appky a každé významné změně polohy, a tahle
// úvodní hlášení se brala jako příjezdy/odjezdy (bouře 30 výstupů za
// 0,5 s v deníku). Hlášení do pár sekund po registraci se ignorují.

const KEY_GEOFENCE_SIGNATURE = 'geofence_signature';
const KEY_GEOFENCE_REGISTERED_AT = 'geofence_registered_at';
const GEOFENCE_SETTLE_MS = 15 * 1000;

export async function refreshGeofences(): Promise<void> {
  const places = await listPlaces();
  if (places.length === 0) {
    await stopGeofencing();
    return;
  }

  let candidates = places;
  if (places.length > MAX_GEOFENCE_REGIONS) {
    const last = await Location.getLastKnownPositionAsync({}).catch(() => null);
    if (last) {
      candidates = [...places]
        .sort(
          (a, b) =>
            distanceMeters(last.coords.latitude, last.coords.longitude, a.latitude, a.longitude) -
            distanceMeters(last.coords.latitude, last.coords.longitude, b.latitude, b.longitude)
        )
        .slice(0, MAX_GEOFENCE_REGIONS);
    } else {
      candidates = places.slice(0, MAX_GEOFENCE_REGIONS);
    }
  }

  const regions: Location.LocationRegion[] = candidates.map((place) => ({
    identifier: String(place.id),
    latitude: place.latitude,
    longitude: place.longitude,
    radius: place.radiusM,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
  const signature = regions
    .map((r) => `${r.identifier}:${r.latitude}:${r.longitude}:${r.radius}`)
    .sort()
    .join('|');

  const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => false);
  if (started && (await getInternalValue(KEY_GEOFENCE_SIGNATURE)) === signature) return;

  await setInternalValue(KEY_GEOFENCE_REGISTERED_AT, String(Date.now()));
  await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
  await setInternalValue(KEY_GEOFENCE_SIGNATURE, signature);
}

async function stopGeofencing(): Promise<void> {
  await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
  await setInternalValue(KEY_GEOFENCE_SIGNATURE, '');
}

// --- příjem událostí ---

// Událost doručená později než tohle = "doručeno později" - baterie v
// tu chvíli už neříká nic o čase události, zapíše se zvlášť.
const LATE_DELIVERY_MS = 2 * 60 * 1000;

// Co vyvolalo start/konec sledování jízdy (do deníku).
const TRIGGER_LABELS: Record<LocationEventKind, string> = {
  visit_arrival: 'CLVisit příjezd',
  visit_departure: 'CLVisit odjezd',
  geofence_enter: 'vstup do geofence',
  geofence_exit: 'výstup z geofence',
  significant: 'významná změna polohy',
  point: 'průběžný bod',
};

const DEBUG_EVENT_TYPES: Record<LocationEventKind, DebugEventType> = {
  visit_arrival: 'arrival',
  visit_departure: 'departure',
  geofence_enter: 'geofence_enter',
  geofence_exit: 'geofence_exit',
  significant: 'significant_change',
  point: 'point',
};

interface IncomingEvent {
  event: NewLocationEvent;
  detail: string;
  receiptBattery: number | null;
  // Souřadnice do ladicího deníku, když je událost sama nemá (geofence -> střed oblasti).
  logLatitude?: number;
  logLongitude?: number;
}

// Uloží nové události (duplicity zahodí), zapíše je do ladicího deníku
// a přepočítá pobyty od nejstarší nové události. Volat v runExclusive.
async function ingest(items: IncomingEvent[]): Promise<void> {
  if (items.length === 0) return;
  const inserted = await insertLocationEvents(items.map((i) => i.event));

  let earliestMs: number | null = null;
  let newest: { atMs: number; kind: LocationEventKind } | null = null;
  for (let i = 0; i < items.length; i++) {
    if (!inserted[i]) continue;
    const { event, detail, receiptBattery } = items[i];
    const atMs = Date.parse(event.eventAt);
    if (earliestMs === null || atMs < earliestMs) earliestMs = atMs;
    if (!newest || atMs >= newest.atMs) newest = { atMs, kind: event.kind };
    const late = Date.parse(event.receivedAt) - atMs > LATE_DELIVERY_MS;
    await addDebugLogEntry({
      timestamp: event.eventAt,
      eventType: DEBUG_EVENT_TYPES[event.kind],
      detail: late ? `${detail} · doručeno později` : detail,
      batteryLevel: late ? null : receiptBattery,
      latitude: event.latitude ?? items[i].logLatitude ?? null,
      longitude: event.longitude ?? items[i].logLongitude ?? null,
      deliveredAt: late ? event.receivedAt : null,
      deliveredBattery: late ? receiptBattery : null,
    });
  }

  if (earliestMs !== null) await rebuildVisits(earliestMs);
  // Etapa 3: odjezd/příjezd -> zapnout/vypnout GPS jízdy.
  if (newest) await evaluateTripSession(TRIGGER_LABELS[newest.kind]);
}

// --- CLVisit a significant location change (nativní modul) ---
//
// NETRIVIÁLNÍ ROZHODNUTÍ (oprava 2, A1) - JEDINÁ cesta zpracování: živá
// událost z nativního modulu jen spustí vyprázdnění fronty
// (drainPendingEvents) a zpracuje se to, co ve frontě je. Dřív se
// událost zpracovala živě A ZÁROVEŇ zůstala ve frontě, takže se při
// dalším startu appky zpracovala znovu (PŘÍJEZD 4× v deníku).

export function processNativeQueue(): Promise<void> {
  return runExclusive(async () => {
    let pending: PendingEvent[];
    try {
      pending = VisitMonitorModule.drainPendingEvents();
    } catch {
      return;
    }
    if (pending.length === 0) return;

    const battery = await getBatteryLevelSafe();
    const nowIso = new Date().toISOString();
    const items: IncomingEvent[] = [];
    let sawSignificantChange = false;

    for (const item of pending) {
      const receivedAt = item.body.receivedAt ? normalizeIso(item.body.receivedAt) : nowIso;
      if (item.name === 'onVisit') {
        const v = item.body as VisitEvent;
        const base = { latitude: v.latitude, longitude: v.longitude, accuracyM: v.horizontalAccuracy, placeId: null, receivedAt, origin: 'live' as const };
        if (v.arrivalDate) {
          items.push({ event: { ...base, kind: 'visit_arrival', eventAt: normalizeIso(v.arrivalDate) }, detail: 'CLVisit', receiptBattery: battery });
        }
        if (v.departureDate) {
          items.push({ event: { ...base, kind: 'visit_departure', eventAt: normalizeIso(v.departureDate) }, detail: 'CLVisit', receiptBattery: battery });
        }
      } else {
        const c = item.body as SignificantLocationChangeEvent;
        sawSignificantChange = true;
        items.push({
          event: { kind: 'significant', eventAt: normalizeIso(c.timestamp), latitude: c.latitude, longitude: c.longitude, accuracyM: null, placeId: null, receivedAt, origin: 'live' },
          detail: 'significant location change',
          receiptBattery: battery,
        });
      }
    }

    await ingest(items);

    // Zadání ČÁST B: "obnovuj výběr nejbližších míst při významné změně
    // polohy" - re-registrace jen když se výběr opravdu změní (viz výš).
    if (sawSignificantChange) {
      const settings = await getSettings();
      if (settings.locationTrackingEnabled && settings.locationMode === 'economical') {
        await refreshGeofences();
      }
    }
  });
}

// Volá se z lib/backgroundTasks.ts (geofencing task).
export function handleGeofenceEvent(
  eventType: Location.LocationGeofencingEventType,
  region: Location.LocationRegion
): Promise<void> {
  return runExclusive(async () => {
    const placeId = Number(region.identifier);
    const enter = eventType === Location.LocationGeofencingEventType.Enter;
    const nowIso = new Date().toISOString();
    const battery = await getBatteryLevelSafe();

    const registeredAt = Number((await getInternalValue(KEY_GEOFENCE_REGISTERED_AT)) ?? 0);
    if (Date.now() - registeredAt < GEOFENCE_SETTLE_MS) {
      await addDebugLogEntry({
        timestamp: nowIso,
        eventType: enter ? 'geofence_enter' : 'geofence_exit',
        detail: `místo #${placeId} · úvodní stav po registraci, ignorováno`,
        batteryLevel: battery,
        latitude: region.latitude,
        longitude: region.longitude,
      });
      return;
    }

    await ingest([
      {
        event: {
          kind: enter ? 'geofence_enter' : 'geofence_exit',
          eventAt: nowIso,
          latitude: null,
          longitude: null,
          accuracyM: null,
          placeId,
          receivedAt: nowIso,
          origin: 'live',
        },
        detail: `místo #${placeId}`,
        receiptBattery: battery,
        logLatitude: region.latitude,
        logLongitude: region.longitude,
      },
    ]);
  });
}

// --- průběžný režim (zadání ČÁST B bod 3) ---

// Volá se z lib/backgroundTasks.ts. Body jen v průběžném režimu a jen v
// časovém okně (podle času bodu) - jinak se nic nezapisuje (oprava 2, A1).
export function processContinuousLocations(locations: Location.LocationObject[]): Promise<void> {
  return runExclusive(async () => {
    const settings = await getSettings();
    if (!settings.locationTrackingEnabled || settings.locationMode !== 'continuous') {
      // Zbloudilé sledování (např. po přepnutí režimu) - vypnout.
      await Location.stopLocationUpdatesAsync(CONTINUOUS_LOCATION_TASK_NAME).catch(() => {});
      return;
    }
    const battery = await getBatteryLevelSafe();
    const receivedAt = new Date().toISOString();
    const items: IncomingEvent[] = [];
    for (const location of locations) {
      const at = new Date(location.timestamp);
      if (!isWithinTrackingWindow(settings, at)) continue;
      const eventAt = at.toISOString();
      await insertLocationPoint(eventAt, location.coords.latitude, location.coords.longitude);
      // Etapa 3: v průběžném režimu jsou tyhle body zároveň body trasy.
      await insertRoutePoint({
        timestamp: eventAt,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyM: location.coords.accuracy ?? null,
        speedMps: location.coords.speed !== null && location.coords.speed >= 0 ? location.coords.speed : null,
      });
      items.push({
        event: { kind: 'point', eventAt, latitude: location.coords.latitude, longitude: location.coords.longitude, accuracyM: location.coords.accuracy ?? null, placeId: null, receivedAt, origin: 'live' },
        detail: 'průběžný bod',
        receiptBattery: battery,
      });
    }
    await ingest(items);
  });
}

// --- zapnutí/vypnutí sledování podle aktuálního nastavení ---

export async function applyLocationTrackingState(settings: AppSettings): Promise<void> {
  // GPS jízdy jen v úsporném režimu se zapnutým záznamem tras.
  if (!settings.locationTrackingEnabled || !settings.routeTrackingEnabled || settings.locationMode !== 'economical') {
    await stopTripTrackingIfRunning('záznam tras vypnut nebo jiný režim');
  }
  if (!settings.locationTrackingEnabled) {
    VisitMonitorModule.stopVisitMonitoring();
    VisitMonitorModule.stopSignificantLocationMonitoring();
    await stopGeofencing();
    await Location.stopLocationUpdatesAsync(CONTINUOUS_LOCATION_TASK_NAME).catch(() => {});
    return;
  }

  if (settings.locationMode === 'economical') {
    await Location.stopLocationUpdatesAsync(CONTINUOUS_LOCATION_TASK_NAME).catch(() => {});
    VisitMonitorModule.startVisitMonitoring();
    VisitMonitorModule.startSignificantLocationMonitoring();
    await refreshGeofences();
  } else {
    VisitMonitorModule.stopVisitMonitoring();
    VisitMonitorModule.stopSignificantLocationMonitoring();
    await stopGeofencing();
    await Location.startLocationUpdatesAsync(CONTINUOUS_LOCATION_TASK_NAME, {
      accuracy: Location.LocationAccuracy.Low,
      timeInterval: settings.continuousIntervalMinutes * 60 * 1000,
      distanceInterval: 0,
      showsBackgroundLocationIndicator: false,
    });
  }
}

// --- start appky (app/_layout.tsx) ---

let listenersRegistered = false;

export async function initLocationTracking(): Promise<void> {
  if (!listenersRegistered) {
    listenersRegistered = true;
    // Obsah živé události se nečte - je i ve frontě, zpracuje se odtamtud.
    VisitMonitorModule.addListener('onVisit', () => {
      processNativeQueue().catch(() => {});
    });
    VisitMonitorModule.addListener('onSignificantLocationChange', () => {
      processNativeQueue().catch(() => {});
    });
  }

  await addDebugLogEntry({
    timestamp: new Date().toISOString(),
    eventType: 'app_wake',
    detail: 'start appky',
    batteryLevel: await getBatteryLevelSafe(),
    latitude: null,
    longitude: null,
  });

  await processNativeQueue();

  const settings = await getSettings();
  await applyLocationTrackingState(settings);
  // Dojela appka na pozadí jízdu, nebo se mezitím přijelo? (pojistky)
  await runExclusive(() => evaluateTripSession('start appky'));
}
