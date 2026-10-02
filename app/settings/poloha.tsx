// Nastavení -> Poloha a trasy (ČÁST B, etapa 2) - hlavní přepínač,
// režim, interval, dny a časové okno záznamu, minimální délka pobytu
// jsou teď SKUTEČNĚ funkční (zadání ČÁST B bod 8). "Uložená místa" má
// vlastní obrazovku (app/settings/places.tsx), je taky plně funkční -
// ne "Připravujeme".

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import NumPad from '@/components/NumPad';
import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import ToggleRow from '@/components/ToggleRow';
import { getSettings, listPlaces, updateSettings } from '@/lib/db';
import {
  applyLocationTrackingState,
  ensureLocationPermissions,
  getLocationPermissionStatus,
  openIosSettings,
} from '@/lib/locationTracking';
import type { AppSettings } from '@/lib/types';
import { colors, fonts, radii, MIN_TOUCH } from '@/theme';

const WEEKDAYS: { label: string; value: number }[] = [
  { label: 'PO', value: 1 },
  { label: 'ÚT', value: 2 },
  { label: 'ST', value: 3 },
  { label: 'ČT', value: 4 },
  { label: 'PÁ', value: 5 },
  { label: 'SO', value: 6 },
  { label: 'NE', value: 0 },
];

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hhmmToMinutes(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export default function PolohaSettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [placesCount, setPlacesCount] = useState(0);
  const [backgroundGranted, setBackgroundGranted] = useState(true);
  const [startDraft, setStartDraft] = useState('');
  const [endDraft, setEndDraft] = useState('');

  const load = useCallback(async () => {
    const [s, places, permissions] = await Promise.all([
      getSettings(),
      listPlaces(),
      getLocationPermissionStatus(),
    ]);
    setSettings(s);
    setPlacesCount(places.length);
    setBackgroundGranted(permissions.backgroundGranted);
    setStartDraft(minutesToHHMM(s.trackingStartMinutes));
    setEndDraft(minutesToHHMM(s.trackingEndMinutes));
  }, []);

  useFocusEffect(() => {
    load();
  });

  const patch = async (partial: Partial<AppSettings>) => {
    const next = settings ? { ...settings, ...partial } : null;
    setSettings(next);
    await updateSettings(partial);
    if (next) await applyLocationTrackingState(next);
  };

  const handleToggleTracking = async (value: boolean) => {
    if (!value) {
      await patch({ locationTrackingEnabled: false });
      return;
    }
    const result = await ensureLocationPermissions();
    if (!result.foregroundGranted) {
      Alert.alert(
        'Chybí oprávnění k poloze',
        'Docházka potřebuje aspoň oprávnění "Při používání". Povol ho v Nastavení iPhonu.',
        [
          { text: 'Zrušit', style: 'cancel' },
          { text: 'Otevřít Nastavení', onPress: openIosSettings },
        ]
      );
      return;
    }
    setBackgroundGranted(result.backgroundGranted);
    if (!result.backgroundGranted) {
      Alert.alert(
        'Chybí oprávnění "Vždy"',
        'Bez oprávnění "Vždy" appka nebude zaznamenávat polohu, když je zavřená. Zapínám sledování i tak, ale doporučuju oprávnění doplnit v Nastavení iPhonu.',
        [
          { text: 'OK' },
          { text: 'Otevřít Nastavení', onPress: openIosSettings },
        ]
      );
    }
    await patch({ locationTrackingEnabled: true });
  };

  const toggleDay = (day: number) => {
    if (!settings) return;
    const has = settings.trackingDays.includes(day);
    const next = has ? settings.trackingDays.filter((d) => d !== day) : [...settings.trackingDays, day];
    patch({ trackingDays: next });
  };

  const commitStart = () => {
    const minutes = hhmmToMinutes(startDraft);
    if (minutes === null) {
      setStartDraft(minutesToHHMM(settings?.trackingStartMinutes ?? 360));
      return;
    }
    patch({ trackingStartMinutes: minutes });
  };

  const commitEnd = () => {
    const minutes = hhmmToMinutes(endDraft);
    if (minutes === null) {
      setEndDraft(minutesToHHMM(settings?.trackingEndMinutes ?? 1140));
      return;
    }
    patch({ trackingEndMinutes: minutes });
  };

  if (!settings) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="POLOHA A TRASY" />

      <ScrollView contentContainerStyle={styles.content}>
        {settings.locationTrackingEnabled && !backgroundGranted && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>
              Appka nemá oprávnění &quot;Vždy&quot; - sledování nebude fungovat, když ji zavřeš.
              Nastavení → Docházka → Poloha → Vždy.
            </Text>
            <TouchableOpacity onPress={openIosSettings}>
              <Text style={styles.warningLink}>Otevřít Nastavení</Text>
            </TouchableOpacity>
          </View>
        )}

        <ToggleRow
          label="Zaznamenávat trasy"
          value={settings.locationTrackingEnabled}
          onValueChange={handleToggleTracking}
        />

        <SegmentedControl
          label="Režim"
          value={settings.locationMode}
          onChange={(v) => patch({ locationMode: v })}
          options={[
            { label: 'Úsporný', value: 'economical' },
            { label: 'Průběžný', value: 'continuous' },
          ]}
        />

        {settings.locationMode === 'continuous' && (
          <View style={styles.row}>
            <Text style={styles.label}>Interval záznamu</Text>
            <NumPad
              value={settings.continuousIntervalMinutes}
              step={1}
              unitLabel="min"
              onChange={(v) => patch({ continuousIntervalMinutes: Math.min(10, Math.max(5, v)) })}
              hapticsEnabled={settings.hapticsEnabled}
            />
          </View>
        )}

        <Text style={styles.sectionHeader}>KDY ZAZNAMENÁVAT</Text>

        <View style={styles.weekdayRow}>
          {WEEKDAYS.map((d) => {
            const active = settings.trackingDays.includes(d.value);
            return (
              <TouchableOpacity
                key={d.value}
                style={[styles.weekdayButton, active && styles.weekdayButtonActive]}
                onPress={() => toggleDay(d.value)}
              >
                <Text style={[styles.weekdayButtonText, active && styles.weekdayButtonTextActive]}>
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Časové okno od</Text>
          <TextInput
            style={styles.timeInput}
            value={startDraft}
            onChangeText={setStartDraft}
            onBlur={commitStart}
            placeholder="06:00"
            placeholderTextColor={colors.textMuted}
            keyboardType="numbers-and-punctuation"
            inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Časové okno do</Text>
          <TextInput
            style={styles.timeInput}
            value={endDraft}
            onChangeText={setEndDraft}
            onBlur={commitEnd}
            placeholder="19:00"
            placeholderTextColor={colors.textMuted}
            keyboardType="numbers-and-punctuation"
            inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
          />
        </View>
        <Text style={styles.hint}>Mimo tohle okno se poloha nezaznamenává.</Text>

        <View style={styles.row}>
          <Text style={styles.label}>Minimální délka pobytu</Text>
          <NumPad
            value={settings.minStayMinutes}
            step={1}
            unitLabel="min"
            onChange={(v) => patch({ minStayMinutes: Math.max(0, v) })}
            hapticsEnabled={settings.hapticsEnabled}
          />
        </View>

        <Text style={styles.sectionHeader}>ULOŽENÁ MÍSTA</Text>
        <TouchableOpacity style={styles.row} onPress={() => router.push('/settings/places')}>
          <Text style={styles.label}>Stavby, rybníky</Text>
          <Text style={styles.value}>{placesCount} míst ›</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  warningBanner: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 16,
  },
  warningText: { color: colors.danger, fontFamily: fonts.body, fontSize: 12, lineHeight: 17, marginBottom: 6 },
  warningLink: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    minHeight: MIN_TOUCH,
  },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15 },
  value: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
  },
  weekdayRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  weekdayButton: {
    flex: 1,
    height: 40,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  weekdayButtonText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 12 },
  weekdayButtonTextActive: { color: colors.onAccent },
  timeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 72,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: 'center',
  },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, marginBottom: 12 },
});
