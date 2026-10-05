// Nastavení -> Poloha a trasy -> Uložená místa -> Nové/upravit místo
// (ČÁST B bod 5). Jedna obrazovka pro oba vstupy ze zadání - "Zde jsem
// teď" i "výběr na mapě": mapa se otevře vycentrovaná na aktuální
// polohu (= "zde jsem teď" samo o sobě), a klepnutím kamkoliv na mapu
// (AppleMaps.View, onMapClick) si uživatel značku případně přesune -
// to JE "výběr na mapě". Dva různé vstupy, jedna přirozená interakce,
// žádná duplicitní obrazovka navíc.

import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { AppleMaps } from 'expo-maps';
import { router, useLocalSearchParams } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import NumPad from '@/components/NumPad';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import ToggleRow from '@/components/ToggleRow';
import { createPlace, listPlaces, updatePlace } from '@/lib/db';
import { refreshGeofences } from '@/lib/locationTracking';
import { rebuildRecentVisits } from '@/lib/visits';
import { colors, fonts, radii, MIN_TOUCH, fs } from '@/theme';

const DEFAULT_COORDS = { latitude: 50.0755, longitude: 14.4378 }; // Praha - jen záložní výchozí, dokud se nezjistí GPS

export default function PlaceEditScreen() {
  // `lat`/`lon` - předvyplnění z Detailu dne ("Neznámé místo" -> "Uložit
  // jako nové místo", viz app/day/[date].tsx), `rebuildFrom` (ISO) - od
  // kdy přepočítat pobyty, ať se ten pobyt hned přiřadí k novému místu;
  // `name` - návrh názvu podle obce (upozornění "Uložit jako pracovní místo").
  const { id, lat, lon, rebuildFrom, name: suggestedName } = useLocalSearchParams<{
    id?: string;
    lat?: string;
    lon?: string;
    rebuildFrom?: string;
    name?: string;
  }>();
  const placeId = id ? Number(id) : null;

  const [name, setName] = useState('');
  const [radiusM, setRadiusM] = useState(150);
  const [orderLabel, setOrderLabel] = useState('');
  const [isHome, setIsHome] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [coords, setCoords] = useState(DEFAULT_COORDS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (placeId) {
        const places = await listPlaces(true);
        const existing = places.find((p) => p.id === placeId);
        if (existing) {
          setName(existing.name);
          setRadiusM(existing.radiusM);
          setOrderLabel(existing.orderLabel);
          setIsHome(existing.isHome);
          setIsPrivate(existing.isPrivate);
          setCoords({ latitude: existing.latitude, longitude: existing.longitude });
        }
      } else if (lat && lon) {
        setCoords({ latitude: Number(lat), longitude: Number(lon) });
        if (suggestedName) setName(suggestedName);
      } else {
        try {
          const permission = await Location.getForegroundPermissionsAsync();
          if (permission.status === 'granted') {
            const position = await Location.getCurrentPositionAsync({});
            setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          }
        } catch {
          // zůstane výchozí DEFAULT_COORDS - uživatel si místo stejně
          // může přesunout klepnutím na mapu
        }
      }
      setLoading(false);
    })();
  }, [placeId, lat, lon, suggestedName]);

  const handleMapClick = useCallback((event: { coordinates: { latitude?: number; longitude?: number } }) => {
    if (event.coordinates.latitude === undefined || event.coordinates.longitude === undefined) return;
    setCoords({ latitude: event.coordinates.latitude, longitude: event.coordinates.longitude });
  }, []);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Chybí název', 'Zadej název místa.');
      return;
    }
    setSaving(true);
    try {
      const fields = {
        name: trimmedName,
        latitude: coords.latitude,
        longitude: coords.longitude,
        radiusM,
        orderLabel,
        isHome,
        isPrivate: isHome || isPrivate,
      };
      if (placeId) {
        await updatePlace(placeId, fields);
      } else {
        await createPlace(fields);
      }
      await refreshGeofences({ force: true, reason: placeId ? 'úprava místa' : 'nové místo' }).catch(() => {});
      // Nové/změněné místo -> pobyty posledních dnů (a od pobytu, ze
      // kterého se místo uložilo) se přepočítají s novým místem.
      await rebuildRecentVisits(rebuildFrom ? Date.parse(rebuildFrom) : undefined).catch(() => {});
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={placeId ? 'UPRAVIT MÍSTO' : 'NOVÉ MÍSTO'} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>Mapa se otevřela na tvojí aktuální poloze - klepnutím kamkoliv jinam značku přesuneš.</Text>

        <View style={styles.mapWrap}>
          <AppleMaps.View
            style={styles.map}
            cameraPosition={{ coordinates: coords, zoom: 15 }}
            markers={[{ coordinates: coords, tintColor: colors.accent }]}
            circles={[
              {
                center: coords,
                radius: radiusM,
                color: 'rgba(242,183,5,0.18)',
                lineColor: colors.accent,
                lineWidth: 2,
              },
            ]}
            onMapClick={handleMapClick}
          />
        </View>

        <Text style={styles.fieldLabel}>Název</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="např. Stavba Novákovi"
          placeholderTextColor={colors.textMuted}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />

        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Poloměr</Text>
          <NumPad
            value={radiusM}
            step={10}
            unitLabel="m"
            onChange={(v) => setRadiusM(Math.min(500, Math.max(50, v)))}
          />
        </View>

        <Text style={styles.fieldLabel}>Zakázka / odběratel</Text>
        <TextInput
          style={styles.input}
          value={orderLabel}
          onChangeText={setOrderLabel}
          placeholder="volitelné"
          placeholderTextColor={colors.textMuted}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />

        <View style={styles.homeToggle}>
          <SegmentedControl
            label="Skupina"
            value={isHome || isPrivate ? 'private' : 'work'}
            onChange={(v) => {
              // domov nejde přesunout mezi pracovní místa
              if (!isHome) setIsPrivate(v === 'private');
            }}
            options={[
              { label: 'Pracovní', value: 'work' },
              { label: 'Soukromé', value: 'private' },
            ]}
          />
          <Text style={styles.hint}>
            {isHome || isPrivate
              ? 'Soukromé místo se nepočítá do pracovní doby ani do návrhu hodin.'
              : 'Pracovní místo se počítá do návrhu hodin podle pobytů.'}
          </Text>
          <ToggleRow
            label="Domov"
            description="Domov je vždy soukromé místo"
            value={isHome}
            onValueChange={(v) => {
              setIsHome(v);
              if (v) setIsPrivate(true);
            }}
          />
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          <Text style={styles.saveButtonText}>{saving ? 'UKLÁDÁM...' : 'ULOŽIT'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 10, lineHeight: 17 },
  mapWrap: { height: 260, borderRadius: radii.card, overflow: 'hidden', marginBottom: 16 },
  map: { flex: 1 },
  fieldLabel: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(12), marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  homeToggle: { marginTop: 16 },
  saveButton: {
    height: MIN_TOUCH,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  saveButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
});
