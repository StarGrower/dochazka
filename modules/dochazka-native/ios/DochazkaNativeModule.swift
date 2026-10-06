// Lokální nativní modul Docházky (etapa 4) - JS rozhraní k trezoru
// zálohy (BackupVault.swift), místním upozorněním (LocalNotifications.swift)
// a stavu zařízení. Typy a popis funkcí: src/DochazkaNative.ts.

import ExpoModulesCore
import UIKit
import MapKit
import UniformTypeIdentifiers

final class NativeError: GenericException<String> {
  override var reason: String { param }
}

private func wrap<T>(_ body: () throws -> T) throws -> T {
  do {
    return try body()
  } catch let error as Exception {
    throw error
  } catch {
    throw NativeError("\(error)")
  }
}

public final class DochazkaNativeModule: Module {
  private var pickerDelegate: PickerDelegate?
  private var responseObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("DochazkaNative")

    Events(NOTIFICATION_RESPONSE_EVENT)

    OnCreate {
      self.responseObserver = NotificationCenter.default.addObserver(
        forName: notificationResponseReceived, object: nil, queue: .main
      ) { [weak self] note in
        self?.sendEvent(NOTIFICATION_RESPONSE_EVENT, (note.userInfo as? [String: Any]) ?? [:])
      }
    }

    OnDestroy {
      if let observer = self.responseObserver {
        NotificationCenter.default.removeObserver(observer)
      }
    }

    // --- záloha: složka ---

    AsyncFunction("pickBackupFolder") { (promise: Promise) in
      self.presentPicker(types: [.folder], promise: promise) { url in
        try BackupVault.shared.saveFolder(url)
      }
    }.runOnQueue(.main)

    Function("getBackupFolder") { () -> [String: Any] in
      BackupVault.shared.folderInfo()
    }

    Function("clearBackupFolder") {
      BackupVault.shared.clearFolder()
    }

    AsyncFunction("listBackupFiles") { () -> [[String: Any]] in
      try wrap { try BackupVault.shared.listFiles() }
    }

    AsyncFunction("deleteBackupFile") { (name: String) in
      try wrap { try BackupVault.shared.deleteFile(name: name) }
    }

    AsyncFunction("writeEncryptedBackup") { (sourcePath: String, fileName: String) -> Int in
      try wrap { try BackupVault.shared.writeEncrypted(sourcePath: sourcePath, fileName: fileName) }
    }

    AsyncFunction("copyBackupFileToTemp") { (name: String) -> String in
      try wrap { try BackupVault.shared.copyFolderFileToTemp(name: name) }
    }

    AsyncFunction("pickBackupFileToTemp") { (promise: Promise) in
      self.presentPicker(types: [UTType.data], promise: promise) { url in
        try BackupVault.shared.copyPickedFileToTemp(url: url)
      }
    }.runOnQueue(.main)

    AsyncFunction("decryptBackup") { (sourcePath: String, destinationPath: String, keyBase64: String) in
      try wrap {
        try BackupVault.shared.decrypt(sourcePath: sourcePath, destinationPath: destinationPath, keyBase64: keyBase64)
      }
    }

    // --- místní soubory (snímek DB, obnova) ---

    Function("tempFilePath") { (name: String) -> String in
      FileManager.default.temporaryDirectory.appendingPathComponent(name).path
    }

    Function("deleteLocalFile") { (path: String) in
      try? FileManager.default.removeItem(atPath: path)
    }

    // Obnova: nahradí soubor databáze (+ smaže -wal/-shm). DB musí být zavřená.
    AsyncFunction("replaceDatabaseFile") { (sourcePath: String, databasePath: String) in
      try wrap {
        let fm = FileManager.default
        for suffix in ["", "-wal", "-shm"] where fm.fileExists(atPath: databasePath + suffix) {
          try fm.removeItem(atPath: databasePath + suffix)
        }
        try fm.copyItem(atPath: sourcePath, toPath: databasePath)
      }
    }

    // --- záloha: klíč ---

    Function("getKeyStatus") { () -> [String: Any] in
      BackupVault.shared.keyStatus()
    }

    Function("createKeyIfMissing") { () -> [String: Any] in
      try wrap { try BackupVault.shared.createKeyIfMissing() }
    }

    Function("exportKey") { () -> String in
      BackupVault.shared.exportKey()
    }

    Function("importKey") { (base64: String) in
      try wrap { try BackupVault.shared.importKey(base64: base64) }
    }

    // --- stav zařízení ---

    Function("provisioningExpiry") { () -> String in
      BackupVault.shared.provisioningExpiry()
    }

