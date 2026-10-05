// Vzdálenost po silnici (oprava po terénním testu etapy 3) - MKDirections,
// automobil. Používá se na mezery mezi body GPS (> 300 m) a na úsek od
// místa odjezdu k prvnímu bodu / od posledního bodu k místu příjezdu.
// Výsledek: metry; -1 = trasa nenalezena (použije se vzdušná čára);
// chyba = bez sítě / omezení počtu dotazů -> dopočet se zopakuje později.

import MapKit

enum RoadDistance {
  static func measure(
    from: CLLocationCoordinate2D,
    to: CLLocationCoordinate2D,
    completion: @escaping (Result<Double, Error>) -> Void
  ) {
    let request = MKDirections.Request()
    request.source = MKMapItem(placemark: MKPlacemark(coordinate: from))
    request.destination = MKMapItem(placemark: MKPlacemark(coordinate: to))
    request.transportType = .automobile
    request.requestsAlternateRoutes = false
    MKDirections(request: request).calculate { response, error in
      if let route = response?.routes.first {
        completion(.success(route.distance))
        return
      }
      if let mkError = error as? MKError, mkError.code == .directionsNotFound {
        completion(.success(-1))
        return
      }
      completion(.failure(error ?? NativeError("Trasu se nepodařilo spočítat.")))
    }
  }
}
