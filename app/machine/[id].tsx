// Karta stroje (etapa 6): počitadlo (odhad z kotevních bodů + naučený
// poměr; zadat stav ručně / vyfotit s OCR), servisní plán se stavem
// (zbývá X Mth ≈ Y pracovních dní), servisní záznamy a kniha v PDF (bez
// cen), závady, tankování se spotřebou plná-plná a náklady.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import { formatKc, formatNumberCs, toIsoDate } from '@/lib/format';
import { parseCounterText, type ConsumptionSegment, type ServiceStatus } from '@/lib/machineCalc';
import {
  addDefect,
  addReading,
  addServiceRecord,
  COUNTER_LABEL,
  DEFECT_LABEL,
  deleteServiceItem,
  FUEL_LABEL,
  fuelCostOf,
  getMachine,
  itemStatus,
  listDefects,
  listFuelEntries,
  listReadings,
  listServiceItems,
  listServiceRecords,
  machineConsumption,
  machineCounter,
  resolveDefect,
  saveServiceItem,
  type CounterReading,
  type Defect,
  type DefectSeverity,
  type FuelEntry,
  type MachineCard,
  type MachineCounterInfo,
  type ServiceItem,
  type ServiceRecord,
} from '@/lib/machines';
import { takePhoto } from '@/lib/photos';
import { serviceBookHtml } from '@/lib/serviceBook';
import { sharePdfFromHtml } from '@/lib/shareFile';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

const SERVICE_COLOR = { ok: '#4CAF78', soon: colors.accent, overdue: colors.danger, unknown: colors.textMuted } as const;
const cz = (iso: string) => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;
const parseNum = (t: string) => {
  const v = Number(t.replace(/\s/g, '').replace(',', '.'));
  return t.trim() && Number.isFinite(v) ? v : null;
};

type ItemDraft = { id: number | null; name: string; value: string; days: string; warn1: string; warn2: string };

