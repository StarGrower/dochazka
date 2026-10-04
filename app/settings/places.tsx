// Nastavení -> Poloha a trasy -> Uložená místa (ČÁST B bod 5).

import { useCallback, useState } from 'react';
import { Alert, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import { deletePlace, listPlaces } from '@/lib/db';
import { refreshGeofences } from '@/lib/locationTracking';
import { rebuildRecentVisits } from '@/lib/visits';
import type { Place } from '@/lib/types';
import { colors, fonts, radii, fs } from '@/theme';

export default function PlacesSettingsScreen() {
  const [places, setPlaces] = useState<Place[]>([]);

  const load = useCallback(async () => {
    setPlaces(await listPlaces());
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleDelete = (place: Place) => {
    Alert.alert('Smazat místo', `Smazat "${place.name}"? Dřívější pobyty zůstanou zachované.`, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          await deletePlace(place.id);
          await refreshGeofences().catch(() => {});
          await rebuildRecentVisits().catch(() => {});
          await load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="ULOŽENÁ MÍSTA" />

      <SectionList
        sections={[
          { title: 'PRACOVNÍ MÍSTA', data: places.filter((p) => !p.isPrivate) },
          { title: 'SOUKROMÁ MÍSTA', data: places.filter((p) => p.isPrivate) },
        ].filter((section) => section.data.length > 0)}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/settings/place-edit?id=${item.id}`)}>
            <View style={styles.rowMain}>
              <Text style={styles.rowName}>
                {item.isHome ? '⌂ ' : ''}
                {item.name}
              </Text>
              <Text style={styles.rowDetail}>
                poloměr {Math.round(item.radiusM)} m{item.orderLabel ? ` · ${item.orderLabel}` : ''}
              </Text>
            </View>
            <TouchableOpacity hitSlop={12} onPress={() => handleDelete(item)}>
              <Text style={styles.deleteLabel}>Smazat</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Zatím žádná uložená místa.</Text>}
      />

      <TouchableOpacity style={styles.addButton} onPress={() => router.push('/settings/place-edit')}>
        <Text style={styles.addButtonText}>+ PŘIDAT MÍSTO</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingHorizontal: 16, paddingTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  rowMain: { flex: 1 },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: fs(12),
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 8,
  },
  rowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  rowDetail: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 2 },
  deleteLabel: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  empty: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.body, marginTop: 24 },
  addButton: {
    height: 54,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
});
