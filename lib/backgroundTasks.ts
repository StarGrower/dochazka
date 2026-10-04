// Definice background tasků (expo-task-manager) - MUSÍ být v
// globálním scope modulu, jinak je iOS nenajde při probuzení appky na
// pozadí (viz komentář v expo-task-manager -> defineTask). Proto se
// tenhle soubor importuje JEN pro vedlejší efekt, co nejdřív v
// app/_layout.tsx - žádná komponenta, žádná funkce okolo.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { addDebugLogEntry } from './db';
import {
  CONTINUOUS_LOCATION_TASK_NAME,
  GEOFENCE_TASK_NAME,
  handleGeofenceEvent,
  processContinuousLocations,
} from './locationTracking';
import { processTripLocations, TRIP_TASK_NAME } from './tripTracking';

interface GeofenceTaskData {
  eventType: Location.LocationGeofencingEventType;
  region: Location.LocationRegion;
}

interface LocationUpdateTaskData {
  locations: Location.LocationObject[];
}

TaskManager.defineTask<GeofenceTaskData>(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    await addDebugLogEntry({
      timestamp: new Date().toISOString(),
      eventType: 'error',
      detail: `geofence task: ${error.message}`,
      batteryLevel: null,
      latitude: null,
      longitude: null,
    });
    return;
  }
  if (!data) return;
  await handleGeofenceEvent(data.eventType, data.region);
});

TaskManager.defineTask<LocationUpdateTaskData>(CONTINUOUS_LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    await addDebugLogEntry({
      timestamp: new Date().toISOString(),
      eventType: 'error',
      detail: `continuous location task: ${error.message}`,
      batteryLevel: null,
      latitude: null,
      longitude: null,
    });
    return;
  }
  if (!data?.locations?.length) return;
  await processContinuousLocations(data.locations);
});

// Etapa 3 - body GPS během přejezdu (viz lib/tripTracking.ts).
TaskManager.defineTask<LocationUpdateTaskData>(TRIP_TASK_NAME, async ({ data, error }) => {
  if (error) {
    await addDebugLogEntry({
      timestamp: new Date().toISOString(),
      eventType: 'error',
      detail: `trip location task: ${error.message}`,
      batteryLevel: null,
      latitude: null,
      longitude: null,
    });
    return;
  }
  if (!data?.locations?.length) return;
  await processTripLocations(data.locations);
});
