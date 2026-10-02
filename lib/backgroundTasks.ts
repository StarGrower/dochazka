// Definice background tasků (expo-task-manager) - MUSÍ být v
// globálním scope modulu, jinak je iOS nenajde při probuzení appky na
// pozadí (viz komentář v expo-task-manager -> defineTask). Proto se
// tenhle soubor importuje JEN pro vedlejší efekt, co nejdřív v
// app/_layout.tsx - žádná komponenta, žádná funkce okolo.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { addDebugLogEntry, insertLocationPoint } from './db';
import { GEOFENCE_TASK_NAME, CONTINUOUS_LOCATION_TASK_NAME, handleGeofenceEvent, processContinuousLocationPoint } from './locationTracking';

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
  for (const location of data.locations) {
    const timestamp = new Date(location.timestamp).toISOString();
    await insertLocationPoint(timestamp, location.coords.latitude, location.coords.longitude);
    await processContinuousLocationPoint(timestamp, location.coords.latitude, location.coords.longitude);
  }
});
