// Mapa v Detailu dne (etapa 3, bod 4) - Apple Maps přes react-native-maps
// v tlumeném tmavém stylu (mutedStandard + dark). Trasy přejezdů žlutou
// čarou, zastávky jako žluté čtverečky s číslem podle průběhu dne,
// soukromá místa šedě s domkem. Klepnutí na mapu ji roztáhne na celou
// obrazovku. `selectedKey` (klepnutí na řádek v seznamu) zvýrazní a
// přiblíží daný pobyt/přejezd.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline, type LatLng } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

export interface DayMapStop {
  key: string; // "visit-<id>"
  coordinate: LatLng;
  label: string; // číslo zastávky nebo '⌂'
  muted: boolean; // soukromé místo
}

export interface DayMapRoute {
  key: string; // "trip-<id>"
  coordinates: LatLng[];
  muted: boolean; // soukromá jízda
}

interface DayMapProps {
  stops: DayMapStop[];
  routes: DayMapRoute[];
  selectedKey: string | null;
}

const EDGE_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

function MapContent({ stops, routes, selectedKey, fullscreen }: DayMapProps & { fullscreen: boolean }) {
  const mapRef = useRef<MapView>(null);
  const allCoordinates = useMemo(
    () => [...stops.map((s) => s.coordinate), ...routes.flatMap((r) => r.coordinates)],
    [stops, routes]
  );

  // Výřez: vybraný pobyt/přejezd, jinak celý den.
  useEffect(() => {
    const target =
      (selectedKey && routes.find((r) => r.key === selectedKey)?.coordinates) ||
      (selectedKey && stops.filter((s) => s.key === selectedKey).map((s) => s.coordinate)) ||
      allCoordinates;
    const coords = target.length > 0 ? target : allCoordinates;
    if (coords.length === 0) return;
    const timer = setTimeout(() => {
      if (coords.length === 1) {
        mapRef.current?.animateToRegion(
          { ...coords[0], latitudeDelta: 0.01, longitudeDelta: 0.01 },
          400
        );
      } else {
        mapRef.current?.fitToCoordinates(coords, { edgePadding: EDGE_PADDING, animated: true });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [selectedKey, routes, stops, allCoordinates, fullscreen]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      mapType="mutedStandard"
      userInterfaceStyle="dark"
      showsPointsOfInterests={false}
      pitchEnabled={false}
      rotateEnabled={false}
      scrollEnabled={fullscreen}
      zoomEnabled={fullscreen}
      toolbarEnabled={false}
    >
      {routes.map((route) => {
        const selected = route.key === selectedKey;
        return (
          <Polyline
            key={route.key}
            coordinates={route.coordinates}
            strokeColor={route.muted ? colors.textMuted : colors.accent}
            strokeWidth={selected ? 6 : 3}
            zIndex={selected ? 2 : 1}
          />
        );
      })}
      {stops.map((stop) => {
        const selected = stop.key === selectedKey;
        return (
          <Marker key={stop.key} coordinate={stop.coordinate} anchor={{ x: 0.5, y: 0.5 }} zIndex={selected ? 3 : 2}>
            <View style={[styles.stop, stop.muted && styles.stopMuted, selected && styles.stopSelected]}>
              <Text style={[styles.stopText, stop.muted && styles.stopTextMuted]}>{stop.label}</Text>
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

export default function DayMap(props: DayMapProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const empty = props.stops.length === 0 && props.routes.length === 0;

  if (empty) {
    return (
      <View style={[styles.wrap, styles.emptyWrap]}>
        <Text style={styles.emptyText}>Pro tenhle den zatím nic na mapě.</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.wrap}>
        <MapContent {...props} fullscreen={false} />
        {/* Průhledná vrstva - klepnutí kamkoliv roztáhne mapu (malá mapa se nehýbe). */}
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setFullscreen(true)} />
      </View>
      <Modal visible={fullscreen} animationType="slide" onRequestClose={() => setFullscreen(false)}>
        <View style={styles.fullscreen}>
          <MapContent {...props} fullscreen />
          <SafeAreaView edges={['top']} style={styles.closeWrap} pointerEvents="box-none">
            <TouchableOpacity style={styles.closeButton} onPress={() => setFullscreen(false)}>
              <Text style={styles.closeText}>ZAVŘÍT</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 200, borderRadius: radii.card, overflow: 'hidden', marginBottom: 12, backgroundColor: colors.card },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    height: 80,
  },
  emptyText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  stop: {
    minWidth: 22,
    height: 22,
    borderRadius: 4,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  stopMuted: { backgroundColor: colors.border },
  stopSelected: { borderColor: colors.text, transform: [{ scale: 1.25 }] },
  stopText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(12) },
  stopTextMuted: { color: colors.textMuted },
  fullscreen: { flex: 1, backgroundColor: colors.background },
  closeWrap: { position: 'absolute', top: 0, right: 0, left: 0, alignItems: 'flex-end', padding: 12 },
  closeButton: {
    height: MIN_TOUCH,
    paddingHorizontal: 16,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1 },
});
