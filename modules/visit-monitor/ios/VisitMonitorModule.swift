// Malý lokální nativní modul (Expo Modules API) - CLVisit monitoring a
// significant location changes. expo-location tohle nemá (jen
// "watchPositionAsync"/"startLocationUpdatesAsync" s intervalem), ale
// CLVisit je přesně ten úsporný, OS-řízený mechanismus, co umí vzbudit
// appku na pozadí I PO JEJÍM ZAVŘENÍ (swipe v app switcheru) - na
// rozdíl od běžných background tasků, který se po zavření appky
// nespustí. Proto zadání (ČÁST B bod 2) chce konkrétně tohle.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - "store-and-forward" fronta přes UserDefaults:
// Když iOS vzbudí appku na pozadí kvůli CLVisit, běží JS bridge chvilku
// po startu procesu, než se stihnou zaregistrovat JS listenery (viz
// app/_layout.tsx). Aby se v tom úzkém okně žádná událost neztratila,
// KAŽDÁ událost se nejdřív uloží do UserDefaults fronty (`emit`) a
// TEPRVE POTOM se zkusí poslat živě přes sendEvent. JS si při startu
// zavolá `drainPendingEvents()`, vyzvedne si, co mezitím přišlo (i když
// to sendEvent nestihl nikam doručit), a frontu vyprázdní.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - žádné `nil`/`Any?` v datech pro UserDefaults:
// UserDefaults je nad plist serializací, která Swift `nil` neumí (crash
// při ukládání slovníku s nil hodnotou). CLVisit reportuje
// Date.distantPast/distantFuture pro "neznámé/neukončené" - převádí se
// na prázdný string "", ne na nil (viz VisitMonitor.types.ts).
//
// NETRIVIÁLNÍ ROZHODNUTÍ - `OnCreate` znovu spouští monitoring podle
// uložené vlajky: iOS si pamatuje "tahle appka sleduje visits" i mezi
// restarty procesu, ale `CLLocationManager.delegate` je jen v paměti -
// po každém startu (i tom na pozadí, po probuzení systémem) je potřeba
// delegate znovu nastavit, jinak by se doručené události ztratily.
// Proto `OnCreate` (spustí se při KAŽDÉM startu JS runtime) zkontroluje
// uloženou vlajku v UserDefaults a `startMonitoringVisits()`/
// `startMonitoringSignificantLocationChanges()` zavolá znovu - je to
// idempotentní (iOS nevadí, že se to zavolá, i když už sleduje).
//
// OPRAVA 2 - fronta je JEDINÁ cesta do JS: `sendEvent` jen upozorní JS,
// že má frontu vyprázdnit (drainPendingEvents), obsah živé události se
// v JS nečte. Dřív JS zpracoval živou událost a ta ve frontě zůstala, takže
// se při dalším startu zpracovala znovu (duplicitní příjezdy). Zápis do
// fronty (delegate, hlavní vlákno) a vyprázdnění (volání z JS, jiné
// vlákno) hlídá zámek. K události se přidává `receivedAt` - kdy ji
// modul dostal (JS z toho pozná "doručeno později").

import CoreLocation
import ExpoModulesCore

private let EVENT_VISIT = "onVisit"
private let EVENT_SIGNIFICANT_CHANGE = "onSignificantLocationChange"

private let DEFAULTS_KEY_MONITORING_VISITS = "VisitMonitor.monitoringVisits"
private let DEFAULTS_KEY_MONITORING_SIGNIFICANT = "VisitMonitor.monitoringSignificantChanges"
private let DEFAULTS_KEY_PENDING_EVENTS = "VisitMonitor.pendingEvents"

public final class VisitMonitorModule: Module {
  private let pendingEventsLock = NSLock()
  private lazy var delegate = LocationManagerDelegate(module: self)
  private lazy var locationManager: CLLocationManager = {
    let manager = CLLocationManager()
    manager.delegate = self.delegate
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    return manager
  }()

  public func definition() -> ModuleDefinition {
    Name("VisitMonitor")

    Events(EVENT_VISIT, EVENT_SIGNIFICANT_CHANGE)

    OnCreate {
      let defaults = UserDefaults.standard
      if defaults.bool(forKey: DEFAULTS_KEY_MONITORING_VISITS) {
        self.locationManager.startMonitoringVisits()
      }
      if defaults.bool(forKey: DEFAULTS_KEY_MONITORING_SIGNIFICANT) {
        self.locationManager.startMonitoringSignificantLocationChanges()
      }
    }

    Function("startVisitMonitoring") {
      UserDefaults.standard.set(true, forKey: DEFAULTS_KEY_MONITORING_VISITS)
      self.locationManager.startMonitoringVisits()
    }

    Function("stopVisitMonitoring") {
      UserDefaults.standard.set(false, forKey: DEFAULTS_KEY_MONITORING_VISITS)
      self.locationManager.stopMonitoringVisits()
    }

    Function("startSignificantLocationMonitoring") {
      UserDefaults.standard.set(true, forKey: DEFAULTS_KEY_MONITORING_SIGNIFICANT)
      self.locationManager.startMonitoringSignificantLocationChanges()
    }

    Function("stopSignificantLocationMonitoring") {
      UserDefaults.standard.set(false, forKey: DEFAULTS_KEY_MONITORING_SIGNIFICANT)
      self.locationManager.stopMonitoringSignificantLocationChanges()
    }

    Function("isSignificantLocationChangeMonitoringAvailable") { () -> Bool in
      CLLocationManager.significantLocationChangeMonitoringAvailable()
    }

    Function("drainPendingEvents") { () -> [[String: Any]] in
      self.pendingEventsLock.lock()
      defer { self.pendingEventsLock.unlock() }
      let defaults = UserDefaults.standard
      let pending = defaults.array(forKey: DEFAULTS_KEY_PENDING_EVENTS) as? [[String: Any]] ?? []
      defaults.removeObject(forKey: DEFAULTS_KEY_PENDING_EVENTS)
      return pending
    }
  }

  fileprivate func emit(_ name: String, _ body: [String: Any]) {
    var payload = body
    payload["receivedAt"] = ISO8601DateFormatter().string(from: Date())

    pendingEventsLock.lock()
    let defaults = UserDefaults.standard
    var pending = defaults.array(forKey: DEFAULTS_KEY_PENDING_EVENTS) as? [[String: Any]] ?? []
    pending.append(["name": name, "body": payload])
    defaults.set(pending, forKey: DEFAULTS_KEY_PENDING_EVENTS)
    pendingEventsLock.unlock()

    self.sendEvent(name, payload)
  }
}

private final class LocationManagerDelegate: NSObject, CLLocationManagerDelegate {
  private weak var module: VisitMonitorModule?
  private let dateFormatter = ISO8601DateFormatter()

  init(module: VisitMonitorModule) {
    self.module = module
  }

  func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    let isArrivalKnown = visit.arrivalDate != Date.distantPast
    let isDepartureKnown = visit.departureDate != Date.distantFuture
    module?.emit(EVENT_VISIT, [
      "latitude": visit.coordinate.latitude,
      "longitude": visit.coordinate.longitude,
      "horizontalAccuracy": visit.horizontalAccuracy,
      "arrivalDate": isArrivalKnown ? dateFormatter.string(from: visit.arrivalDate) : "",
      "departureDate": isDepartureKnown ? dateFormatter.string(from: visit.departureDate) : "",
    ])
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    module?.emit(EVENT_SIGNIFICANT_CHANGE, [
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "timestamp": dateFormatter.string(from: location.timestamp),
    ])
  }
}