    // UIApplication jen z hlavního vlákna -> AsyncFunction na .main.
    AsyncFunction("backgroundRefreshStatus") { () -> String in
      switch UIApplication.shared.backgroundRefreshStatus {
      case .available: return "available"
      case .denied: return "denied"
      case .restricted: return "restricted"
      @unknown default: return "unknown"
      }
    }.runOnQueue(.main)

    // --- snímek mapy pro PDF výkaz ---

    AsyncFunction("mapSnapshot") { (routes: [[[Double]]], stops: [[Double]], labels: [String], width: Double, height: Double, promise: Promise) in
      MapSnapshot.render(routes: routes, stops: stops, labels: labels, size: CGSize(width: width, height: height)) { result in
        switch result {
        case .success(let base64): promise.resolve(base64)
        case .failure(let error): promise.reject(NativeError("\(error)"))
        }
      }
    }.runOnQueue(.main)

    // --- vzdálenost po silnici (dopočet přejezdů) ---

    AsyncFunction("roadDistance") { (fromLat: Double, fromLon: Double, toLat: Double, toLon: Double, promise: Promise) in
      RoadDistance.measure(
        from: CLLocationCoordinate2D(latitude: fromLat, longitude: fromLon),
        to: CLLocationCoordinate2D(latitude: toLat, longitude: toLon)
      ) { result in
        switch result {
        case .success(let meters): promise.resolve(meters)
        case .failure(let error): promise.reject(NativeError("\(error.localizedDescription)"))
        }
      }
    }.runOnQueue(.main)

    // --- etapy 6 a 7: OCR, čerpací stanice, Bluetooth auto ---

    AsyncFunction("recognizeText") { (base64: String, promise: Promise) in
      DeviceExtras.recognizeText(base64: base64) { result in
        switch result {
        case .success(let lines): promise.resolve(lines)
        case .failure(let error): promise.reject(NativeError("\(error.localizedDescription)"))
        }
      }
    }

    AsyncFunction("searchPlaces") { (query: String, nearLatitude: Double, nearLongitude: Double, promise: Promise) in
      DeviceExtras.searchPlaces(query: query, nearLatitude: nearLatitude, nearLongitude: nearLongitude) { result in
        switch result {
        case .success(let items): promise.resolve(items)
        case .failure(let error): promise.reject(NativeError("\(error.localizedDescription)"))
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("nearbyGasStation") { (latitude: Double, longitude: Double, radius: Double, promise: Promise) in
      DeviceExtras.nearbyGasStation(latitude: latitude, longitude: longitude, radius: radius) { result in
        switch result {
        case .success(let name): promise.resolve(name)
        case .failure(let error): promise.reject(NativeError("\(error.localizedDescription)"))
        }
      }
    }.runOnQueue(.main)

    Function("bluetoothAudioRoute") { () -> String in
      DeviceExtras.bluetoothAudioRoute()
    }

    // --- místní upozornění ---

    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      LocalNotifications.shared.requestPermission { granted in promise.resolve(granted) }
    }

    AsyncFunction("getNotificationPermission") { (promise: Promise) in
      LocalNotifications.shared.permissionStatus { status in promise.resolve(status) }
    }

    Function("scheduleNotification") { (id: String, title: String, body: String, fireAtMs: Double, actions: [[String: Any]], data: String) in
      LocalNotifications.shared.schedule(id: id, title: title, body: body, fireAtMs: fireAtMs, actions: actions, data: data)
    }

    Function("cancelNotification") { (id: String) in
      LocalNotifications.shared.cancel(id: id)
    }

    AsyncFunction("pendingNotificationIds") { (promise: Promise) in
      LocalNotifications.shared.pendingIds { ids in promise.resolve(ids) }
    }

    Function("drainNotificationResponses") { () -> [[String: Any]] in
      LocalNotifications.shared.drainResponses()
    }
  }

  // Systémový výběr v Souborech (složka nebo soubor).
  private func presentPicker(types: [UTType], promise: Promise, onPick: @escaping (URL) throws -> String) {
    guard let controller = appContext?.utilities?.currentViewController() else {
      promise.reject(NativeError("Nelze otevřít výběr v Souborech."))
      return
    }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
    picker.allowsMultipleSelection = false
    let delegate = PickerDelegate { [weak self] url in
      self?.pickerDelegate = nil
      guard let url = url else {
        promise.reject(NativeError("Výběr zrušen."))
        return
      }
      do {
        promise.resolve(try onPick(url))
      } catch {
        promise.reject(NativeError("\(error)"))
      }
    }
    pickerDelegate = delegate
    picker.delegate = delegate
    controller.present(picker, animated: true)
  }
}

private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
  private let completion: (URL?) -> Void

  init(completion: @escaping (URL?) -> Void) {
    self.completion = completion
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    completion(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    completion(nil)
  }
}
