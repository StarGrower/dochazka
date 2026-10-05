// Okno "Zapsat pobyt" (etapa 4.3) - podle grafické předlohy
// private/predloha-pripominka.html, obrazovka 3: karta pobytu, čipy
// strojů (naučený první, "+ Další"), hodnota s +/−, vysvětlení výpočtu,
// přepínač "<stroj> nabízet pro toto místo" (zamknout návrh), ULOŽIT a
// "Rozdělit na víc strojů". Rozměry/barvy z předlohy, písma a barvy přes
// theme.ts.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import BottomSheetModal from './BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from './KeyboardDoneAccessory';
import { formatNumberCs, UNIT_SHORT } from '@/lib/format';
import type { StayProposal } from '@/lib/stayProposal';
import type { AppSettings, RateUnit, WorkCategory } from '@/lib/types';
import { applyRounding } from '@/lib/workCalc';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

export interface StaySheetTarget {
  placeId: number;
  placeName: string;
  badge: string; // číslo pobytu v průběhu dne
  timeLabel: string; // "7:05–15:20 · 8 h 15 min"
  proposal: StayProposal;
}

export interface StayRow {
  categoryId: number;
  unit: RateUnit;
  quantity: number;
}

interface StaySheetProps {
  target: StaySheetTarget | null; // null = zavřeno
  categories: WorkCategory[]; // bez smazaných
  settings: AppSettings;
  onClose: () => void;
  onSave: (target: StaySheetTarget, rows: StayRow[], lockFirst: boolean) => void;
}

const MAX_CHIPS = 3;

