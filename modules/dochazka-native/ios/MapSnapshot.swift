// Snímek mapy s trasami pro PDF výkaz (etapa 4.4) - MKMapSnapshotter
// (světlý tlumený styl kvůli tisku), trasy žlutě, zastávky jako
// číslované žluté čtverečky (jako mapa v Detailu dne). Bez internetu
// selže -> JS nakreslí trasu na prázdný podklad (SVG).

import MapKit
import UIKit

enum MapSnapshot {
  static func render(
    routes: [[[Double]]],
    stops: [[Double]],
    labels: [String],
    size: CGSize,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    func coordinate(_ pair: [Double]) -> CLLocationCoordinate2D? {
      return pair.count >= 2 ? CLLocationCoordinate2D(latitude: pair[0], longitude: pair[1]) : nil
    }
    let all = routes.flatMap { $0 }.compactMap(coordinate) + stops.compactMap(coordinate)
    guard let first = all.first else {
      completion(.failure(NativeError("Žádné body pro mapu.")))
      return
    }
    var minLat = first.latitude, maxLat = first.latitude, minLon = first.longitude, maxLon = first.longitude
    for c in all {
      minLat = min(minLat, c.latitude); maxLat = max(maxLat, c.latitude)
      minLon = min(minLon, c.longitude); maxLon = max(maxLon, c.longitude)
    }
    let options = MKMapSnapshotter.Options()
    options.region = MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
      span: MKCoordinateSpan(latitudeDelta: max((maxLat - minLat) * 1.35, 0.01), longitudeDelta: max((maxLon - minLon) * 1.35, 0.01))
    )
    options.size = size
    options.scale = 2
    options.mapType = .mutedStandard
    options.pointOfInterestFilter = .excludingAll
    options.traitCollection = UITraitCollection(userInterfaceStyle: .light)

    MKMapSnapshotter(options: options).start { snapshot, error in
      guard let snapshot = snapshot else {
        completion(.failure(error ?? NativeError("Mapu se nepodařilo vykreslit.")))
        return
      }
      let format = UIGraphicsImageRendererFormat()
      format.scale = 2
      let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
        snapshot.image.draw(at: .zero)
        let cg = context.cgContext
        let yellow = UIColor(red: 0xF2 / 255.0, green: 0xB7 / 255.0, blue: 0x05 / 255.0, alpha: 1)
        let dark = UIColor(red: 0x13 / 255.0, green: 0x13 / 255.0, blue: 0x11 / 255.0, alpha: 1)

        cg.setLineCap(.round)
        cg.setLineJoin(.round)
        for route in routes {
          let points = route.compactMap(coordinate).map { snapshot.point(for: $0) }
          guard points.count >= 2 else { continue }
          // tmavý obrys pod žlutou čarou - čitelnost na světlé mapě
          for (color, width) in [(dark, CGFloat(6)), (yellow, CGFloat(4))] {
            cg.setStrokeColor(color.cgColor)
            cg.setLineWidth(width)
            cg.move(to: points[0])
            for p in points.dropFirst() { cg.addLine(to: p) }
            cg.strokePath()
          }
        }

        let font = UIFont.boldSystemFont(ofSize: 11)
        for (index, stop) in stops.enumerated() {
          guard let c = coordinate(stop) else { continue }
          let p = snapshot.point(for: c)
          let rect = CGRect(x: p.x - 10, y: p.y - 10, width: 20, height: 20)
          let label = index < labels.count ? labels[index] : ""
          let muted = label == "⌂"
          let path = UIBezierPath(roundedRect: rect, cornerRadius: 4)
          (muted ? UIColor.lightGray : yellow).setFill()
          path.fill()
          dark.setStroke()
          path.lineWidth = 2
          path.stroke()
          let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: dark]
          let text = label as NSString
          let textSize = text.size(withAttributes: attributes)
          text.draw(at: CGPoint(x: p.x - textSize.width / 2, y: p.y - textSize.height / 2), withAttributes: attributes)
        }
      }
      completion(.success(image.pngData()?.base64EncodedString() ?? ""))
    }
  }
}
