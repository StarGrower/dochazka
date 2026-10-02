// Datové typy nativního modulu VisitMonitor (viz ios/VisitMonitorModule.swift).
// Prázdný string u data = "neznámé/neukončené" - CLVisit reportuje
// Date.distantPast/distantFuture pro tenhle případ, a to se NEDÁ
// bezpečně uložit do UserDefaults (store-and-forward fronta, viz
// NETRIVIÁLNÍ ROZHODNUTÍ v .swift) jako Swift `nil` (plist serializace
// nil nepodporuje) - proto jednotná konvence "" napříč JS i Swift.

export interface VisitEvent {
  latitude: number;
  longitude: number;
  horizontalAccuracy: number;
  arrivalDate: string; // ISO 8601, nebo "" = neznámé
  departureDate: string; // ISO 8601, nebo "" = pobyt ještě neskončil
}

export interface SignificantLocationChangeEvent {
  latitude: number;
  longitude: number;
  timestamp: string; // ISO 8601
}

export interface PendingEvent {
  name: 'onVisit' | 'onSignificantLocationChange';
  body: VisitEvent | SignificantLocationChangeEvent;
}

export type VisitMonitorEvents = {
  onVisit: (event: VisitEvent) => void;
  onSignificantLocationChange: (event: SignificantLocationChangeEvent) => void;
};