export default function StaySheet({ target, categories, settings, onClose, onSave }: StaySheetProps) {
  const [rows, setRows] = useState<StayRow[]>([]);
  const [lock, setLock] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [split, setSplit] = useState(false);

  useEffect(() => {
    if (!target) return;
    const p = target.proposal;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows([{ categoryId: p.category.id, unit: p.unit, quantity: p.quantity }]);
    setLock(p.locked);
    setShowAll(false);
    setSplit(false);
  }, [target]);

  if (!target || rows.length === 0) return <BottomSheetModal visible={false} onClose={onClose}>{null}</BottomSheetModal>;

  const step = (unit: RateUnit) => (unit === 'hour' ? settings.numpadStepHours : unit === 'day' ? 0.5 : 10);
  const updateRow = (index: number, patch: Partial<StayRow>) =>
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const firstCategory = categories.find((c) => c.id === rows[0].categoryId);

  // Čipy: navržený stroj první, pak ostatní; bez "+ Další" jen první tři.
  const ordered = [
    ...categories.filter((c) => c.id === target.proposal.category.id),
    ...categories.filter((c) => c.id !== target.proposal.category.id),
  ];

  const renderChips = (index: number) => {
    const selectedId = rows[index].categoryId;
    const visible = showAll || split ? ordered : ordered.slice(0, MAX_CHIPS);
    return (
      <View style={styles.chips}>
        {visible.map((c) => {
          const on = c.id === selectedId;
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => updateRow(index, { categoryId: c.id, unit: c.id === target.proposal.category.id ? target.proposal.unit : 'hour' })}
            >
              <View style={[styles.swatch, { backgroundColor: on ? colors.background : c.color }]} />
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
        {!showAll && !split && ordered.length > MAX_CHIPS && (
          <TouchableOpacity style={styles.chip} onPress={() => setShowAll(true)}>
            <Text style={styles.chipText}>+ Další</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderValue = (index: number, big: boolean) => {
    const row = rows[index];
    const unitLabel = UNIT_SHORT[row.unit];
    return (
      <View style={styles.val}>
        <TouchableOpacity
          style={[styles.vb, !big && styles.vbSmall]}
          onPress={() => updateRow(index, { quantity: Math.max(0, Math.round((row.quantity - step(row.unit)) * 100) / 100) })}
          accessibilityLabel="Ubrat"
        >
          <Text style={styles.vbText}>−</Text>
        </TouchableOpacity>
        <ValueInput
          value={row.quantity}
          unitLabel={unitLabel}
          big={big}
          onChange={(v) => updateRow(index, { quantity: row.unit === 'hour' ? applyRounding(v, settings) : v })}
        />
        <TouchableOpacity
          style={[styles.vb, !big && styles.vbSmall]}
          onPress={() => updateRow(index, { quantity: Math.round((row.quantity + step(row.unit)) * 100) / 100 })}
          accessibilityLabel="Přidat"
        >
          <Text style={styles.vbText}>+</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <BottomSheetModal visible onClose={onClose} cardStyle={styles.sheet}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.grab} />
        <Text style={styles.title}>ZAPSAT POBYT</Text>

        <View style={styles.place}>
          <View style={styles.pin}>
            <Text style={styles.pinText}>{target.badge}</Text>
          </View>
          <View>
            <Text style={styles.placeName}>{target.placeName}</Text>
            <Text style={styles.placeTime}>{target.timeLabel}</Text>
          </View>
        </View>

        {!split ? (
          <>
            <Text style={styles.label}>STROJ / PRÁCE</Text>
            {renderChips(0)}
            {renderValue(0, true)}
            <Text style={styles.hint}>{target.proposal.explanation}</Text>
          </>
        ) : (
          rows.map((_, index) => (
            <View key={index} style={styles.splitRow}>
              <View style={styles.splitHeader}>
                <Text style={styles.label}>STROJ / PRÁCE {index + 1}</Text>
                {rows.length > 1 && (
                  <TouchableOpacity onPress={() => setRows((r) => r.filter((__, i) => i !== index))} hitSlop={10}>
                    <Text style={styles.remove}>Odebrat</Text>
                  </TouchableOpacity>
                )}
              </View>
              {renderChips(index)}
              {renderValue(index, false)}
            </View>
          ))
        )}

        {split && (
          <TouchableOpacity
            style={styles.bt2}
            onPress={() => {
              const used = new Set(rows.map((r) => r.categoryId));
              const next = ordered.find((c) => !used.has(c.id)) ?? ordered[0];
              setRows((r) => [...r, { categoryId: next.id, unit: 'hour', quantity: 0 }]);
            }}
          >
            <Text style={styles.bt2Text}>+ Přidat další stroj</Text>
          </TouchableOpacity>
        )}
        {split && (
          <Text style={styles.hint}>
            Celkem {formatNumberCs(rows.reduce((sum, r) => sum + (r.unit === 'hour' ? r.quantity : 0), 0))} h · pobyt{' '}
            {target.proposal.explanation}
          </Text>
        )}

        {firstCategory && (
          <View style={styles.toggleRow}>
            <Text style={styles.toggleText}>{firstCategory.name} nabízet pro toto místo</Text>
            <Switch
              value={lock}
              onValueChange={setLock}
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={lock ? colors.background : colors.text}
            />
          </View>
        )}

        <TouchableOpacity style={styles.bt} onPress={() => onSave(target, rows.filter((r) => r.quantity > 0), lock)}>
          <Text style={styles.btText}>ULOŽIT</Text>
        </TouchableOpacity>
        {!split && (
          <TouchableOpacity style={styles.bt2} onPress={() => setSplit(true)}>
            <Text style={styles.bt2Text}>Rozdělit na víc strojů</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </BottomSheetModal>
  );
}

// Velké číslo (Barlow Condensed 800, žlutě) - klepnutím jde přepsat.
function ValueInput({ value, unitLabel, big, onChange }: { value: number; unitLabel: string; big: boolean; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(formatNumberCs(value));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(formatNumberCs(value));
  }, [value]);
  const commit = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isNaN(parsed) || parsed < 0) setDraft(formatNumberCs(value));
    else onChange(parsed);
  };
  return (
    <View style={styles.vvWrap}>
      <TextInput
        style={[styles.vv, !big && styles.vvSmall]}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        keyboardType="decimal-pad"
        inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        selectTextOnFocus
      />
      <Text style={[styles.vv, !big && styles.vvSmall]}> {unitLabel}</Text>
    </View>
  );
}

// Rozměry podle předlohy (.sh, .plc, .chip, .vb, .vv, .bt, .bt2).
const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 10, paddingHorizontal: 16, paddingBottom: 26, maxHeight: '88%' },
  content: { gap: 14 },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#4A4942', alignSelf: 'center' },
  title: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(24), letterSpacing: 0.7 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.background, borderRadius: radii.card, paddingVertical: 10, paddingHorizontal: 12 },
  pin: { width: 26, height: 26, borderRadius: 4, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  pinText: { color: colors.onAccent, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  placeName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(16) },
  placeTime: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  label: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1.1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: MIN_TOUCH,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  chipTextOn: { color: colors.onAccent },
  val: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vb: {
    width: 56,
    height: 56,
    borderRadius: radii.card,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vbSmall: { width: MIN_TOUCH, height: MIN_TOUCH },
  vbText: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(30), marginTop: -2 },
  vvWrap: { flexDirection: 'row', alignItems: 'baseline' },
  vv: { color: colors.accent, fontFamily: 'BarlowCondensed_800ExtraBold', fontSize: fs(54), lineHeight: fs(58), padding: 0, textAlign: 'right', minWidth: 30 },
  vvSmall: { fontSize: fs(32), lineHeight: fs(36) },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), textAlign: 'center', marginTop: -6 },
  splitRow: { gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  splitHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  remove: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH },
  toggleText: { color: colors.text, fontFamily: fonts.body, fontSize: fs(15), flex: 1, marginRight: 12 },
  bt: { height: 54, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  btText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(20), letterSpacing: 1 },
  bt2: { height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  bt2Text: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
});
