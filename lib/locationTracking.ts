// Orchestrace záznamu polohy (etapa 2, ČÁST B) - spojuje nativní modul
// VisitMonitor (CLVisit + significant location changes, úsporný režim),
// expo-location geofencing/continuous updates a odvozování "pobytů"
// (visits) z obojího. Definice background tasků samotných (musí být v
// globálním scope) je v lib/backgroundTasks.ts - ten na tyhle funkce
// jen volá.

import * as Location from 'expo-location';
import { Linking } from 'react-native';

import { getBatteryLevelSafe } from './battery';
import {
  addDebugLogEntry,
  closeVisit,
  createVisit,
  deleteVisit,
  findOpenVisit,
  getSettings,
  listPlaces,
} from './db';
import { distanceMeters } from './geo';
import VisitMonitorModule from '../modules/visit-monitor/src/VisitMonitorModule';
import type {
  PendingEvent,
  SignificantLocationChangeEvent,
  VisitEvent,
} from '../modules/visit-monitor/src/VisitMonitor.types';
import type { AppSettings } from './types';

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

// --- časové okno záznamu (zadání ČÁST B bod 8 - "mimo okno se nic nezaznamenává") ---

export function isWithinTrackingWindow(settings: AppSettings, at: Date = new Date()): boolean {
  if (!settings.trackingDays.includes(at.getDay())) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return minutes >= settings.trackingStartMinutes && minutes <= settings.trackingEndMinutes;
}

// --- hledání nejbližšího uloženého místa ---

async function findNearestPlace(lat: number, lon: number): Promise<{ id: number; dist: number } | null> {
  const places = await listPlaces();
  let nearest: { id: number; dist: number } | null = null;
  for (const place of places) {
    const dist = distanceMeters(lat, lon, place.latitude, place.longitude);
    if (dist <= place.radiusM && (!nearest || dist < nearest.dist)) {
      nearest = { id: place.id, dist };
    }
  }
  return nearest;
}

// Zavře pobyt a hned ho zahodí, pokud vyšel kratší než nastavená
// hranice (zadání ČÁST B bod 4 - "krátké pobyty ignoruj, výchozí
// 10 min" - semafor, tankování).
async function closeVisitAndMaybeDiscard(visitId: number, startAt: string, endAt: string): Promise<void> {
  await closeVisit(visitId, endAt);
  const settings = await getSettings();
  const durationMinutes = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000;
  if (durationMinutes < settings.minStayMinutes) {
    await deleteVisit(visitId);
  }
}

// --- geofencing (úsporný režim) ---

export async function refreshGeofences(): Promise<void> {
  const places = await listPlaces();
  if (places.length === 0) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
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

  await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, regions);
}

// Volá se z lib/backgroundTasks.ts (geofencing task).
export async function handleGeofenceEvent(
  eventType: Location.LocationGeofencingEventType,
  region: Location.LocationRegion
): Promise<void> {
  const placeId = Number(region.identifier);
  const now = new Date().toISOString();
  const battery = await getBatteryLevelSafe();

  if (eventType === Location.LocationGeofencingEventType.Enter) {
    await addDebugLogEntry({
      timestamp: now,
      eventType: 'geofence_enter',
      detail: `místo #${placeId}`,
      batteryLevel: battery,
      latitude: region.latitude,
      longitude: region.longitude,
    });
    const settings = await getSettings();
    if (!isWithinTrackingWindow(settings)) return;
    const open = await findOpenVisit();
    if (!open) {
      await createVisit({
        placeId,
        unknownLatitude: null,
        unknownLongitude: null,
        startAt: now,
        endAt: null,
        source: 'geofence',
      });
    }
  } else {
    await addDebugLogEntry({
      timestamp: now,
      eventType: 'geofence_exit',
      detail: `místo #${placeId}`,
      batteryLevel: battery,
      latitude: region.latitude,
      longitude: region.longitude,
    });
    const open = await findOpenVisit();
    if (open && open.placeId === placeId) {
      await closeVisitAndMaybeDiscard(open.id, open.startAt, now);
    }
  }
}

// --- CLVisit a significant location change (nativní modul) ---

