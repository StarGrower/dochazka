// Přidání / úprava položky dne (oprava 2, D2 + C1 + B2) - jeden panel
// pro oba postupy:
// - PŘIDAT: nabídka strojů/prací -> výběr -> hned číselník s množstvím a
//   přepínačem jednotky (h / den / km) -> OK = uloženo. V prázdném dni
//   nahoře návrh výchozích položek (uloží se jen tlačítkem).
// - UPRAVIT: množství + jednotka + Smazat.
// Sazba se ukládá k položce v okamžiku zápisu (viz lib/workCalc.ts ->
// priceForRecord) - tenhle panel jen sbírá stroj, jednotku a množství.

import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import BottomSheetModal from './BottomSheetModal';
import NumPad from './NumPad';
import OrderPicker, { type OrderOption } from './OrderPicker';
import { formatKc, formatQuantity, UNIT_RATE_LABEL } from '@/lib/format';
import type { AppSettings, DayWorkRecordWithCategory, RateUnit, WorkCategory } from '@/lib/types';
import { applyRounding, defaultQuantityFor, type DefaultItemProposal } from '@/lib/workCalc';
import { colors, fonts, radii, MIN_TOUCH, fs } from '@/theme';

export type WorkItemSheetMode =
  | { kind: 'add'; suggestedHours: number | null; proposals: DefaultItemProposal[] }
  | { kind: 'edit'; record: DayWorkRecordWithCategory };

interface WorkItemSheetProps {
  mode: WorkItemSheetMode | null; // null = zavřeno
  categories: WorkCategory[]; // nabídka (bez smazaných)
  categoryById: Map<number, WorkCategory>; // i smazané (úprava starých položek)
  settings: AppSettings;
  surchargePctFor: (category: WorkCategory) => number; // příplatek tohohle dne
  onClose: () => void;
  onAdd: (category: WorkCategory, unit: RateUnit, quantity: number) => void;
  onAddDefaults: (proposals: DefaultItemProposal[]) => void;
  onSave: (record: DayWorkRecordWithCategory, unit: RateUnit, quantity: number, orderId: number | null) => void;
  orders?: OrderOption[]; // ruční přeřazení zakázky (etapa 5)
  onDelete: (record: DayWorkRecordWithCategory) => void;
}

const UNITS: RateUnit[] = ['hour', 'day', 'km'];
const UNIT_BUTTON_LABEL: Record<RateUnit, string> = { hour: 'Hodiny', day: 'Dny', km: 'Km' };
const KM_STEP = 10;

export default function WorkItemSheet({
  mode,
  categories,
  categoryById,
  settings,
  surchargePctFor,
  onClose,
  onAdd,
  onAddDefaults,
  onSave,
  onDelete,
  orders = [],
}: WorkItemSheetProps) {
  const [orderId, setOrderId] = useState<number | null>(null);
  const [category, setCategory] = useState<WorkCategory | null>(null);
  const [unit, setUnit] = useState<RateUnit>('hour');
  const [quantity, setQuantity] = useState(0);

  // Při každém otevření začít od začátku (úprava = rovnou číselník).
  useEffect(() => {
    if (mode?.kind === 'edit') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCategory(categoryById.get(mode.record.categoryId) ?? null);
      setUnit(mode.record.unit);
      setQuantity(mode.record.quantity);
      setOrderId(mode.record.orderId);
    } else {
      setCategory(null);
    }
  }, [mode, categoryById]);

  const initialQuantity = (u: RateUnit): number => {
    if (mode?.kind === 'add' && u === 'hour' && mode.suggestedHours !== null) return mode.suggestedHours;
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

  const step = unit === 'hour' ? settings.numpadStepHours : unit === 'day' ? 0.5 : KM_STEP;
  const surcharge = category ? surchargePctFor(category) : 0;

  const renderQuantityStep = (c: WorkCategory) => (
    <>
      <View style={styles.selectedRow}>
        <View style={[styles.colorSwatch, { backgroundColor: c.color }]} />
        <Text style={styles.selectedName}>{c.name}</Text>
        {surcharge > 0 && <Text style={styles.surcharge}>+{surcharge} %</Text>}
      </View>

      <View style={styles.unitRow}>
        {UNITS.map((u) => (
          <TouchableOpacity
            key={u}
            style={[styles.unitButton, unit === u && styles.unitButtonActive]}
            onPress={() => switchUnit(u)}
          >
            <Text style={[styles.unitButtonText, unit === u && styles.unitButtonTextActive]}>{UNIT_BUTTON_LABEL[u]}</Text>
            <Text style={[styles.unitRate, unit === u && styles.unitButtonTextActive]}>
              {c.rates[u] > 0 ? `${formatKc(c.rates[u])}/${UNIT_RATE_LABEL[u].split('/')[1]}` : 'bez sazby'}
            </Text>
          </TouchableOpacity>
        ))}
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
        {formatQuantity(quantity, unit)} × {formatKc(c.rates[unit])}
        {surcharge > 0 ? ` +${surcharge} %` : ''} = {formatKc(quantity * c.rates[unit] * (1 + surcharge / 100))}
      </Text>
    </>
  );

  let content = null;
  if (mode?.kind === 'edit') {
    const record = mode.record;
    content = (
      <>
        <Text style={styles.title}>UPRAVIT POLOŽKU</Text>
        {category ? renderQuantityStep(category) : <Text style={styles.empty}>Stroj nebo práce už neexistuje.</Text>}
        {record.surchargePct !== surcharge && record.surchargePct > 0 && (
          <Text style={styles.hint}>Uložený příplatek této položky: +{record.surchargePct} %.</Text>
        )}
        <OrderPicker orders={orders} value={orderId} onChange={setOrderId} locked={record.invoiceBatchId !== null} />
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => onDelete(record)}>
            <Text style={styles.deleteText}>Smazat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={() => onSave(record, unit, quantity, orderId)}>
            <Text style={styles.primaryButtonText}>ULOŽIT</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  } else if (mode?.kind === 'add' && category) {
    content = (
      <>
        <Text style={styles.title}>PŘIDAT POLOŽKU</Text>
        {renderQuantityStep(category)}
        <View style={styles.buttons}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setCategory(null)}>
            <Text style={styles.secondaryButtonText}>‹ Zpět</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={() => onAdd(category, unit, quantity)}>
            <Text style={styles.primaryButtonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </>
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
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 12 },
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
