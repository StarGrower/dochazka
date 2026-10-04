// Místní upozornění s akcemi (etapa 4.2 a 4.3) - bez expo-notifications.
//
// NETRIVIÁLNÍ ROZHODNUTÍ - vlastní modul místo expo-notifications: jeho
// config plugin přidává do appky oprávnění pro push notifikace
// (aps-environment), které bezplatné Apple ID nepodporuje. Místní
// upozornění žádné oprávnění nepotřebují.
//
// Odpověď na upozornění (klepnutí, akce "Zapsat: Bagr 7,5 h" apod.) se
// stejně jako události polohy nejdřív uloží do fronty v UserDefaults a
// JS si ji vyzvedne (drainResponses) - akce bez otevření appky iOS
// doručí appce spuštěné na pozadí dřív, než naběhne JS. Delegate se
// nastavuje v AppDelegate subscriberu (DochazkaNotificationsSubscriber)
// hned při startu procesu, jinak by se odpověď při studeném startu ztratila.
//
// Text tlačítek akcí je u iOS součástí KATEGORIE upozornění - proto má
// každé upozornění s dynamickým textem ("Zapsat: Bagr 7,5 h") vlastní
// kategorii; všechny se drží v UserDefaults a registrují se znovu najednou.

import ExpoModulesCore
import Foundation
import UserNotifications

let NOTIFICATION_RESPONSE_EVENT = "onNotificationResponse"
let notificationResponseReceived = Notification.Name("DochazkaNative.notificationResponse")

final class LocalNotifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = LocalNotifications()

  private let responsesKey = "DochazkaNative.notificationResponses"
  private let categoriesKey = "DochazkaNative.notificationCategories"
  private let lock = NSLock()

  // MARK: - delegate

  func install() {
    UNUserNotificationCenter.current().delegate = self
    registerStoredCategories()
  }

  // Upozornění zobrazit i když je appka otevřená.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let request = response.notification.request
    let data = (request.content.userInfo["data"] as? String) ?? ""
    var action = response.actionIdentifier
    if action == UNNotificationDefaultActionIdentifier { action = "open" }
    if action == UNNotificationDismissActionIdentifier { action = "dismiss" }
    let entry: [String: Any] = [
      "notificationId": request.identifier,
      "actionId": action,
      "data": data,
      "receivedAt": ISO8601DateFormatter().string(from: Date()),
    ]
    lock.lock()
    var pending = UserDefaults.standard.array(forKey: responsesKey) as? [[String: Any]] ?? []
    pending.append(entry)
    UserDefaults.standard.set(pending, forKey: responsesKey)
    lock.unlock()
    NotificationCenter.default.post(name: notificationResponseReceived, object: nil, userInfo: entry)
    completionHandler()
  }

  func drainResponses() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    let pending = UserDefaults.standard.array(forKey: responsesKey) as? [[String: Any]] ?? []
    UserDefaults.standard.removeObject(forKey: responsesKey)
    return pending
  }

  // MARK: - oprávnění

  func requestPermission(completion: @escaping (Bool) -> Void) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      completion(granted)
    }
  }

  func permissionStatus(completion: @escaping (String) -> Void) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral: completion("granted")
      case .denied: completion("denied")
      default: completion("undetermined")
      }
    }
  }

  // MARK: - kategorie (tlačítka akcí)

  private func storedCategories() -> [String: [[String: Any]]] {
    return UserDefaults.standard.dictionary(forKey: categoriesKey) as? [String: [[String: Any]]] ?? [:]
  }

  private func registerStoredCategories() {
    let categories = storedCategories().map { (id, actions) -> UNNotificationCategory in
      let notificationActions = actions.compactMap { action -> UNNotificationAction? in
        guard let actionId = action["id"] as? String, let title = action["title"] as? String else { return nil }
        var options: UNNotificationActionOptions = []
        if (action["destructive"] as? Bool) == true { options.insert(.destructive) }
        if (action["foreground"] as? Bool) == true { options.insert(.foreground) }
        return UNNotificationAction(identifier: actionId, title: title, options: options)
      }
      return UNNotificationCategory(identifier: id, actions: notificationActions, intentIdentifiers: [], options: [])
    }
    UNUserNotificationCenter.current().setNotificationCategories(Set(categories))
  }

  private func setCategory(_ id: String, actions: [[String: Any]]?) {
    var all = storedCategories()
    all[id] = actions
    UserDefaults.standard.set(all, forKey: categoriesKey)
    registerStoredCategories()
  }

  // MARK: - plánování

  // `fireAtMs` <= teď -> za 1 s. Stejné `id` nahradí dřívější upozornění.
  func schedule(id: String, title: String, body: String, fireAtMs: Double, actions: [[String: Any]], data: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    content.userInfo = ["data": data]
    if !actions.isEmpty {
      let categoryId = "cat-\(id)"
      setCategory(categoryId, actions: actions)
      content.categoryIdentifier = categoryId
    }
    let delay = max(1, fireAtMs / 1000 - Date().timeIntervalSince1970)
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
    let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
    UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
  }

  func cancel(id: String) {
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
    UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
    setCategory("cat-\(id)", actions: nil)
  }

  func pendingIds(completion: @escaping ([String]) -> Void) {
    UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
      completion(requests.map { $0.identifier })
    }
  }
}

// Nastaví delegate upozornění hned při startu procesu (i na pozadí).
public class DochazkaNotificationsSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    LocalNotifications.shared.install()
    return true
  }
}