export default function MachineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const machineId = Number(id);
  const [machine, setMachine] = useState<MachineCard | null>(null);
  const [info, setInfo] = useState<MachineCounterInfo>({ estimate: null, usagePerDay: 0 });
  const [readings, setReadings] = useState<CounterReading[]>([]);
  const [plan, setPlan] = useState<{ item: ServiceItem; status: ServiceStatus }[]>([]);
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [fuel, setFuel] = useState<FuelEntry[]>([]);
  const [consumption, setConsumption] = useState<ConsumptionSegment[]>([]);
  const [busy, setBusy] = useState(false);

  const [readingOpen, setReadingOpen] = useState(false);
  const [readingValue, setReadingValue] = useState('');
  const [readingPhoto, setReadingPhoto] = useState<{ id: number; base64: string } | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [recordFor, setRecordFor] = useState<ServiceItem | 'free' | null>(null);
  const [record, setRecord] = useState({ counter: '', workDone: '', material: '', doneBy: '', note: '' });
  const [defectOpen, setDefectOpen] = useState(false);
  const [defect, setDefect] = useState<{ description: string; severity: DefectSeverity; photo: { id: number; base64: string } | null }>({
    description: '',
    severity: 'ok',
    photo: null,
  });
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    const m = await getMachine(machineId);
    setMachine(m);
    if (!m) return;
    const counterInfo = await machineCounter(m);
    setInfo(counterInfo);
    setReadings(await listReadings(m.id));
    setPlan((await listServiceItems(m.id)).map((item) => ({ item, status: itemStatus(item, counterInfo) })));
    setRecords(await listServiceRecords(m.id));
    setDefects(await listDefects(m.id, true));
    setFuel(await listFuelEntries(m.id));
    setConsumption(await machineConsumption(m));
  }, [machineId]);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!machine) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      </SafeAreaView>
    );
  }
  const unit = COUNTER_LABEL[machine.counterUnit];
  const est = info.estimate;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      Alert.alert('Nepovedlo se', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const photoCounter = () =>
    run(async () => {
      const photo = await takePhoto('camera', true);
      if (!photo) return;
      setReadingPhoto(photo);
      const value = parseCounterText(photo.lines);
      setReadingValue(value !== null ? formatNumberCs(value) : '');
      setReadingOpen(true);
    });

  const saveReading = async () => {
    const value = parseNum(readingValue);
    if (value === null) {
      Alert.alert('Chybí stav', `Zadej stav počitadla (${unit}).`);
      return;
    }
    await addReading(machine.id, { readAt: new Date().toISOString(), value, source: readingPhoto ? 'photo' : 'manual', photoId: readingPhoto?.id ?? null });
    setReadingOpen(false);
    setReadingValue('');
    setReadingPhoto(null);
    await load();
  };

  const openItem = (item: ServiceItem | null) =>
    setItemDraft(
      item
        ? {
            id: item.id,
            name: item.name,
            value: item.intervalValue ? String(item.intervalValue) : '',
            days: item.intervalDays ? String(item.intervalDays) : '',
            warn1: item.warnFirst !== null ? String(item.warnFirst) : '',
            warn2: item.warnSecond !== null ? String(item.warnSecond) : '',
          }
        : { id: null, name: '', value: '', days: '', warn1: machine.counterUnit === 'km' ? '1000' : '50', warn2: machine.counterUnit === 'km' ? '400' : '20' }
    );

  const saveItem = async () => {
    if (!itemDraft || !itemDraft.name.trim()) {
      Alert.alert('Chybí název', 'Zadej název servisní položky.');
      return;
    }
    const existing = plan.find((p) => p.item.id === itemDraft.id)?.item;
    await saveServiceItem({
      id: itemDraft.id,
      categoryId: machine.id,
      name: itemDraft.name.trim(),
      intervalValue: parseNum(itemDraft.value),
      intervalDays: parseNum(itemDraft.days),
      warnFirst: parseNum(itemDraft.warn1),
      warnSecond: parseNum(itemDraft.warn2),
      warnDaysFirst: existing?.warnDaysFirst ?? 30,
      warnDaysSecond: existing?.warnDaysSecond ?? 7,
      lastDoneValue: existing?.lastDoneValue ?? (est ? Math.round(est.value) : null),
      lastDoneDate: existing?.lastDoneDate ?? toIsoDate(new Date()),
    });
    setItemDraft(null);
    await load();
  };

  const openRecord = (item: ServiceItem | 'free') => {
    setRecord({ counter: est ? String(Math.round(est.value)) : '', workDone: item === 'free' ? '' : item.name, material: '', doneBy: '', note: '' });
    setRecordFor(item);
  };

  const saveRecord = async () => {
    if (!recordFor) return;
    await addServiceRecord(machine.id, {
      serviceItemId: recordFor === 'free' ? null : recordFor.id,
      doneAt: new Date().toISOString(),
      counterValue: parseNum(record.counter),
      workDone: record.workDone.trim(),
      material: record.material.trim(),
      doneBy: record.doneBy.trim(),
      note: record.note.trim(),
    });
    setRecordFor(null);
    await load();
  };

  const saveDefect = async () => {
    if (!defect.description.trim()) {
      Alert.alert('Chybí popis', 'Popiš závadu.');
      return;
    }
    await addDefect(machine.id, { description: defect.description.trim(), severity: defect.severity, photoId: defect.photo?.id ?? null });
    setDefectOpen(false);
    setDefect({ description: '', severity: 'ok', photo: null });
    await load();
  };

  const avgConsumption = consumption.length ? consumption.reduce((s, c) => s + c.liters, 0) / consumption.reduce((s, c) => s + c.distance, 0) : null;
  const consumptionLabel = (perUnit: number) =>
    machine.counterUnit === 'km' ? `${formatNumberCs(Math.round(perUnit * 1000) / 10)} l/100 km` : `${formatNumberCs(Math.round(perUnit * 10) / 10)} l/Mth`;
  const year = new Date().getFullYear();
  const monthStart = new Date(year, new Date().getMonth(), 1).getTime();
  const fuelMonth = fuel.filter((e) => Date.parse(e.fueledAt) >= monthStart).reduce((s, e) => s + fuelCostOf(e), 0);
  const fuelYear = fuel.filter((e) => new Date(e.fueledAt).getFullYear() === year).reduce((s, e) => s + fuelCostOf(e), 0);
  const costPerUnit = avgConsumption !== null && fuel.length ? (fuel.reduce((s, e) => s + fuelCostOf(e), 0) / fuel.reduce((s, e) => s + e.liters, 0)) * avgConsumption : null;
  const maxSeg = Math.max(...consumption.map((c) => c.perUnit), 0.0001);
  const openDefects = defects.filter((d) => !d.resolvedAt);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.top}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text style={styles.h1}>{machine.name.toUpperCase()}</Text>
          <Text style={styles.sub}>{[machine.manufacturer, machine.model, machine.plate, machine.yearBuilt].filter(Boolean).join(' · ') || 'Doplň kartu stroje'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push(`/machine/edit?id=${machine.id}`)} hitSlop={8}>
          <Text style={styles.link}>Upravit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.sc}>
        {machine.counterUnit !== 'none' && (
          <View style={styles.hero}>
            <Text style={styles.hl}>STAV POČITADLA</Text>
            <Text style={styles.hv}>{est ? `≈ ${formatNumberCs(Math.round(est.value))} ${unit}` : `— ${unit}`}</Text>
            <Text style={styles.small}>
              {est
                ? `kotva ${formatNumberCs(est.lastAnchor.value)} ${unit} (${cz(toIsoDate(new Date(est.lastAnchor.atMs)))}) + ${formatNumberCs(Math.round(est.sinceAnchor * 10) / 10)} ${machine.counterUnit === 'km' ? 'km z přejezdů' : 'h práce'} × ${formatNumberCs(Math.round(est.ratio * 100) / 100)}`
                : 'Zadej stav počitadla (kotevní bod) - pak appka odhaduje sama ze zápisů.'}
            </Text>
            <View style={styles.row2}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => {
                  setReadingPhoto(null);
                  setReadingValue('');
                  setReadingOpen(true);
                }}
              >
                <Text style={styles.btnText}>Zadat stav</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={photoCounter} disabled={busy}>
                <Text style={styles.btnText}>Vyfotit počitadlo</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {openDefects.length > 0 && (
          <View style={[styles.alert, openDefects.some((d) => d.severity === 'stopped') && styles.alertDanger]}>
            <Text style={styles.alertText}>
              {openDefects.some((d) => d.severity === 'stopped') ? 'STROJ STOJÍ' : 'NEVYŘEŠENÉ ZÁVADY'}: {openDefects.map((d) => d.description).join(' · ')}
            </Text>
          </View>
        )}

        <View style={styles.sectionRow}>
          <Text style={styles.section}>SERVISNÍ PLÁN</Text>
          <TouchableOpacity onPress={() => openItem(null)} hitSlop={8}>
            <Text style={styles.link}>+ Položka</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.tb}>
          {plan.length === 0 && <Text style={styles.empty}>Žádné položky - přidej je, nebo zvol šablonu v Upravit.</Text>}
          {plan.map(({ item, status }, i) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.row, i === 0 && styles.rowFirst]}
              onPress={() =>
                Alert.alert(item.name, undefined, [
                  { text: 'Zrušit', style: 'cancel' },
                  { text: 'Provedeno (záznam)', onPress: () => openRecord(item) },
                  { text: 'Upravit položku', onPress: () => openItem(item) },
                  {
                    text: 'Smazat položku',
                    style: 'destructive',
                    onPress: async () => {
                      await deleteServiceItem(item.id);
                      await load();
                    },
                  },
                ])
              }
            >
              <View style={styles.rn}>
                <View style={[styles.dot, { backgroundColor: SERVICE_COLOR[status.level] }]} />
                <View style={styles.flex}>
                  <Text style={styles.rowText}>{item.name}</Text>
                  <Text style={styles.rq}>
                    {[item.intervalValue ? `à ${formatNumberCs(item.intervalValue)} ${unit}` : null, item.intervalDays ? `à ${item.intervalDays} dní` : null]
                      .filter(Boolean)
                      .join(' / ')}
                  </Text>
                </View>
              </View>
              <Text style={[styles.status, { color: SERVICE_COLOR[status.level] }]}>
                {status.level === 'overdue'
                  ? 'po termínu'
                  : status.remainingValue !== null && unit
                    ? `zbývá ${formatNumberCs(Math.round(status.remainingValue))} ${unit}${status.estimatedWorkdays !== null ? `\n≈ ${status.estimatedWorkdays} prac. dní` : ''}`
                    : status.remainingDays !== null
                      ? `za ${status.remainingDays} dní`
                      : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.section}>SERVISNÍ ZÁZNAMY</Text>
          <View style={styles.row2}>
            <TouchableOpacity onPress={() => openRecord('free')} hitSlop={8}>
              <Text style={styles.link}>+ Záznam</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => run(() => sharePdfFromHtml(serviceBookHtml(machine, est?.value ?? null, plan, records), `Servisni-kniha-${machine.name}`, 'Servisní kniha'))}
              hitSlop={8}
            >
              <Text style={styles.link}>PDF</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.tb}>
          {records.length === 0 && <Text style={styles.empty}>Zatím žádný servis.</Text>}
          {records.slice(0, 10).map((r, i) => (
            <View key={r.id} style={[styles.row, i === 0 && styles.rowFirst]}>
              <View style={styles.flex}>
                <Text style={styles.rowText}>{r.serviceItemName ?? r.workDone}</Text>
                <Text style={styles.rq}>{[r.workDone !== r.serviceItemName ? r.workDone : '', r.material, r.doneBy].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={styles.rq}>
                {cz(r.doneAt.slice(0, 10))}
                {r.counterValue !== null ? `\n${formatNumberCs(r.counterValue)} ${unit}` : ''}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.section}>ZÁVADY</Text>
          <View style={styles.row2}>
            <TouchableOpacity onPress={() => setShowResolved((v) => !v)} hitSlop={8}>
              <Text style={styles.linkMuted}>{showResolved ? 'Jen otevřené' : 'I vyřešené'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDefectOpen(true)} hitSlop={8}>
              <Text style={styles.link}>+ Nahlásit</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.tb}>
          {(showResolved ? defects : openDefects).length === 0 && <Text style={styles.empty}>Bez závad.</Text>}
          {(showResolved ? defects : openDefects).map((d, i) => (
            <TouchableOpacity
              key={d.id}
              style={[styles.row, i === 0 && styles.rowFirst]}
              disabled={!!d.resolvedAt}
              onPress={() =>
                Alert.prompt?.('Vyřešeno', 'Poznámka k opravě (volitelné)', async (note) => {
                  await resolveDefect(d.id, note ?? '');
                  await load();
                }) ?? resolveDefect(d.id, '').then(load)
              }
            >
              <View style={styles.flex}>
                <Text style={[styles.rowText, d.resolvedAt && styles.resolved]}>{d.description}</Text>
                <Text style={styles.rq}>
                  {DEFECT_LABEL[d.severity]} · {cz(toIsoDate(new Date(d.createdAt)))}
                  {d.resolvedAt ? ` · vyřešeno ${cz(toIsoDate(new Date(d.resolvedAt)))}${d.resolutionNote ? ` (${d.resolutionNote})` : ''}` : ' · klepni = vyřešeno'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.section}>TANKOVÁNÍ A SPOTŘEBA</Text>
          <TouchableOpacity onPress={() => router.push(`/fuel/edit?machineId=${machine.id}`)} hitSlop={8}>
            <Text style={styles.link}>+ Tankovat</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.tb}>
          <View style={[styles.row, styles.rowFirst]}>
            <Text style={styles.rowText}>Průměrná spotřeba</Text>
            <Text style={styles.rv}>{avgConsumption !== null ? consumptionLabel(avgConsumption) : '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowText}>Palivo tento měsíc / rok</Text>
            <Text style={styles.rv}>
              {formatKc(fuelMonth)} / {formatKc(fuelYear)}
            </Text>
          </View>
          {costPerUnit !== null && (
            <View style={styles.row}>
              <Text style={styles.rowText}>Náklady na palivo</Text>
              <Text style={styles.rv}>{machine.counterUnit === 'km' ? `${formatNumberCs(Math.round(costPerUnit * 100) / 100)} Kč/km` : `${formatKc(costPerUnit)}/Mth`}</Text>
            </View>
          )}
          {consumption.length > 0 && (
            <View style={styles.chart}>
              {consumption.slice(-12).map((c) => (
                <View key={c.toMs} style={styles.chartCol}>
                  <View style={[styles.chartBar, { height: Math.max(4, (c.perUnit / maxSeg) * 70) }, c.jump && styles.chartJump]} />
                  <Text style={styles.chartLabel}>
                    {new Date(c.toMs).getDate()}.{new Date(c.toMs).getMonth() + 1}.
                  </Text>
                </View>
              ))}
            </View>
          )}
          {consumption.some((c) => c.jump) && (
            <Text style={styles.jumpText}>
              Skok spotřeby (+20 % proti průměru):{' '}
              {consumption
                .filter((c) => c.jump)
                .map((c) => `${cz(toIsoDate(new Date(c.toMs)))} ${consumptionLabel(c.perUnit)}`)
                .join(', ')}
            </Text>
          )}
          {fuel.slice(0, 8).map((e) => (
            <View key={e.id} style={styles.row}>
              <Text style={styles.rowText}>
                {cz(toIsoDate(new Date(e.fueledAt)))} · {formatNumberCs(e.liters)} l {FUEL_LABEL[e.fuelType]}
                {e.fullTank ? ' · plná' : ''}
              </Text>
              <Text style={styles.rv}>{formatKc(fuelCostOf(e))}</Text>
            </View>
          ))}
        </View>

        {readings.length > 0 && (
          <>
            <Text style={styles.section}>KOTEVNÍ BODY POČITADLA</Text>
            <View style={styles.tb}>
              {readings.slice(0, 8).map((r, i) => (
                <View key={r.id} style={[styles.row, i === 0 && styles.rowFirst]}>
                  <Text style={styles.rowText}>{cz(toIsoDate(new Date(r.readAt)))}</Text>
                  <Text style={styles.rq}>{{ manual: 'ručně', photo: 'z fotky', fuel: 'při tankování' }[r.source]}</Text>
                  <Text style={styles.rv}>
                    {formatNumberCs(r.value)} {unit}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <BottomSheetModal
        visible={readingOpen}
        onClose={() => setReadingOpen(false)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.footerCancel} onPress={() => setReadingOpen(false)}>
              <Text style={styles.footerCancelText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerCta} onPress={saveReading}>
              <Text style={styles.ctaText}>ULOŽIT STAV</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.modalTitle}>STAV POČITADLA</Text>
        {readingPhoto && <Image source={{ uri: `data:image/jpeg;base64,${readingPhoto.base64}` }} style={styles.photo} resizeMode="contain" />}
        <Text style={styles.hint}>{readingPhoto ? 'Rozpoznaný stav - zkontroluj a případně oprav.' : 'Stav z displeje stroje / tachometru.'}</Text>
        <TextInput
          style={styles.input}
          value={readingValue}
          onChangeText={setReadingValue}
          placeholder={`Stav (${unit})`}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
      </BottomSheetModal>

      <BottomSheetModal
        visible={itemDraft !== null}
        onClose={() => setItemDraft(null)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.footerCancel} onPress={() => setItemDraft(null)}>
              <Text style={styles.footerCancelText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerCta} onPress={saveItem}>
              <Text style={styles.ctaText}>ULOŽIT</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.modalTitle}>SERVISNÍ POLOŽKA</Text>
        {itemDraft && (
          <>
            <TextInput
              style={styles.input}
              value={itemDraft.name}
              onChangeText={(t) => setItemDraft((d) => (d ? { ...d, name: t } : d))}
              placeholder="Název (např. Motorový olej)"
              placeholderTextColor={colors.textMuted}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
            {machine.counterUnit !== 'none' && (
              <TextInput
                style={styles.input}
                value={itemDraft.value}
                onChangeText={(t) => setItemDraft((d) => (d ? { ...d, value: t } : d))}
                placeholder={`Interval v ${unit} (prázdné = jen čas)`}
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
              />
            )}
            <TextInput
              style={styles.input}
              value={itemDraft.days}
              onChangeText={(t) => setItemDraft((d) => (d ? { ...d, days: t } : d))}
              placeholder="Interval ve dnech (prázdné = jen počitadlo)"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
            {machine.counterUnit !== 'none' && (
              <View style={styles.row2}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={itemDraft.warn1}
                  onChangeText={(t) => setItemDraft((d) => (d ? { ...d, warn1: t } : d))}
                  placeholder={`1. upozornění ${unit} předem`}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                />
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={itemDraft.warn2}
                  onChangeText={(t) => setItemDraft((d) => (d ? { ...d, warn2: t } : d))}
                  placeholder={`2. upozornění ${unit} předem`}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                />
              </View>
            )}
            <Text style={styles.hint}>Upozornění u data: 30 a 7 dní předem. Platí co nastane dřív.</Text>
          </>
        )}
      </BottomSheetModal>

      <BottomSheetModal
        visible={recordFor !== null}
        onClose={() => setRecordFor(null)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.footerCancel} onPress={() => setRecordFor(null)}>
              <Text style={styles.footerCancelText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerCta} onPress={saveRecord}>
              <Text style={styles.ctaText}>ULOŽIT ZÁZNAM</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <>
          <Text style={styles.modalTitle}>SERVISNÍ ZÁZNAM</Text>
          <Text style={styles.hint}>Uložením se interval položky vynuluje. Ceny se nezapisují.</Text>
          {machine.counterUnit !== 'none' && (
            <TextInput
              style={styles.input}
              value={record.counter}
              onChangeText={(t) => setRecord((r) => ({ ...r, counter: t }))}
              placeholder={`Stav ${unit}`}
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          )}
          <TextInput
            style={styles.input}
            value={record.workDone}
            onChangeText={(t) => setRecord((r) => ({ ...r, workDone: t }))}
            placeholder="Co se dělalo"
            placeholderTextColor={colors.textMuted}
            inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
          />
          <TextInput
            style={styles.input}
            value={record.material}
            onChangeText={(t) => setRecord((r) => ({ ...r, material: t }))}
            placeholder="Materiál (olej 15W-40 12 l, filtr...)"
            placeholderTextColor={colors.textMuted}
            inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
          />
          <TextInput
            style={styles.input}
            value={record.doneBy}
            onChangeText={(t) => setRecord((r) => ({ ...r, doneBy: t }))}
            placeholder="Kdo (já, servis XY)"
            placeholderTextColor={colors.textMuted}
            inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
          />
        </>
      </BottomSheetModal>

      <BottomSheetModal
        visible={defectOpen}
        onClose={() => setDefectOpen(false)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.footerCancel} onPress={() => setDefectOpen(false)}>
              <Text style={styles.footerCancelText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerCta} onPress={saveDefect}>
              <Text style={styles.ctaText}>ULOŽIT ZÁVADU</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.modalTitle}>NAHLÁSIT ZÁVADU</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={defect.description}
          onChangeText={(t) => setDefect((d) => ({ ...d, description: t }))}
          placeholder="Popis závady"
          placeholderTextColor={colors.textMuted}
          multiline
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <View style={styles.chips}>
          {(Object.keys(DEFECT_LABEL) as DefectSeverity[]).map((sv) => (
            <TouchableOpacity
              key={sv}
              style={[styles.chip, defect.severity === sv && (sv === 'stopped' ? styles.chipDanger : styles.chipOn)]}
              onPress={() => setDefect((d) => ({ ...d, severity: sv }))}
            >
              <Text style={[styles.chipText, defect.severity === sv && styles.chipTextOn]}>{DEFECT_LABEL[sv]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {defect.photo ? (
          <Image source={{ uri: `data:image/jpeg;base64,${defect.photo.base64}` }} style={styles.photo} resizeMode="contain" />
        ) : (
          <TouchableOpacity
            style={styles.btn}
            onPress={() =>
              run(async () => {
                const p = await takePhoto('camera', false);
                if (p) setDefect((d) => ({ ...d, photo: p }));
              })
            }
          >
            <Text style={styles.btnText}>Vyfotit závadu</Text>
          </TouchableOpacity>
        )}
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { marginTop: 40 },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 22, paddingHorizontal: 16, paddingBottom: 12 },
  back: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  backText: { color: colors.text, fontSize: fs(28), fontFamily: fonts.body, marginTop: -2 },
  titleBlock: { flex: 1 },
  h1: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(28), letterSpacing: 0.84, lineHeight: fs(30) },
  sub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginTop: 2 },
  sc: { paddingHorizontal: 16, gap: 12, paddingBottom: 32 },
  hero: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  hl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), letterSpacing: 0.72 },
  hv: { color: colors.accent, fontFamily: 'BarlowCondensed_800ExtraBold', fontSize: fs(40), lineHeight: fs(42) },
  small: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  row2: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btn: {
    flex: 1,
    minHeight: MIN_TOUCH,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginTop: 6,
  },
  btnText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  alert: { borderRadius: radii.card, padding: 12, backgroundColor: colors.accent },
  alertDanger: { backgroundColor: colors.danger },
  alertText: { color: colors.onAccent, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  section: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(14), letterSpacing: 1.1 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13), marginLeft: 12 },
  linkMuted: { color: colors.textMuted, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  tb: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 2, paddingHorizontal: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40, borderTopWidth: 1, borderTopColor: colors.border, gap: 8, paddingVertical: 4 },
  rowFirst: { borderTopWidth: 0 },
  rn: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  rowText: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14) },
  rq: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), textAlign: 'right' },
  rv: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16) },
  status: { fontFamily: fonts.bodySemiBold, fontSize: fs(12), textAlign: 'right' },
  resolved: { color: colors.textMuted, textDecorationLine: 'line-through' },
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), paddingVertical: 10 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 96, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  chartBar: { width: '70%', backgroundColor: colors.accent, borderRadius: 2 },
  chartJump: { backgroundColor: colors.danger },
  chartLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(9), marginTop: 2 },
  jumpText: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(12), paddingVertical: 6 },
  modalTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1, marginBottom: 8 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    minHeight: 48,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: fs(16),
    backgroundColor: colors.background,
    marginTop: 8,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top', paddingTop: 10 },
  photo: { width: '100%', height: 180, borderRadius: radii.card, marginVertical: 8, backgroundColor: colors.background },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  chipTextOn: { color: colors.onAccent },
  footerRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  footerCta: { flex: 1, height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  footerCancel: { height: 52, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  footerCancelText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  cta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18), letterSpacing: 0.9 },
});