async function handleVisitEvent(event: VisitEvent): Promise<void> {
  const settings = await getSettings();
  const battery = await getBatteryLevelSafe();
  const withinWindow = isWithinTrackingWindow(settings);

  if (event.arrivalDate) {
    await addDebugLogEntry({
      timestamp: event.arrivalDate,
      eventType: 'arrival',
      detail: withinWindow ? 'CLVisit' : 'CLVisit (mimo časové okno, ignorováno)',
      batteryLevel: battery,
      latitude: event.latitude,
      longitude: event.longitude,
    });
  }
  if (event.departureDate) {
    await addDebugLogEntry({
      timestamp: event.departureDate,
      eventType: 'departure',
      detail: withinWindow ? 'CLVisit' : 'CLVisit (mimo časové okno, ignorováno)',
      batteryLevel: battery,
      latitude: event.latitude,
      longitude: event.longitude,
    });
  }

  if (!withinWindow) return;

  const match = await findNearestPlace(event.latitude, event.longitude);

  if (event.arrivalDate && !event.departureDate) {
    const open = await findOpenVisit();
    if (!open) {
      await createVisit({
        placeId: match ? match.id : null,
        unknownLatitude: match ? null : event.latitude,
        unknownLongitude: match ? null : event.longitude,
        startAt: event.arrivalDate,
        endAt: null,
        source: 'clvisit',
      });
    }
    return;
  }

  if (event.departureDate) {
    const open = await findOpenVisit();
    if (open) {
      await closeVisitAndMaybeDiscard(open.id, open.startAt, event.departureDate);
    } else if (event.arrivalDate) {
      // CLVisit přišlo rovnou s kompletním příchodem i odchodem -
      // vytvořit a hned zavřít.
      const id = await createVisit({
        placeId: match ? match.id : null,
        unknownLatitude: match ? null : event.latitude,
        unknownLongitude: match ? null : event.longitude,
        startAt: event.arrivalDate,
        endAt: event.departureDate,
        source: 'clvisit',
      });
      await closeVisitAndMaybeDiscard(id, event.arrivalDate, event.departureDate);
    }
  }
}

async function handleSignificantLocationChangeEvent(event: SignificantLocationChangeEvent): Promise<void> {
  const battery = await getBatteryLevelSafe();
  await addDebugLogEntry({
    timestamp: event.timestamp,
    eventType: 'significant_change',
    detail: 'significant location change',
    batteryLevel: battery,
    latitude: event.latitude,
    longitude: event.longitude,
  });

  const settings = await getSettings();
  if (settings.locationTrackingEnabled && settings.locationMode === 'economical') {
    await refreshGeofences();
  }
}

// --- průběžný režim (zadání ČÁST B bod 3) ---

// Volá se z lib/backgroundTasks.ts pro KAŽDÝ nový bod v průběžném
// režimu - odvodí pobyty přímo z toho, "jsem/nejsem v okruhu nějakého
// uloženého místa", bez čekání na CLVisit (ten se v průběžném režimu
// nepoužívá).
export async function processContinuousLocationPoint(
  timestamp: string,
  latitude: number,
  longitude: number
): Promise<void> {
  const settings = await getSettings();
  const battery = await getBatteryLevelSafe();
  const withinWindow = isWithinTrackingWindow(settings, new Date(timestamp));

  await addDebugLogEntry({
    timestamp,
    eventType: 'point',
    detail: withinWindow ? 'průběžný bod' : 'průběžný bod (mimo časové okno)',
    batteryLevel: battery,
    latitude,
    longitude,
  });

  if (!withinWindow) return;

  const match = await findNearestPlace(latitude, longitude);
  const open = await findOpenVisit();

  if (match) {
    if (!open) {
      await createVisit({
        placeId: match.id,
        unknownLatitude: null,
        unknownLongitude: null,
        startAt: timestamp,
        endAt: null,
        source: 'continuous',
      });
    } else if (open.placeId !== match.id) {
      await closeVisitAndMaybeDiscard(open.id, open.startAt, timestamp);
      await createVisit({
        placeId: match.id,
        unknownLatitude: null,
        unknownLongitude: null,
        startAt: timestamp,
        endAt: null,
        source: 'continuous',
      });
    }
    // jinak: stejné místo jako předtím - pobyt pokračuje, nic se nemění
  } else if (open) {
    await closeVisitAndMaybeDiscard(open.id, open.startAt, timestamp);
  }
}

// --- zapnutí/vypnutí sledování podle aktuálního nastavení ---

export async function applyLocationTrackingState(settings: AppSettings): Promise<void> {
  if (!settings.locationTrackingEnabled) {
    VisitMonitorModule.stopVisitMonitoring();
    VisitMonitorModule.stopSignificantLocationMonitoring();
    await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
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
    await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {});
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

// NETRIVIÁLNÍ ROZHODNUTÍ - `drainPendingEvents()` se volá PO
// zaregistrování listenerů, ne před: `startVisitMonitoring()` (v
// `applyLocationTrackingState` níž) nic nezmešká - frontu z nativní
// strany (viz ios/VisitMonitorModule.swift) čteme navíc, pro to úzké
// okno hned po probuzení appky na pozadí, kdy JS teprve startuje.
export async function initLocationTracking(): Promise<void> {
  if (!listenersRegistered) {
    listenersRegistered = true;
    VisitMonitorModule.addListener('onVisit', (event) => {
      handleVisitEvent(event).catch(() => {});
    });
    VisitMonitorModule.addListener('onSignificantLocationChange', (event) => {
      handleSignificantLocationChangeEvent(event).catch(() => {});
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

  const pending: PendingEvent[] = VisitMonitorModule.drainPendingEvents();
  for (const item of pending) {
    if (item.name === 'onVisit') {
      await handleVisitEvent(item.body as VisitEvent);
    } else {
      await handleSignificantLocationChangeEvent(item.body as SignificantLocationChangeEvent);
    }
  }

  const settings = await getSettings();
  await applyLocationTrackingState(settings);
}
