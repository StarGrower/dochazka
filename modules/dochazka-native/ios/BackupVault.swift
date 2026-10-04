// Trezor zálohy (etapa 4.1): složka v aplikaci Soubory (security-scoped
// bookmark), šifrování AES-256-GCM (CryptoKit), klíč v Klíčence.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - klíč je v Klíčence s kSecAttrAccessibleAfterFirstUnlock
// (záloha běží i na pozadí při zamčeném telefonu po prvním odemčení) a
// kSecAttrSynchronizable (iCloud Klíčenka - na novém telefonu se stejným
// Apple ID by měl být k dispozici sám). Skutečnou synchronizaci nejde
// ověřit bez druhého zařízení, proto obnovovací klíč (exportKey) jako
// pojistka.
//
// Formát souboru: 8 bajtů "DOCHZK01" + AES.GCM.SealedBox.combined
// (nonce 12 B + šifrový text + tag 16 B).

import CryptoKit
import Foundation
import Security
import UIKit

enum VaultError: Error, CustomStringConvertible {
  case noFolder
  case folderUnavailable(String)
  case noKey
  case badFile
  case keychain(OSStatus)

  var description: String {
    switch self {
    case .noFolder: return "Složka pro zálohy není nastavená."
    case .folderUnavailable(let why): return "Složka pro zálohy není dostupná: \(why)"
    case .noKey: return "Šifrovací klíč chybí (zadej obnovovací klíč)."
    case .badFile: return "Soubor není záloha Docházky nebo je poškozený."
    case .keychain(let status): return "Klíčenka vrátila chybu \(status)."
    }
  }
}

final class BackupVault {
  static let shared = BackupVault()

  private let bookmarkKey = "DochazkaNative.backupFolderBookmark"
  private let keyService = "cz.kalensky.dochazka.backup"
  private let keyAccount = "backup-key-v1"
  private let magic = Data("DOCHZK01".utf8)

  // MARK: - složka

  func saveFolder(_ url: URL) throws -> String {
    let accessing = url.startAccessingSecurityScopedResource()
    defer { if accessing { url.stopAccessingSecurityScopedResource() } }
    let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    UserDefaults.standard.set(bookmark, forKey: bookmarkKey)
    return url.lastPathComponent
  }

  func clearFolder() {
    UserDefaults.standard.removeObject(forKey: bookmarkKey)
  }

