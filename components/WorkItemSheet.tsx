// Přidání / úprava položky dne (oprava 2, D2 + C1 + B2) - jeden panel
// pro oba postupy:
// - PŘIDAT: nabídka strojů/prací -> výběr -> hned číselník s množstvím a
//   přepínačem jednotky (h / den / km) -> OK = uloženo. V prázdném dni
//   nahoře návrh výchozích položek (uloží se jen tlačítkem).
// - UPRAVIT: množství + jednotka + Smazat.
// Doplněk etapy 5: každá položka má MÍSTO (výchozí podle mého pobytu, nebo
// libovolné uložené / nové místo bez přítomnosti), PRACOVNÍKA (já / kolega),
// zakázku a volitelně čas od-do.
// Sazba se ukládá k položce v okamžiku zápisu (viz lib/workCalc.ts ->
// priceForRecord) - tenhle panel jen sbírá údaje a ukazuje výpočet.

import { useEffect, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import BottomSheetModal from './BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from './KeyboardDoneAccessory';
import NumPad from './NumPad';
import OrderPicker, { type OrderOption } from './OrderPicker';
import PlacePicker from './PlacePicker';
import { formatKc, formatQuantity, UNIT_RATE_LABEL } from '@/lib/format';
import { savePerson } from '@/lib/orders';
import { ME_ID, type AppSettings, type DayWorkRecordWithCategory, type Person, type Place, type RateUnit, type WorkCategory } from '@/lib/types';
import { applyRounding, defaultQuantityFor, type DefaultItemProposal } from '@/lib/workCalc';
import { colors, fonts, radii, MIN_TOUCH, fs } from '@/theme';

export type WorkItemSheetMode =
  | { kind: 'add'; suggestedHours: number | null; proposals: DefaultItemProposal[] }
  | { kind: 'edit'; record: DayWorkRecordWithCategory };

export interface ItemAssignment {
  placeId: number | null; // null = podle mých pobytů
  workerId: number;
  orderId: number | null; // null = automaticky podle místa, -1 = bez zakázky
  timeFrom: string | null; // HH:MM
  timeTo: string | null;
}

interface WorkItemSheetProps {
  mode: WorkItemSheetMode | null; // null = zavřeno
  categories: WorkCategory[]; // nabídka (bez smazaných)
  categoryById: Map<number, WorkCategory>; // i smazané (úprava starých položek)
  settings: AppSettings;
  // sazba a příplatek tohohle dne pro stroj/práci a pracovníka
  priceFor: (category: WorkCategory, unit: RateUnit, workerId: number) => { rateKc: number; surchargePct: number };
  onClose: () => void;
  onAdd: (category: WorkCategory, unit: RateUnit, quantity: number, assignment: ItemAssignment) => void;
  onAddDefaults: (proposals: DefaultItemProposal[]) => void;
  onSave: (record: DayWorkRecordWithCategory, unit: RateUnit, quantity: number, assignment: ItemAssignment) => void;
  orders?: OrderOption[]; // ruční přeřazení zakázky (etapa 5)
  onDelete: (record: DayWorkRecordWithCategory) => void;
  places: Place[];
  dayPlaceIds: number[]; // místa mých dnešních pracovních pobytů
  people: Person[];
  onPlaceCreated: (place: Place) => void;
  onPeopleChanged: () => void;
}

const UNITS: RateUnit[] = ['hour', 'day', 'km'];
const UNIT_BUTTON_LABEL: Record<RateUnit, string> = { hour: 'Hodiny', day: 'Dny', km: 'Km' };
const KM_STEP = 10;

const parseHHMM = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

export default function WorkItemSheet({
  mode,
  categories,
  categoryById,
  settings,
  priceFor,
  onClose,
  onAdd,
  onAddDefaults,
  onSave,
  onDelete,
  orders = [],
  places,
  dayPlaceIds,
  people,
  onPlaceCreated,
  onPeopleChanged,
}: WorkItemSheetProps) {
  const [orderId, setOrderId] = useState<number | null>(null);
  const [category, setCategory] = useState<WorkCategory | null>(null);
  const [unit, setUnit] = useState<RateUnit>('hour');
  const [quantity, setQuantity] = useState(0);
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [workerId, setWorkerId] = useState<number>(ME_ID);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [pickingPlace, setPickingPlace] = useState(false);

  // Při každém otevření začít od začátku (úprava = rovnou číselník).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPickingPlace(false);
    if (mode?.kind === 'edit') {
      setCategory(categoryById.get(mode.record.categoryId) ?? null);
      setUnit(mode.record.unit);
      setQuantity(mode.record.quantity);
      setOrderId(mode.record.orderId);
      setPlaceId(mode.record.placeId);
      setWorkerId(mode.record.workerId);
      setTimeFrom(mode.record.timeFrom ?? '');
      setTimeTo(mode.record.timeTo ?? '');
    } else if (mode?.kind === 'add') {
      setCategory(null);
      setOrderId(null);
      // Výchozí místo = můj jediný pracovní pobyt dne, jinak "podle pobytů".
      setPlaceId(dayPlaceIds.length === 1 ? dayPlaceIds[0] : null);
      setWorkerId(ME_ID);
      setTimeFrom('');
      setTimeTo('');
    }
  }, [mode, categoryById, dayPlaceIds]);

  const initialQuantity = (u: RateUnit): number => {
    if (mode?.kind === 'add' && u === 'hour' && mode.suggestedHours !== null && workerId === ME_ID) return mode.suggestedHours;
    return defaultQuantityFor(u, settings);
  };

  const pickCategory = (c: WorkCategory) => {
    setCategory(c);
    setUnit(c.defaultUnit);
    setQuantity(initialQuantity(c.defaultUnit));
  };

  const switchUnit = (u: RateUnit) => {
    if (u === unit) return;
    setUnit(u);
    // Při přidávání se množství přepne na výchozí pro novou jednotku;
    // při úpravě zůstane číslo, jak je (uživatel ho jen přepočítá).
    if (mode?.kind === 'add') setQuantity(initialQuantity(u));
  };

  // Čas od-do u hodin -> množství (zaokrouhlené podle nastavení).
  const applyTimes = (from: string, to: string) => {
    const a = parseHHMM(from);
    const b = parseHHMM(to);
    if (a !== null && b !== null && b > a && unit === 'hour') setQuantity(applyRounding((b - a) / 60, settings));
  };

  const assignment = (): ItemAssignment => ({
    placeId,
    workerId,
    orderId,
    timeFrom: parseHHMM(timeFrom) !== null ? timeFrom.trim() : null,
    timeTo: parseHHMM(timeTo) !== null ? timeTo.trim() : null,
  });

  const addWorker = () =>
    Alert.prompt?.('Nový pracovník', 'Jméno (sazbu a fakturaci nastavíš v Nastavení → Pracovníci)', async (name) => {
      if (!name?.trim()) return;
      const id = await savePerson({ name: name.trim(), rateHourKc: null, rateDayKc: null, billable: true });
      onPeopleChanged();
      setWorkerId(id);
    });

  const step = unit === 'hour' ? settings.numpadStepHours : unit === 'day' ? 0.5 : KM_STEP;
  const price = category ? priceFor(category, unit, workerId) : { rateKc: 0, surchargePct: 0 };
  const worker = people.find((p) => p.id === workerId);
  const place = places.find((p) => p.id === placeId);

  const renderAssignment = (locked: boolean) => (
    <>
      <Text style={styles.label}>MÍSTO</Text>
      <TouchableOpacity style={styles.selector} onPress={() => setPickingPlace(true)}>
        <Text style={styles.selectorText} numberOfLines={1}>
          {place ? place.name : 'Podle mých pobytů'}
        </Text>
        <Text style={styles.selectorChevron}>›</Text>
      </TouchableOpacity>

      <Text style={styles.label}>PRACOVNÍK</Text>
      <View style={styles.chips}>
        {people.map((p) => (
          <TouchableOpacity key={p.id} style={[styles.chip, workerId === p.id && styles.chipOn]} onPress={() => setWorkerId(p.id)}>
            <Text style={[styles.chipText, workerId === p.id && styles.chipTextOn]}>{p.isMe ? 'Já' : p.name}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.chip} onPress={addWorker}>
          <Text style={styles.chipText}>+ Pracovník</Text>
        </TouchableOpacity>
      </View>
      {worker && !worker.billable && <Text style={styles.hint}>{worker.name}: jen evidence hodin, 0 Kč.</Text>}

      <OrderPicker orders={orders} value={orderId} onChange={setOrderId} locked={locked} />

      <Text style={styles.label}>ČAS (VOLITELNĚ)</Text>
      <View style={styles.timeRow}>
        <TextInput
          style={styles.timeInput}
          value={timeFrom}
          onChangeText={(t) => {
            setTimeFrom(t);
            applyTimes(t, timeTo);
          }}
          placeholder="od 7:00"
          placeholderTextColor={colors.textMuted}
          keyboardType="numbers-and-punctuation"
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <Text style={styles.timeDash}>–</Text>
        <TextInput
          style={styles.timeInput}
          value={timeTo}
          onChangeText={(t) => {
            setTimeTo(t);
            applyTimes(timeFrom, t);
          }}
          placeholder="do 15:30"
          placeholderTextColor={colors.textMuted}
          keyboardType="numbers-and-punctuation"
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
      </View>
    </>
  );

  const renderQuantityStep = (c: WorkCategory) => (
    <>
      <View style={styles.selectedRow}>
        <View style={[styles.colorSwatch, { backgroundColor: c.color }]} />
        <Text style={styles.selectedName}>{c.name}</Text>
        {price.surchargePct > 0 && <Text style={styles.surcharge}>+{price.surchargePct} %</Text>}
      </View>

      <View style={styles.unitRow}>
        {UNITS.map((u) => {
          const rate = priceFor(c, u, workerId).rateKc;
          return (
            <TouchableOpacity key={u} style={[styles.unitButton, unit === u && styles.unitButtonActive]} onPress={() => switchUnit(u)}>
              <Text style={[styles.unitButtonText, unit === u && styles.unitButtonTextActive]}>{UNIT_BUTTON_LABEL[u]}</Text>
              <Text style={[styles.unitRate, unit === u && styles.unitButtonTextActive]}>
                {rate > 0 ? `${formatKc(rate)}/${UNIT_RATE_LABEL[u].split('/')[1]}` : 'bez sazby'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.numPadRow}>
        <NumPad
          value={quantity}
          step={step}
          unitLabel={unit === 'hour' ? 'h' : unit === 'day' ? 'dní' : 'km'}
          onChange={setQuantity}
          roundTypedValue={unit === 'hour' ? (v) => applyRounding(v, settings) : undefined}
        />
      </View>
      <Text style={styles.amount}>
        {formatQuantity(quantity, unit)} × {formatKc(price.rateKc)}
        {price.surchargePct > 0 ? ` +${price.surchargePct} %` : ''} = {formatKc(quantity * price.rateKc * (1 + price.surchargePct / 100))}
      </Text>
    </>
  );

  let content = null;
  if (pickingPlace && mode) {
    content = (
      <ScrollView keyboardShouldPersistTaps="handled">
        <PlacePicker
          places={places}
          dayPlaceIds={dayPlaceIds}
          value={placeId}
          onSelect={(id) => {
            setPlaceId(id);
            setPickingPlace(false);
          }}
          onCreated={(p) => {
            onPlaceCreated(p);
            setPlaceId(p.id);
            setPickingPlace(false);
          }}
          onBack={() => setPickingPlace(false)}
        />
      </ScrollView>
    );
  } else if (mode?.kind === 'edit') {
    const record = mode.record;
    const locked = record.invoiceBatchId !== null;
    content = (
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>UPRAVIT POLOŽKU</Text>
        {category ? renderQuantityStep(category) : <Text style={styles.empty}>Stroj nebo práce už neexistuje.</Text>}
        {record.surchargePct !== price.surchargePct && record.surchargePct > 0 && (
          <Text style={styles.hint}>Uložený příplatek této položky: +{record.surchargePct} %.</Text>
        )}
        {locked && <Text style={styles.hint}>Vyfakturováno - sazba se nemění.</Text>}
        {renderAssignment(locked)}
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onDelete(record)}>
            <Text style={styles.deleteText}>Smazat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={() => onSave(record, unit, quantity, assignment())}>
            <Text style={styles.primaryButtonText}>ULOŽIT</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  } else if (mode?.kind === 'add' && category) {
    content = (
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>PŘIDAT POLOŽKU</Text>
        {renderQuantityStep(category)}
        {renderAssignment(false)}
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setCategory(null)}>
            <Text style={styles.secondaryButtonText}>‹ Zpět</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={() => onAdd(category, unit, quantity, assignment())}>
            <Text style={styles.primaryButtonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  } else if (mode?.kind === 'add') {
    content = (
      <>
        <Text style={styles.title}>PŘIDAT POLOŽKU</Text>
        {mode.suggestedHours !== null && (
          <Text style={styles.hint}>Navrženo {formatQuantity(mode.suggestedHours, 'hour')} z pobytů - vyber stroj nebo práci.</Text>
        )}
        {mode.proposals.length > 0 && mode.suggestedHours === null && (
          <View style={styles.proposalBox}>
            <Text style={styles.proposalLabel}>VÝCHOZÍ POLOŽKY</Text>
            <Text style={styles.proposalItems}>
              {mode.proposals.map((p) => `${p.category.name} ${formatQuantity(p.quantity, p.unit)}`).join(' · ')}
            </Text>
            <TouchableOpacity style={styles.proposalButton} onPress={() => onAddDefaults(mode.proposals)}>
              <Text style={styles.primaryButtonText}>POUŽÍT VÝCHOZÍ</Text>
            </TouchableOpacity>
          </View>
        )}
        <FlatList
          data={categories}
          keyExtractor={(c) => String(c.id)}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.pickerRow} onPress={() => pickCategory(item)}>
              <View style={[styles.colorSwatch, { backgroundColor: item.color }]} />
              <Text style={styles.pickerRowName}>{item.name}</Text>
              <Text style={styles.pickerRowRate}>
                {formatKc(item.rates[item.defaultUnit])} / {UNIT_RATE_LABEL[item.defaultUnit].split('/')[1]}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Žádné stroje ani práce - přidej je v Nastavení.</Text>}
        />
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.secondaryButtonText}>Zavřít</Text>
        </TouchableOpacity>
      </>
    );
  }

  return (
    <BottomSheetModal visible={mode !== null} onClose={onClose}>
      {content}
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1, marginBottom: 12 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 6, marginBottom: 6 },
  empty: { color: colors.textMuted, textAlign: 'center', fontFamily: fonts.body, marginVertical: 16 },
  list: { flexGrow: 0 },
  colorSwatch: { width: 14, height: 14, borderRadius: 3 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: MIN_TOUCH,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerRowName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15), flex: 1 },
  pickerRowRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  proposalBox: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 12,
  },
  proposalLabel: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(11), letterSpacing: 1 },
  proposalItems: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14), marginTop: 4, marginBottom: 10 },
  proposalButton: {
    height: 40,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  selectedName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(17), flex: 1 },
  surcharge: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  unitRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  unitButton: {
    flex: 1,
    minHeight: MIN_TOUCH,
    paddingVertical: 8,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  unitButtonText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  unitButtonTextActive: { color: colors.onAccent },
  unitRate: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11), marginTop: 2 },
  numPadRow: { alignItems: 'center', marginBottom: 10 },
  amount: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), textAlign: 'center' },
  label: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(12), letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  selector: {
    minHeight: MIN_TOUCH,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14), flex: 1 },
  selectorChevron: { color: colors.textMuted, fontSize: fs(20), marginLeft: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  chipTextOn: { color: colors.onAccent },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeInput: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: fs(16),
  },
  timeDash: { color: colors.textMuted, fontSize: fs(16) },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  primaryButton: {
    flex: 1,
    height: MIN_TOUCH,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
  secondaryButton: { flex: 1, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  deleteText: { color: colors.danger, fontFamily: fonts.body, fontSize: fs(15) },
  closeButton: { height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
