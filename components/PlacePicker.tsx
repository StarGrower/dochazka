// Výběr místa položky práce (doplněk etapy 5) - zobrazuje se uvnitř panelu
// položky (bez další obrazovky, panel by se navigací zavřel):
// - "Podle mých pobytů" (automaticky) / místa dnešních pobytů / uložená místa,
// - nové místo bez mé přítomnosti: hledání adresy / obce / firmy (MapKit)
//   nebo bod na mapě. Takové místo se NEHLÍDÁ (iOS umí jen 20 oblastí a
//   pobyty na něm nevznikají) - jde zapnout v Nastavení → Uložená místa.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { AppleMaps } from 'expo-maps';

import { KEYBOARD_ACCESSORY_ID } from './KeyboardDoneAccessory';
import { createPlace } from '@/lib/db';
import type { Place, PlaceSource } from '@/lib/types';
import DochazkaNative from '../modules/dochazka-native/src/DochazkaNative';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type SearchResult = { name: string; subtitle: string; latitude: number; longitude: number };

interface PlacePickerProps {
  places: Place[]; // uložená místa (bez smazaných)
  dayPlaceIds: number[]; // místa mých dnešních pobytů
  value: number | null; // null = podle mých pobytů
  onSelect: (placeId: number | null) => void;
  onCreated: (place: Place) => void; // nové místo -> přidat do nabídky a vybrat
  onBack: () => void;
}

const DEFAULT_COORDS = { latitude: 50.0755, longitude: 14.4378 }; // Praha - jen záloha bez GPS

export default function PlacePicker({ places, dayPlaceIds, value, onSelect, onCreated, onBack }: PlacePickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [mapMode, setMapMode] = useState(false);
  const [coords, setCoords] = useState(DEFAULT_COORDS);
  const [mapName, setMapName] = useState('');
  const [near, setNear] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    Location.getLastKnownPositionAsync()
      .then((p) => {
        if (!p) return;
        const c = { latitude: p.coords.latitude, longitude: p.coords.longitude };
        setNear(c);
        setCoords(c);
      })
      .catch(() => {});
  }, []);

  const work = places.filter((p) => !p.isHome && !p.isPrivate);
  const q = query.trim().toLowerCase();
  const saved = q ? work.filter((p) => `${p.name} ${p.orderLabel}`.toLowerCase().includes(q)).slice(0, 8) : [];
  const dayPlaces = dayPlaceIds.map((id) => work.find((p) => p.id === id)).filter((p): p is Place => !!p);

  const search = async () => {
    if (!q) return;
    setSearching(true);
    try {
      setResults(await DochazkaNative.searchPlaces(query.trim(), near?.latitude ?? 0, near?.longitude ?? 0));
    } catch (err) {
      Alert.alert('Hledání se nepovedlo', `${err instanceof Error ? err.message : String(err)}\n\nHledání potřebuje internet. Můžeš zvolit bod na mapě.`);
    } finally {
      setSearching(false);
    }
  };

  const create = async (name: string, latitude: number, longitude: number, source: PlaceSource) => {
    const fields = { name, latitude, longitude, radiusM: 150, orderLabel: '', isHome: false, isPrivate: false, monitored: false, source };
    const id = await createPlace(fields);
    onCreated({ id, ...fields, isDeleted: false });
  };

  const chip = (label: string, active: boolean, onPress: () => void, key: string) => (
    <TouchableOpacity key={key} style={[styles.chip, active && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  if (mapMode) {
    return (
      <View>
        <Text style={styles.title}>BOD NA MAPĚ</Text>
        <Text style={styles.hint}>Klepnutím na mapu přesuneš značku.</Text>
        <View style={styles.mapWrap}>
          <AppleMaps.View
            style={styles.map}
            cameraPosition={{ coordinates: coords, zoom: 14 }}
            markers={[{ coordinates: coords, tintColor: colors.accent }]}
            onMapClick={(e) => {
              if (e.coordinates.latitude !== undefined && e.coordinates.longitude !== undefined) {
                setCoords({ latitude: e.coordinates.latitude, longitude: e.coordinates.longitude });
              }
            }}
          />
        </View>
        <TextInput
          style={styles.input}
          value={mapName}
          onChangeText={setMapName}
          placeholder="Název místa (např. Stavba X)"
          placeholderTextColor={colors.textMuted}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.secondary} onPress={() => setMapMode(false)}>
            <Text style={styles.secondaryText}>‹ Zpět</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.primary}
            onPress={() => {
              if (!mapName.trim()) {
                Alert.alert('Chybí název', 'Zadej název místa.');
                return;
              }
              create(mapName.trim(), coords.latitude, coords.longitude, 'map');
            }}
          >
            <Text style={styles.primaryText}>ULOŽIT MÍSTO</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.title}>MÍSTO POLOŽKY</Text>
      <View style={styles.chips}>
        {chip('Podle mých pobytů', value === null, () => onSelect(null), 'auto')}
        {dayPlaces.map((p) => chip(p.name, value === p.id, () => onSelect(p.id), `d${p.id}`))}
      </View>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          setResults(null);
        }}
        onSubmitEditing={search}
        returnKeyType="search"
        placeholder="Hledat uložené místo, adresu nebo obec"
        placeholderTextColor={colors.textMuted}
        inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
      />
      {saved.map((p) => (
        <TouchableOpacity key={p.id} style={styles.result} onPress={() => onSelect(p.id)}>
          <Text style={styles.resultName}>{p.name}</Text>
          <Text style={styles.resultSub}>uložené místo{p.monitored ? '' : ' · nehlídané'}</Text>
        </TouchableOpacity>
      ))}
      {q !== '' && (
        <TouchableOpacity style={styles.searchBtn} onPress={search} disabled={searching}>
          {searching ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.searchText}>Hledat „{query.trim()}“ na mapě</Text>}
        </TouchableOpacity>
      )}
      {results?.length === 0 && <Text style={styles.hint}>Nic nenalezeno - zkus obec nebo bod na mapě.</Text>}
      {results?.map((r, i) => (
        <TouchableOpacity key={`${r.latitude},${r.longitude},${i}`} style={styles.result} onPress={() => create(r.name, r.latitude, r.longitude, 'search')}>
          <Text style={styles.resultName}>+ {r.name}</Text>
          <Text style={styles.resultSub}>{r.subtitle || 'nové místo'}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.searchBtn} onPress={() => setMapMode(true)}>
        <Text style={styles.searchText}>+ Nové místo bodem na mapě</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Nové místo se nehlídá (bez pobytů a upozornění) - jde zapnout v Nastavení → Uložená místa.</Text>
      <TouchableOpacity style={styles.back} onPress={onBack}>
        <Text style={styles.secondaryText}>‹ Zpět k položce</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1, marginBottom: 10 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TOUCH, maxWidth: '100%', paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  chipTextOn: { color: colors.onAccent },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.background, marginTop: 10 },
  result: { minHeight: MIN_TOUCH, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 },
  resultName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  resultSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  searchBtn: { minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  searchText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  mapWrap: { height: 220, borderRadius: radii.card, overflow: 'hidden', marginTop: 8 },
  map: { flex: 1 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 14 },
  secondary: { flex: 1, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  primary: { flex: 1, height: MIN_TOUCH, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
  back: { height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
