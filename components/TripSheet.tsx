// Úprava přejezdu (etapa 3, body 2 a 3): ruční km, soukromá jízda,
// vozidlo, "PŘIDAT KM DO PRÁCE A STROJŮ", zahození trasy (-> odhad) a
// smazání přejezdu. Nic se neukládá samo - až tlačítkem.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import BottomSheetModal from './BottomSheetModal';
import NumPad from './NumPad';
import ToggleRow from './ToggleRow';
import { formatKc, formatNumberCs } from '@/lib/format';
import { tripKm } from '@/lib/tripPlan';
import type { Trip, WorkCategory } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

export interface TripEdit {
  kmOverride: number | null;
  isPrivate: boolean;
  vehicleCategoryId: number | null;
}

interface TripSheetProps {
  trip: Trip | null; // null = zavřeno
  title: string; // "Přejezd 14:32–14:43 · Domov → Stavba"
  vehicles: WorkCategory[];
  defaultVehicleId: number | null;
  dayWorkKmNotAdded: number; // pracovní km dne, které ještě nejsou v práci a strojích (stejné vozidlo)
  onClose: () => void;
  onSave: (trip: Trip, edit: TripEdit) => void;
  onAddToWork: (trip: Trip, edit: TripEdit, wholeDay: boolean) => void;
  onDiscardRoute: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export default function TripSheet({
  trip,
  title,
  vehicles,
  defaultVehicleId,
  dayWorkKmNotAdded,
  onClose,
  onSave,
  onAddToWork,
  onDiscardRoute,
  onDelete,
}: TripSheetProps) {
  const [km, setKm] = useState(0);
  const [isPrivate, setIsPrivate] = useState(false);
  const [vehicleId, setVehicleId] = useState<number | null>(null);

  useEffect(() => {
    if (!trip) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKm(round1(tripKm(trip)));
    setIsPrivate(trip.isPrivate);
    setVehicleId(trip.vehicleCategoryId ?? defaultVehicleId);
  }, [trip, defaultVehicleId]);

  if (!trip) return <BottomSheetModal visible={false} onClose={onClose}>{null}</BottomSheetModal>;

  const computedKm = round1(trip.distanceM / 1000);
  // Ruční km jen když se liší od vypočtených (jinak zůstane null = vypočtené).
  const edit: TripEdit = {
    kmOverride: Math.abs(km - computedKm) < 0.05 && trip.kmOverride === null ? null : km,
    isPrivate,
    vehicleCategoryId: vehicleId,
  };
  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const added = trip.workRecordId !== null;

  return (
    <BottomSheetModal visible onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>PŘEJEZD</Text>
        <Text style={styles.subtitle}>{title}</Text>
        <Text style={styles.hint}>
          {trip.isEstimate
            ? `Odhad (vzdušná vzdálenost × 1,3)${trip.gpsNote ? ` - ${trip.gpsNote}` : ''}`
            : `Z trasy GPS: ${computedKm.toString().replace('.', ',')} km · ${trip.pointCount} bodů`}
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>Km</Text>
          <NumPad value={km} step={1} unitLabel="km" onChange={(v) => setKm(round1(v))} />
        </View>
        {trip.kmOverride !== null && (
          <TouchableOpacity onPress={() => setKm(computedKm)} hitSlop={8}>
            <Text style={styles.link}>Vrátit vypočtené ({formatNumberCs(computedKm)} km)</Text>
          </TouchableOpacity>
        )}

        <ToggleRow
          label="Soukromá jízda"
          description="Nepočítá se do pracovních km"
          value={isPrivate}
          onValueChange={setIsPrivate}
        />

        <Text style={styles.sectionLabel}>VOZIDLO</Text>
        <View style={styles.vehicleRow}>
          {vehicles.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={[styles.vehicleButton, v.id === vehicleId && styles.vehicleButtonActive]}
              onPress={() => setVehicleId(v.id)}
            >
              <Text style={[styles.vehicleText, v.id === vehicleId && styles.vehicleTextActive]}>{v.name}</Text>
              <Text style={[styles.vehicleRate, v.id === vehicleId && styles.vehicleTextActive]}>
                {v.rates.km > 0 ? `${formatKc(v.rates.km)}/km` : 'bez sazby za km'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {vehicles.length === 0 && <Text style={styles.hint}>Žádný stroj - přidej ho v Nastavení → Stroje a kategorie.</Text>}

        {added ? (
          <Text style={styles.addedText}>Km tohoto přejezdu jsou už v Práci a strojích.</Text>
        ) : (
          !isPrivate &&
          vehicle && (
            <>
              <TouchableOpacity style={styles.primaryButton} onPress={() => onAddToWork(trip, edit, false)}>
                <Text style={styles.primaryButtonText}>PŘIDAT KM DO PRÁCE A STROJŮ</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>
                {vehicle.name} · {formatNumberCs(km)} km × {formatKc(vehicle.rates.km)}
              </Text>
              {dayWorkKmNotAdded > km + 0.05 && (
                <TouchableOpacity style={styles.secondaryWide} onPress={() => onAddToWork(trip, edit, true)}>
                  <Text style={styles.secondaryWideText}>
                    Sečíst všechny pracovní přejezdy dne ({formatNumberCs(round1(dayWorkKmNotAdded))} km) do jedné položky
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )
        )}

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onDelete(trip)}>
            <Text style={styles.deleteText}>Smazat přejezd</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveButton} onPress={() => onSave(trip, edit)}>
            <Text style={styles.primaryButtonText}>ULOŽIT</Text>
          </TouchableOpacity>
        </View>
        {!trip.isEstimate && (
          <TouchableOpacity style={styles.discard} onPress={() => onDiscardRoute(trip)}>
            <Text style={styles.link}>Zahodit trasu (chybná) a použít odhad</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1 },
  subtitle: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14), marginTop: 4 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 6, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  link: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(12), marginBottom: 8 },
  sectionLabel: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(12), letterSpacing: 1, marginTop: 12, marginBottom: 6 },
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  vehicleButton: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  vehicleButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  vehicleText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  vehicleRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11) },
  vehicleTextActive: { color: colors.onAccent },
  addedText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13), marginVertical: 8 },
  primaryButton: {
    height: MIN_TOUCH,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1 },
  secondaryWide: {
    minHeight: MIN_TOUCH,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  secondaryWideText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13), textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  secondaryButton: { flex: 1, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: colors.danger, fontFamily: fonts.body, fontSize: fs(15) },
  saveButton: {
    flex: 1,
    height: MIN_TOUCH,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discard: { alignItems: 'center', marginTop: 12 },
});
