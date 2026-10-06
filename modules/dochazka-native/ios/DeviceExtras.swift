// Etapy 6 a 7 - rozpoznání textu z fotky (Apple Vision, offline -
// počitadlo Mth/km, účtenka), čerpací stanice v okolí (MapKit POI -
// upozornění "Tankoval jsi?") a název Bluetooth auta z aktuálního
// zvukového výstupu (kniha jízd - rozpoznání vozidla).

import AVFoundation
import MapKit
import UIKit
import Vision

enum DeviceExtras {
  // Řádky textu z obrázku (base64 JPEG), nejpravděpodobnější kandidát na řádek.
  static func recognizeText(base64: String, completion: @escaping (Result<[String], Error>) -> Void) {
    guard let data = Data(base64Encoded: base64), let image = UIImage(data: data), let cgImage = image.cgImage else {
      completion(.failure(NativeError("Obrázek nejde přečíst.")))
      return
    }
    let request = VNRecognizeTextRequest { request, error in
      if let error = error {
        completion(.failure(error))
        return
      }
      let lines = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { $0.topCandidates(1).first?.string }
      completion(.success(lines))
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    // Čeština v seznamu podporovaných jazyků Vision není jistá; číslice a
    // "Kč" / "l" spolehlivě přečte i angličtina.
    request.recognitionLanguages = ["en-US"]
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
      } catch {
        completion(.failure(error))
      }
    }
  }

  // Název nejbližší čerpací stanice v okruhu `radius` m, "" = žádná.
  static func nearbyGasStation(latitude: Double, longitude: Double, radius: Double, completion: @escaping (Result<String, Error>) -> Void) {
    let center = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    let request = MKLocalPointsOfInterestRequest(center: center, radius: radius)
    request.pointOfInterestFilter = MKPointOfInterestFilter(including: [.gasStation])
    MKLocalSearch(request: request).start { response, error in
      if let items = response?.mapItems, !items.isEmpty {
        let here = CLLocation(latitude: latitude, longitude: longitude)
        let nearest = items.min { a, b in
          here.distance(from: CLLocation(latitude: a.placemark.coordinate.latitude, longitude: a.placemark.coordinate.longitude))
            < here.distance(from: CLLocation(latitude: b.placemark.coordinate.latitude, longitude: b.placemark.coordinate.longitude))
        }
        completion(.success(nearest?.name ?? "čerpací stanice"))
        return
      }
      if let error = error as? MKError, error.code == .placemarkNotFound {
        completion(.success(""))
        return
      }
      if let error = error {
        completion(.failure(error))
        return
      }
      completion(.success(""))
    }
  }

  // Název připojeného Bluetooth / CarPlay zvukového výstupu, "" = žádný.
  static func bluetoothAudioRoute() -> String {
    let carTypes: [AVAudioSession.Port] = [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .carAudio]
    let output = AVAudioSession.sharedInstance().currentRoute.outputs.first { carTypes.contains($0.portType) }
    return output?.portName ?? ""
  }
}