  func resolveFolder() throws -> URL {
    guard let bookmark = UserDefaults.standard.data(forKey: bookmarkKey) else { throw VaultError.noFolder }
    var stale = false
    let url: URL
    do {
      url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
    } catch {
      throw VaultError.folderUnavailable(error.localizedDescription)
    }
    if stale {
      // Obnovit bookmark (složka se přesunula/přejmenovala) - když to nejde, nevadí.
      let accessing = url.startAccessingSecurityScopedResource()
      if let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
        UserDefaults.standard.set(fresh, forKey: bookmarkKey)
      }
      if accessing { url.stopAccessingSecurityScopedResource() }
    }
    return url
  }

  func folderInfo() -> [String: Any] {
    guard UserDefaults.standard.data(forKey: bookmarkKey) != nil else {
      return ["configured": false, "accessible": false, "name": "", "error": ""]
    }
    do {
      let url = try resolveFolder()
      let accessing = url.startAccessingSecurityScopedResource()
      defer { if accessing { url.stopAccessingSecurityScopedResource() } }
      var isDir: ObjCBool = false
      let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
      return ["configured": true, "accessible": exists && isDir.boolValue, "name": url.lastPathComponent, "error": exists ? "" : "složka neexistuje"]
    } catch {
      return ["configured": true, "accessible": false, "name": "", "error": "\(error)"]
    }
  }

  private func withFolder<T>(_ body: (URL) throws -> T) throws -> T {
    let url = try resolveFolder()
    let accessing = url.startAccessingSecurityScopedResource()
    defer { if accessing { url.stopAccessingSecurityScopedResource() } }
    return try body(url)
  }

  // Zápis přes NSFileCoordinator - složka může být v iCloud Drive.
  private func coordinatedWrite(_ data: Data, to url: URL) throws {
    var coordinatorError: NSError?
    var writeError: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &coordinatorError) { target in
      do {
        try data.write(to: target, options: .atomic)
      } catch {
        writeError = error
      }
    }
    if let error = coordinatorError ?? writeError { throw error }
  }

  private func coordinatedRead(_ url: URL) throws -> Data {
    var coordinatorError: NSError?
    var result: Result<Data, Error> = .failure(VaultError.badFile)
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordinatorError) { source in
      result = Result { try Data(contentsOf: source) }
    }
    if let error = coordinatorError { throw error }
    return try result.get()
  }

  func listFiles() throws -> [[String: Any]] {
    return try withFolder { folder in
      let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
      let items = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
      return items.filter { $0.pathExtension == "dochazka" }.map { item -> [String: Any] in
        let values = try? item.resourceValues(forKeys: Set(keys))
        return [
          "name": item.lastPathComponent,
          "size": values?.fileSize ?? 0,
          "modifiedMs": (values?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000,
        ]
      }
    }
  }

  func deleteFile(name: String) throws {
    try withFolder { folder in
      let target = folder.appendingPathComponent(name)
      var coordinatorError: NSError?
      var deleteError: Error?
      NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: target, options: .forDeleting, error: &coordinatorError) { url in
        do { try FileManager.default.removeItem(at: url) } catch { deleteError = error }
      }
      if let error = coordinatorError ?? deleteError { throw error }
    }
  }

  // Zašifruje lokální soubor (snímek DB) a zapíše ho do složky. Vrací velikost.
  func writeEncrypted(sourcePath: String, fileName: String) throws -> Int {
    let key = try loadKey()
    let plain = try Data(contentsOf: URL(fileURLWithPath: sourcePath))
    let sealed = try AES.GCM.seal(plain, using: key)
    guard let combined = sealed.combined else { throw VaultError.badFile }
    let payload = magic + combined
    try withFolder { folder in
      try coordinatedWrite(payload, to: folder.appendingPathComponent(fileName))
    }
    return payload.count
  }

  // Zkopíruje soubor ze složky do dočasné složky appky (pro obnovu).
  func copyFolderFileToTemp(name: String) throws -> String {
    return try withFolder { folder in
      let data = try coordinatedRead(folder.appendingPathComponent(name))
      return try writeTemp(data, name: name)
    }
  }

  // Soubor vybraný v Souborech (obnova na novém telefonu) -> dočasná kopie.
  func copyPickedFileToTemp(url: URL) throws -> String {
    let accessing = url.startAccessingSecurityScopedResource()
    defer { if accessing { url.stopAccessingSecurityScopedResource() } }
    let data = try coordinatedRead(url)
    return try writeTemp(data, name: url.lastPathComponent)
  }

  private func writeTemp(_ data: Data, name: String) throws -> String {
    let target = FileManager.default.temporaryDirectory.appendingPathComponent("obnova-\(UUID().uuidString)-\(name)")
    try data.write(to: target, options: .atomic)
    return target.path
  }

  func decrypt(sourcePath: String, destinationPath: String, keyBase64: String?) throws {
    let key: SymmetricKey
    if let keyBase64 = keyBase64, !keyBase64.isEmpty {
      guard let raw = Data(base64Encoded: keyBase64), raw.count == 32 else { throw VaultError.noKey }
      key = SymmetricKey(data: raw)
    } else {
      key = try loadKey()
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: sourcePath))
    guard data.count > magic.count + 28, data.prefix(magic.count) == magic else { throw VaultError.badFile }
    let box = try AES.GCM.SealedBox(combined: data.dropFirst(magic.count))
    let plain: Data
    do {
      plain = try AES.GCM.open(box, using: key)
    } catch {
      throw VaultError.noKey
    }
    try plain.write(to: URL(fileURLWithPath: destinationPath), options: .atomic)
  }

  // MARK: - klíč v Klíčence

  private func baseQuery() -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keyService,
      kSecAttrAccount as String: keyAccount,
    ]
  }

  private func readKeyData() -> (Data, Bool)? {
    var query = baseQuery()
    query[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny
    query[kSecReturnData as String] = true
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let attributes = item as? [String: Any], let data = attributes[kSecValueData as String] as? Data else {
      return nil
    }
    let sync = (attributes[kSecAttrSynchronizable as String] as? Bool) ?? ((attributes[kSecAttrSynchronizable as String] as? NSNumber)?.boolValue ?? false)
    return (data, sync)
  }

  private func loadKey() throws -> SymmetricKey {
    guard let found = readKeyData(), found.0.count == 32 else { throw VaultError.noKey }
    return SymmetricKey(data: found.0)
  }

  func keyStatus() -> [String: Any] {
    if let found = readKeyData() {
      return ["exists": found.0.count == 32, "synchronizable": found.1]
    }
    return ["exists": false, "synchronizable": false]
  }

  private func storeKey(_ data: Data) throws {
    var deleteQuery = baseQuery()
    deleteQuery[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny
    SecItemDelete(deleteQuery as CFDictionary)
    var add = baseQuery()
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    add[kSecAttrSynchronizable as String] = kCFBooleanTrue
    var status = SecItemAdd(add as CFDictionary, nil)
    if status != errSecSuccess {
      // Kdyby synchronizovatelná položka nešla uložit, aspoň místně.
      add[kSecAttrSynchronizable as String] = kCFBooleanFalse
      status = SecItemAdd(add as CFDictionary, nil)
    }
    if status != errSecSuccess { throw VaultError.keychain(status) }
  }

  func createKeyIfMissing() throws -> [String: Any] {
    if let found = readKeyData(), found.0.count == 32 {
      return ["created": false, "key": found.0.base64EncodedString()]
    }
    let key = SymmetricKey(size: .bits256)
    let data = key.withUnsafeBytes { Data($0) }
    try storeKey(data)
    return ["created": true, "key": data.base64EncodedString()]
  }

  func exportKey() -> String {
    return readKeyData()?.0.base64EncodedString() ?? ""
  }

  func importKey(base64: String) throws {
    guard let data = Data(base64Encoded: base64), data.count == 32 else { throw VaultError.noKey }
    try storeKey(data)
  }

  // MARK: - stav zařízení (4.2)

  // Datum vypršení podpisu z embedded.mobileprovision (Sideloadly ho do
  // appky vloží při každém podepsání). "" = nelze zjistit.
  func provisioningExpiry() -> String {
    guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
          let raw = try? Data(contentsOf: URL(fileURLWithPath: path)),
          let text = String(data: raw, encoding: .isoLatin1),
          let start = text.range(of: "<?xml"),
          let end = text.range(of: "</plist>") else {
      return ""
    }
    let plistText = String(text[start.lowerBound..<end.upperBound])
    guard let plistData = plistText.data(using: .isoLatin1),
          let plist = try? PropertyListSerialization.propertyList(from: plistData, options: [], format: nil) as? [String: Any],
          let expiry = plist["ExpirationDate"] as? Date else {
      return ""
    }
    return ISO8601DateFormatter().string(from: expiry)
  }
}
