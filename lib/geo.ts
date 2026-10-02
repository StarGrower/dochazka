// Haversine vzdálenost dvou bodů v metrech - používá se pro "najdi
// nejbližší uložené místo" (viz lib/locationTracking.ts) a pro
// geofence refresh (nejbližších ~18 míst, limit iOS).

const EARTH_RADIUS_M = 6371000;

export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}
