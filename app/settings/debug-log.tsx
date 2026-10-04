// Nastavení -> Aplikace -> Ladicí deník (ČÁST B bod 9) - pro testování
// v terénu: seznam událostí záznamu polohy s časem a stavem baterie,
// export do souboru pro poslání. Oprava 2 (F1): u souřadnic nejbližší
// obec ("50.1,14.4 · u Prahy") - dohledá se až tady, ne při záznamu.

import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import { clearDebugLog, listDebugLog } from '@/lib/db';
import { geocodeKey, nearLocalityLabel, resolveLocalities } from '@/lib/geocode';
import type { DebugLogEntry } from '@/lib/types';
import { colors, fonts, radii, fs } from '@/theme';

const EVENT_LABELS: Record<DebugLogEntry['eventType'], string> = {
  arrival: 'PŘÍJEZD',
  departure: 'ODJEZD',
  geofence_enter: 'GEOFENCE VSTUP',
  geofence_exit: 'GEOFENCE VÝSTUP',
  point: 'BOD',
  app_wake: 'PROBUZENÍ APPKY',
  significant_change: 'VÝZNAMNÁ ZMĚNA',
  permission: 'OPRÁVNĚNÍ',
  error: 'CHYBA',
  trip_start: 'START JÍZDY',
  trip_end: 'KONEC JÍZDY',
  trip: 'PŘEJEZD',
  backup: 'ZÁLOHA',
  reminder: 'PŘIPOMENUTÍ',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function DebugLogScreen() {
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const [localities, setLocalities] = useState<Map<string, string>>(new Map());

  const withCoords = (list: DebugLogEntry[]) =>
    list.flatMap((e) => (e.latitude !== null && e.longitude !== null ? [{ latitude: e.latitude, longitude: e.longitude }] : []));

  const load = useCallback(async () => {
    const list = await listDebugLog();
    setEntries(list);
    // Obce se doplní dodatečně - seznam se ukáže hned, bez čekání na síť.
    resolveLocalities(withCoords(list))
      .then(setLocalities)
      .catch(() => {});
  }, []);

  const localityOf = (e: DebugLogEntry, map: Map<string, string>): string => {
    if (e.latitude === null || e.longitude === null) return '';
    const name = map.get(geocodeKey(e.latitude, e.longitude));
    return name ? ` · ${nearLocalityLabel(name)}` : '';
  };

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleExport = async () => {
    const names = await resolveLocalities(withCoords(entries)).catch(() => localities);
    const lines = entries.map((e) => {
      const battery = e.batteryLevel !== null ? `${Math.round(e.batteryLevel * 100)}%` : '-';
      const coords =
        e.latitude !== null && e.longitude !== null
          ? `${e.latitude.toFixed(5)},${e.longitude.toFixed(5)}${localityOf(e, names)}`
          : '-';
      const delivered = e.deliveredAt
        ? `\tdoručeno ${e.deliveredAt}, baterie ${e.deliveredBattery !== null ? `${Math.round(e.deliveredBattery * 100)}%` : '-'}`
        : '';
      return `${e.timestamp}\t${EVENT_LABELS[e.eventType]}\tbaterie ${battery}\t${coords}\t${e.detail}${delivered}`;
    });
    const content = `Docházka - ladicí deník\nExportováno: ${new Date().toISOString()}\n\n${lines.join('\n')}`;

    const file = new File(Paths.cache, `dochazka-ladici-denik-${Date.now()}.txt`);
    file.create();
    file.write(content);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri);
    } else {
      Alert.alert('Export hotový', `Soubor je uložený v: ${file.uri}`);
    }
  };

  const handleClear = () => {
    Alert.alert('Vymazat ladicí deník', 'Opravdu smazat všechny záznamy?', [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Vymazat',
        style: 'destructive',
        onPress: async () => {
          await clearDebugLog();
          await load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="LADICÍ DENÍK" />

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.actionButton} onPress={handleExport}>
          <Text style={styles.actionButtonText}>EXPORTOVAT</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButtonDanger} onPress={handleClear}>
          <Text style={styles.actionButtonDangerText}>VYMAZAT</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.eventType}>{EVENT_LABELS[item.eventType]}</Text>
              <Text style={styles.timestamp}>{formatTimestamp(item.timestamp)}</Text>
            </View>
            {!!item.detail && <Text style={styles.detail}>{item.detail}</Text>}
            <Text style={styles.meta}>
              baterie {item.batteryLevel !== null ? `${Math.round(item.batteryLevel * 100)}%` : '-'}
              {item.latitude !== null ? ` · ${item.latitude.toFixed(4)}, ${item.longitude?.toFixed(4)}` : ''}
              {localityOf(item, localities)}
            </Text>
            {item.deliveredAt && (
              <Text style={styles.meta}>
                doručeno {formatTimestamp(item.deliveredAt)} · baterie{' '}
                {item.deliveredBattery !== null ? `${Math.round(item.deliveredBattery * 100)}%` : '-'}
              </Text>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Zatím žádné záznamy.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  buttonRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  actionButton: {
    flex: 1,
    height: 44,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(13), letterSpacing: 1 },
  actionButtonDanger: {
    flex: 1,
    height: 44,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDangerText: { color: colors.danger, fontFamily: fonts.headingBold, fontSize: fs(13), letterSpacing: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  row: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 6,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  eventType: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(12), letterSpacing: 0.5 },
  timestamp: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11) },
  detail: { color: colors.text, fontFamily: fonts.body, fontSize: fs(13), marginTop: 4 },
  meta: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11), marginTop: 4 },
  empty: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.body, marginTop: 24 },
});
