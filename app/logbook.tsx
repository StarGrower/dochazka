// Kniha jízd (etapa 7): všechny jízdy z přejezdů bez omezení, hledání a
// filtry (období, vozidlo, řidič, služební/soukromé), souhrn km a
// náhrady, návrhy účelu / soukromé / vozidla (jen návrhy - potvrzuje
// uživatel), tachometr = pravda (korekce, "nezaznamenáno", upozornění),
// uzavření měsíce a export PDF / Excel.

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import ToggleRow from '@/components/ToggleRow';
import { getSettings, updateSettings } from '@/lib/db';
import { formatKc, formatNumberCs, monthLabel, toIsoDate } from '@/lib/format';
import { resolveLocalities } from '@/lib/geocode';
import {
  addPerson,
  assignGap,
  closeMonth,
  listClosedMonths,
  listDrivers,
  listGaps,
  listLogbookTrips,
  odometerByTrip,
  reconcileAllOdometers,
  reopenMonth,
  saveLogbookTrip,
  type LogbookGap,
  type LogbookTrip,
  type OdoWarning,
} from '@/lib/logbook';
import { logbookSummary } from '@/lib/logbookCalc';
import { logbookHtml, logbookXlsx } from '@/lib/logbookReport';
import { listMachines, type MachineCard } from '@/lib/machines';
import { safeFileName, shareBytes, sharePdfFromHtml, XLSX_MIME } from '@/lib/shareFile';
import type { AppSettings, Person } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

type PeriodMode = 'month' | 'year' | 'all';
type Kind = 'all' | 'business' | 'private';
type Row = { type: 'trip'; trip: LogbookTrip; at: string } | { type: 'gap'; gap: LogbookGap; at: string };

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return `${['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'][d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;
};
const km1 = (n: number) => formatNumberCs(Math.round(n * 10) / 10);
const dateCs = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
};

export default function LogbookScreen() {
  const [trips, setTrips] = useState<LogbookTrip[] | null>(null);
  const [gaps, setGaps] = useState<LogbookGap[]>([]);
  const [warnings, setWarnings] = useState<OdoWarning[]>([]);
  const [odometer, setOdometer] = useState<Map<number, number | null>>(new Map());
  const [vehicles, setVehicles] = useState<MachineCard[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [closed, setClosed] = useState<{ vehicleId: number; month: string }[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [mode, setMode] = useState<PeriodMode>('month');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [vehicleFilter, setVehicleFilter] = useState<number | null>(null);
  const [driverFilter, setDriverFilter] = useState<number | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<LogbookTrip | null>(null);
  const [draft, setDraft] = useState({ purpose: '', isPrivate: false, vehicleId: null as number | null, driverId: 1, vehicleChanged: false });
  const [gapEditing, setGapEditing] = useState<LogbookGap | null>(null);
  const [gapDraft, setGapDraft] = useState({ driverId: null as number | null, note: '' });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOpts, setExportOpts] = useState({ includePrivate: false, onlyMine: false, allowance: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const first = await listLogbookTrips();
    const warn = await reconcileAllOdometers(first);
    const list = await listLogbookTrips(); // s korekcí tachometru
    const g = await listGaps();
    setTrips(list);
    setGaps(g);
    setWarnings(warn);
    setOdometer(await odometerByTrip(list, g));
    setVehicles((await listMachines()).filter((m) => m.counterUnit === 'km' || m.defaultUnit === 'km' || m.rates.km > 0));
    setPeople(await listDrivers());
    setClosed(await listClosedMonths());
    setSettings(await getSettings());
    // Obce neznámých míst (cache; nová místa se dohledají postupně).
    const missing = list.flatMap((t) => t.missingLocality).slice(-60);
    if (missing.length > 0) {
      const found = await resolveLocalities(missing).catch(() => new Map<string, string>());
      if (found.size > 0) setTrips(await listLogbookTrips());
    }
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const inPeriod = useCallback(
    (iso: string) => {
      const d = new Date(iso);
      if (mode === 'all') return true;
      if (mode === 'year') return d.getFullYear() === year;
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    },
    [mode, year, month]
  );

  const filtered = useMemo(() => {
    if (!trips) return [];
    const q = search.trim().toLowerCase();
    return trips.filter(
      (t) =>
        inPeriod(t.startAt) &&
        (vehicleFilter === null || t.vehicleId === vehicleFilter) &&
        (driverFilter === null || t.driverId === driverFilter) &&
        (kind === 'all' || (kind === 'private') === t.isPrivate) &&
        (!q || `${t.fromLabel} ${t.toLabel} ${t.purpose}`.toLowerCase().includes(q))
    );
  }, [trips, inPeriod, vehicleFilter, driverFilter, kind, search]);

  const filteredGaps = useMemo(
    () => (kind === 'private' || search.trim() ? [] : gaps.filter((g) => inPeriod(g.fromAt) && (vehicleFilter === null || g.vehicleId === vehicleFilter))),
    [gaps, inPeriod, vehicleFilter, kind, search]
  );

  const rows: Row[] = useMemo(
    () =>
      [
        ...filtered.map((trip): Row => ({ type: 'trip', trip, at: trip.startAt })),
        ...filteredGaps.map((gap): Row => ({ type: 'gap', gap, at: gap.fromAt })),
      ].sort((a, b) => b.at.localeCompare(a.at)),
    [filtered, filteredGaps]
  );

  const summary = logbookSummary(
    filtered.map((t) => ({ km: t.km, isPrivate: t.isPrivate })),
    settings?.logbookAllowanceKcPerKm ?? 0
  );
  const withSuggestion = filtered.filter((t) => t.suggestion !== null);
  const vehicleName = (id: number | null) => vehicles.find((v) => v.id === id)?.name ?? '—';
  const driverName = (id: number | null) => people.find((p) => p.id === id)?.name ?? '';
  const monthKey = `${year}-${pad(month)}`;
  const closeTargets = vehicleFilter !== null ? [vehicleFilter] : [...new Set(filtered.map((t) => t.vehicleId).filter((v): v is number => v !== null))];
  const monthClosed = closeTargets.length > 0 && closeTargets.every((v) => closed.some((c) => c.vehicleId === v && c.month === monthKey));
  const periodLabel = mode === 'all' ? 'Všechny jízdy' : mode === 'year' ? `Rok ${year}` : monthLabel(year, month);

  const stepMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const openTrip = (t: LogbookTrip) => {
    setDraft({
      purpose: t.purpose || t.suggestion?.purpose || '',
      isPrivate: t.suggestion?.isPrivate ?? t.isPrivate,
      vehicleId: t.suggestion?.vehicleId ?? t.vehicleId,
      driverId: t.driverId,
      vehicleChanged: false,
    });
    setEditing(t);
  };

  const acceptSuggestion = async (t: LogbookTrip) => {
    const s = t.suggestion;
    if (!s) return;
    await saveLogbookTrip(t, {
      purpose: t.purpose || s.purpose || '',
      isPrivate: s.isPrivate ?? t.isPrivate,
      vehicleId: s.vehicleId ?? t.vehicleId,
      vehicleSource: s.vehicleId !== null ? s.vehicleSource : (t.vehicleSource ?? 'default'),
      driverId: t.driverId,
    });
  };

  const acceptAll = () =>
    Alert.alert('Potvrdit návrhy', `Uložit navržený účel / druh / vozidlo u ${withSuggestion.length} jízd?`, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Potvrdit',
        onPress: async () => {
          for (const t of withSuggestion) await acceptSuggestion(t);
          await load();
        },
      },
    ]);

  const saveTrip = async () => {
    if (!editing) return;
    const suggestedVehicle = editing.suggestion?.vehicleId ?? null;
    const vehicleSource = draft.vehicleChanged
      ? 'manual'
      : suggestedVehicle !== null && draft.vehicleId === suggestedVehicle
        ? (editing.suggestion?.vehicleSource ?? 'learned')
        : (editing.vehicleSource ?? 'default');
    await saveLogbookTrip(editing, { purpose: draft.purpose.trim(), isPrivate: draft.isPrivate, vehicleId: draft.vehicleId, vehicleSource, driverId: draft.driverId });
    setEditing(null);
    await load();
  };

  const newDriver = (onCreated: (id: number) => void) =>
    Alert.prompt?.('Nový řidič', 'Jméno', async (name) => {
      if (!name?.trim()) return;
      const id = await addPerson(name.trim());
      setPeople(await listDrivers());
      onCreated(id);
    });

  const toggleMonth = () => {
    if (closeTargets.length === 0) return;
    const names = closeTargets.map(vehicleName).join(', ');
    if (monthClosed) {
      Alert.alert('Otevřít měsíc', `Otevřít ${monthLabel(year, month)} (${names}) pro úpravy?`, [
        { text: 'Zrušit', style: 'cancel' },
        {
          text: 'Otevřít',
          onPress: async () => {
            for (const v of closeTargets) await reopenMonth(v, monthKey);
            await load();
          },
        },
      ]);
      return;
    }
    const unconfirmed = filtered.filter((t) => !t.purpose && t.suggestion?.purpose).length;
    Alert.alert(
      'Uzavřít měsíc',
      `${monthLabel(year, month)} (${names}). Pozdější úpravy jízd se v exportu vyznačí.${unconfirmed ? `\n\n${unconfirmed} jízd má jen navržený účel.` : ''}`,
      [
        { text: 'Zrušit', style: 'cancel' },
        {
          text: 'Uzavřít',
          onPress: async () => {
            for (const v of closeTargets) await closeMonth(v, monthKey);
            await load();
          },
        },
      ]
    );
  };

  const openExport = () => {
    setExportOpts((o) => ({ ...o, allowance: settings?.logbookAllowanceKcPerKm ? formatNumberCs(settings.logbookAllowanceKcPerKm) : '' }));
    setExportOpen(true);
  };

  const doExport = async (format: 'pdf' | 'xlsx') => {
    if (!settings) return;
    setBusy(true);
    try {
      const allowance = Number(exportOpts.allowance.replace(/\s/g, '').replace(',', '.')) || 0;
      if (allowance !== settings.logbookAllowanceKcPerKm) await updateSettings({ logbookAllowanceKcPerKm: allowance });
      const me = people.find((p) => p.isMe)?.id ?? 1;
      const exportTrips = filtered.filter((t) => !exportOpts.onlyMine || t.driverId === me);
      const vehicleLabel = vehicleFilter !== null ? vehicleName(vehicleFilter) : 'všechna vozidla';
      const input = {
        title: `Kniha jízd · ${vehicleLabel} · ${periodLabel}`,
        periodLabel: `${periodLabel}${exportOpts.onlyMine ? ' · jen moje jízdy' : ''}${exportOpts.includePrivate ? '' : ' · bez rozpisu soukromých jízd'}`,
        vehicleLabel,
        trips: exportTrips,
        gaps: exportOpts.onlyMine ? [] : filteredGaps,
        odometer,
        includePrivate: exportOpts.includePrivate,
        people,
        vehicleNames: new Map(vehicles.map((v) => [v.id, v.name])),
        settings: { ...settings, logbookAllowanceKcPerKm: allowance },
      };
      const base = safeFileName(`Kniha-jizd-${vehicleLabel}-${mode === 'month' ? monthKey : mode === 'year' ? year : 'vse'}`);
      if (format === 'pdf') await sharePdfFromHtml(logbookHtml(input), base, 'Kniha jízd');
      else await shareBytes(logbookXlsx(input), `${base}.xlsx`, XLSX_MIME, 'Kniha jízd');
      setExportOpen(false);
      setSettings(await getSettings());
    } catch (err) {
      Alert.alert('Export se nepovedl', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const chip = (label: string, active: boolean, onPress: () => void, key?: string) => (
    <TouchableOpacity key={key ?? label} style={[styles.chip, active && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  const stepper = (label: string, onPrev: () => void, onNext: () => void) => (
    <>
      <TouchableOpacity style={styles.stepBtn} onPress={onPrev} hitSlop={6}>
        <Text style={styles.stepText}>‹</Text>
      </TouchableOpacity>
      <Text style={styles.period}>{label}</Text>
      <TouchableOpacity style={styles.stepBtn} onPress={onNext} hitSlop={6}>
        <Text style={styles.stepText}>›</Text>
      </TouchableOpacity>
    </>
  );

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.periodRow}>
        {mode === 'month'
          ? stepper(monthLabel(year, month).toUpperCase(), () => stepMonth(-1), () => stepMonth(1))
          : mode === 'year'
            ? stepper(`ROK ${year}`, () => setYear(year - 1), () => setYear(year + 1))
            : <Text style={styles.period}>VŠECHNY JÍZDY</Text>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {chip('Měsíc', mode === 'month', () => setMode('month'))}
        {chip('Rok', mode === 'year', () => setMode('year'))}
        {chip('Vše', mode === 'all', () => setMode('all'))}
        <View style={styles.sep} />
        {chip('Služební i soukromé', kind === 'all', () => setKind('all'))}
        {chip('Služební', kind === 'business', () => setKind('business'))}
        {chip('Soukromé', kind === 'private', () => setKind('private'))}
      </ScrollView>
      {(vehicles.length > 1 || people.length > 1) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {vehicles.length > 1 && chip('Všechna vozidla', vehicleFilter === null, () => setVehicleFilter(null))}
          {vehicles.length > 1 && vehicles.map((v) => chip(v.name, vehicleFilter === v.id, () => setVehicleFilter(v.id), `v${v.id}`))}
          {people.length > 1 && <View style={styles.sep} />}
          {people.length > 1 && chip('Všichni řidiči', driverFilter === null, () => setDriverFilter(null))}
          {people.length > 1 && people.map((p) => chip(p.name, driverFilter === p.id, () => setDriverFilter(p.id), `p${p.id}`))}
        </ScrollView>
      )}
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Hledat místo nebo účel"
        placeholderTextColor={colors.textMuted}
        clearButtonMode="while-editing"
        inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
      />

      <View style={styles.kpis}>
        <View style={styles.kpi}>
          <Text style={styles.kl}>SLUŽEBNÍ</Text>
          <Text style={styles.kv}>{km1(summary.businessKm)} km</Text>
          <Text style={styles.ks}>
            {summary.businessCount} jízd{summary.businessPct !== null ? ` · ${Math.round(summary.businessPct)} %` : ''}
          </Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kl}>SOUKROMÉ</Text>
          <Text style={styles.kv}>{km1(summary.privateKm)} km</Text>
          <Text style={styles.ks}>{summary.privateCount} jízd</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kl}>NÁHRADA</Text>
          <Text style={styles.kv}>{summary.allowanceKc !== null ? formatKc(summary.allowanceKc) : '—'}</Text>
          <Text style={styles.ks}>{settings?.logbookAllowanceKcPerKm ? `${formatNumberCs(settings.logbookAllowanceKcPerKm)} Kč/km` : 'sazbu zadáš v Exportu'}</Text>
        </View>
      </View>

      {warnings
        .filter((w) => inPeriod(w.toAt))
        .map((w) => (
          <View key={`${w.vehicleName}${w.fromAt}`} style={styles.warn}>
            <Text style={styles.warnText}>
              {w.vehicleName} {dateCs(w.fromAt)} – {dateCs(w.toAt)}: {w.text}
            </Text>
          </View>
        ))}

      <View style={styles.actions}>
        {withSuggestion.length > 0 && (
          <TouchableOpacity style={styles.btn} onPress={acceptAll}>
            <Text style={styles.btnText}>Potvrdit návrhy ({withSuggestion.length})</Text>
          </TouchableOpacity>
        )}
        {mode === 'month' && closeTargets.length > 0 && (
          <TouchableOpacity style={styles.btn} onPress={toggleMonth}>
            <Text style={styles.btnText}>{monthClosed ? 'Měsíc uzavřen · otevřít' : 'Uzavřít měsíc'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.btn} onPress={openExport}>
          <Text style={styles.btnText}>Export</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderRow = ({ item, index }: { item: Row; index: number }) => {
    const prev = rows[index - 1];
    const showDay = !prev || toIsoDate(new Date(prev.at)) !== toIsoDate(new Date(item.at));
    if (item.type === 'gap') {
      const g = item.gap;
      return (
        <View>
          {showDay && <Text style={styles.day}>{dayLabel(item.at)}</Text>}
          <TouchableOpacity
            style={[styles.row, styles.gapRow]}
            onPress={() => {
              setGapDraft({ driverId: g.driverId, note: g.note });
              setGapEditing(g);
            }}
          >
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{g.note || 'Jiný řidič / nezaznamenáno'}</Text>
              <Text style={styles.rowSub}>
                {dayLabel(g.fromAt)} {hm(g.fromAt)} – {dayLabel(g.toAt)} {hm(g.toAt)} · {vehicleName(g.vehicleId)}
                {g.driverId !== null ? ` · ${driverName(g.driverId)}` : ' · klepni = přiřadit'}
              </Text>
            </View>
            <Text style={styles.km}>{km1(g.km)} km</Text>
          </TouchableOpacity>
        </View>
      );
    }
    const t = item.trip;
    const odo = odometer.get(t.id);
    const info = [
      t.isPrivate ? 'soukromá' : null,
      vehicleName(t.vehicleId),
      people.length > 1 ? driverName(t.driverId) : null,
      odo !== null && odo !== undefined ? `tach. ${formatNumberCs(odo)}` : null,
      t.odoKm !== null && t.kmOverride === null ? 'upraveno podle tachometru' : null,
      t.editedAfterClose ? 'upraveno po uzavření' : null,
      t.suggestion?.vehicleId ? `návrh vozidla: ${vehicleName(t.suggestion.vehicleId)}${t.suggestion.vehicleSource === 'bluetooth' ? ' (Bluetooth)' : ''}` : null,
      t.suggestion && t.suggestion.isPrivate !== null ? `návrh: ${t.suggestion.isPrivate ? 'soukromá' : 'služební'}` : null,
    ];
    return (
      <View>
        {showDay && <Text style={styles.day}>{dayLabel(item.at)}</Text>}
        <TouchableOpacity style={[styles.row, t.isPrivate && styles.rowPrivate]} onPress={() => openTrip(t)}>
          <View style={styles.flex}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {hm(t.startAt)}–{hm(t.endAt)} · {t.fromLabel} → {t.toLabel}
            </Text>
            {t.purpose ? (
              <Text style={styles.rowSub} numberOfLines={1}>
                {t.purpose}
              </Text>
            ) : t.suggestion?.purpose ? (
              <Text style={styles.suggest} numberOfLines={1}>
                návrh: {t.suggestion.purpose}
              </Text>
            ) : (
              <Text style={styles.rowSubMuted}>bez účelu</Text>
            )}
            <Text style={styles.rowSub} numberOfLines={2}>
              {info.filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.km}>{km1(t.km)} km</Text>
            {t.suggestion && (
              <TouchableOpacity
                style={styles.accept}
                onPress={async () => {
                  await acceptSuggestion(t);
                  await load();
                }}
                hitSlop={6}
              >
                <Text style={styles.acceptText}>✓</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const purposeChips = editing
    ? [...new Set([editing.suggestion?.purpose, ...(trips ?? []).filter((t) => t.purpose).slice(-40).reverse().map((t) => t.purpose)].filter((p): p is string => !!p))].slice(0, 6)
    : [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="KNIHA JÍZD" onBack={() => router.back()} right={busy ? <ActivityIndicator color={colors.accent} /> : undefined} />
      {trips === null ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => (r.type === 'trip' ? `t${r.trip.id}` : `g${r.gap.id}`)}
          renderItem={renderRow}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={styles.empty}>V tomto výběru nejsou žádné jízdy.</Text>}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={25}
        />
      )}

      <BottomSheetModal
        visible={editing !== null}
        onClose={() => setEditing(null)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.footerSecondary} onPress={() => setEditing(null)}>
              <Text style={styles.footerSecondaryText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footerCta, styles.flex]} onPress={saveTrip}>
              <Text style={styles.ctaText}>ULOŽIT</Text>
            </TouchableOpacity>
          </View>
        }
      >
        {editing && (
          <>
            <Text style={styles.modalTitle}>JÍZDA</Text>
            <Text style={styles.modalSub}>
              {dayLabel(editing.startAt)} {hm(editing.startAt)}–{hm(editing.endAt)} · {editing.fromLabel} → {editing.toLabel}
            </Text>
            <Text style={styles.hint}>
              {km1(editing.km)} km
              {editing.odoKm !== null && editing.kmOverride === null ? ` (upraveno podle tachometru, GPS ${km1(editing.baseKm)} km)` : ''}
              {editing.kmOverride !== null ? ' (ručně)' : ''}
              {editing.closed ? ' · měsíc je uzavřený - úprava se vyznačí' : ''}
            </Text>
            <Text style={styles.label}>ÚČEL</Text>
            <TextInput
              style={styles.input}
              value={draft.purpose}
              onChangeText={(t) => setDraft((d) => ({ ...d, purpose: t }))}
              placeholder="Např. Stavba X - doprava materiálu"
              placeholderTextColor={colors.textMuted}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
            <View style={styles.chips}>{purposeChips.map((p) => chip(p, draft.purpose === p, () => setDraft((d) => ({ ...d, purpose: p })), `pp${p}`))}</View>
            {editing.suggestion && editing.suggestion.basedOn > 0 && (
              <Text style={styles.hint}>Návrh podle {editing.suggestion.basedOn} podobných jízd - uloží se až tlačítkem.</Text>
            )}
            <ToggleRow label="Soukromá jízda" description="Nepočítá se do služebních km" value={draft.isPrivate} onValueChange={(v) => setDraft((d) => ({ ...d, isPrivate: v }))} />
            <Text style={styles.label}>VOZIDLO</Text>
            <View style={styles.chips}>
              {vehicles.map((v) => chip(v.name, draft.vehicleId === v.id, () => setDraft((d) => ({ ...d, vehicleId: v.id, vehicleChanged: true })), `ev${v.id}`))}
            </View>
            <Text style={styles.label}>ŘIDIČ</Text>
            <View style={styles.chips}>
              {people.map((p) => chip(p.name, draft.driverId === p.id, () => setDraft((d) => ({ ...d, driverId: p.id })), `ed${p.id}`))}
              {chip('+ Řidič', false, () => newDriver((id) => setDraft((d) => ({ ...d, driverId: id }))))}
            </View>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => {
                const date = toIsoDate(new Date(editing.startAt));
                setEditing(null);
                router.push(`/day/${date}`);
              }}
            >
              <Text style={styles.link}>Otevřít den (km, trasa, smazání)</Text>
            </TouchableOpacity>
          </>
        )}
      </BottomSheetModal>

      <BottomSheetModal
        visible={gapEditing !== null}
        onClose={() => setGapEditing(null)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.footerSecondary} onPress={() => setGapEditing(null)}>
              <Text style={styles.footerSecondaryText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.footerCta, styles.flex]}
              onPress={async () => {
                if (!gapEditing) return;
                await assignGap(gapEditing.id, gapDraft.driverId, gapDraft.note.trim());
                setGapEditing(null);
                await load();
              }}
            >
              <Text style={styles.ctaText}>ULOŽIT</Text>
            </TouchableOpacity>
          </View>
        }
      >
        {gapEditing && (
          <>
            <Text style={styles.modalTitle}>JINÝ ŘIDIČ / NEZAZNAMENÁNO</Text>
            <Text style={styles.hint}>
              Tachometr ukazuje o {km1(gapEditing.km)} km víc než zaznamenané jízdy. Nejdelší okno, kdy jsi autem nejel: {dayLabel(gapEditing.fromAt)}{' '}
              {hm(gapEditing.fromAt)} – {dayLabel(gapEditing.toAt)} {hm(gapEditing.toAt)}.
            </Text>
            <Text style={styles.label}>ŘIDIČ</Text>
            <View style={styles.chips}>
              {chip('Nevím', gapDraft.driverId === null, () => setGapDraft((d) => ({ ...d, driverId: null })))}
              {people.map((p) => chip(p.name, gapDraft.driverId === p.id, () => setGapDraft((d) => ({ ...d, driverId: p.id })), `gd${p.id}`))}
              {chip('+ Řidič', false, () => newDriver((id) => setGapDraft((d) => ({ ...d, driverId: id }))))}
            </View>
            <TextInput
              style={styles.input}
              value={gapDraft.note}
              onChangeText={(t) => setGapDraft((d) => ({ ...d, note: t }))}
              placeholder="Poznámka (např. půjčil kolega)"
              placeholderTextColor={colors.textMuted}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          </>
        )}
      </BottomSheetModal>

      <BottomSheetModal
        visible={exportOpen}
        onClose={() => setExportOpen(false)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={[styles.footerCta, styles.flex]} onPress={() => doExport('pdf')} disabled={busy}>
              <Text style={styles.ctaText}>PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footerCta, styles.flex]} onPress={() => doExport('xlsx')} disabled={busy}>
              <Text style={styles.ctaText}>EXCEL</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.modalTitle}>EXPORT KNIHY JÍZD</Text>
        <Text style={styles.hint}>
          {periodLabel} · {vehicleFilter !== null ? vehicleName(vehicleFilter) : 'všechna vozidla'} · {filtered.length} jízd (podle filtrů)
        </Text>
        <ToggleRow
          label="Rozepsat soukromé jízdy"
          description="Vypnuto = v exportu jen souhrn soukromých km"
          value={exportOpts.includePrivate}
          onValueChange={(v) => setExportOpts((o) => ({ ...o, includePrivate: v }))}
        />
        {people.length > 1 && (
          <ToggleRow label="Jen moje jízdy" description="Bez jízd ostatních řidičů" value={exportOpts.onlyMine} onValueChange={(v) => setExportOpts((o) => ({ ...o, onlyMine: v }))} />
        )}
        <Text style={styles.label}>NÁHRADA ZA SLUŽEBNÍ KM (Kč/km, prázdné = nepočítat)</Text>
        <TextInput
          style={styles.input}
          value={exportOpts.allowance}
          onChangeText={(t) => setExportOpts((o) => ({ ...o, allowance: t }))}
          keyboardType="decimal-pad"
          placeholder="např. 5,80"
          placeholderTextColor={colors.textMuted}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />

      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { marginTop: 40 },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  headerBlock: { gap: 10, marginBottom: 6 },
  periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: fs(26), fontFamily: fonts.body },
  period: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(20), letterSpacing: 1, minWidth: 150, textAlign: 'center' },
  chipsRow: { gap: 8, alignItems: 'center' },
  sep: { width: 1, height: 24, backgroundColor: colors.border, marginHorizontal: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  chipTextOn: { color: colors.onAccent },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: MIN_TOUCH, color: colors.text, fontFamily: fonts.body, fontSize: fs(15), backgroundColor: colors.card },
  kpis: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 10, paddingHorizontal: 10 },
  kl: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11), letterSpacing: 0.66 },
  kv: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(20), marginTop: 2 },
  ks: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(11) },
  warn: { backgroundColor: colors.danger, borderRadius: radii.card, padding: 10 },
  warnText: { color: colors.onAccent, fontFamily: fonts.bodySemiBold, fontSize: fs(12) },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { flexGrow: 1, minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
  day: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(13), letterSpacing: 1, marginTop: 12, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6, minHeight: 56 },
  rowPrivate: { opacity: 0.7 },
  gapRow: { borderWidth: 1, borderColor: colors.accent, borderStyle: 'dashed' },
  rowTitle: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  rowSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 1 },
  rowSubMuted: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), fontStyle: 'italic', marginTop: 1 },
  suggest: { color: colors.accent, fontFamily: fonts.body, fontSize: fs(12), fontStyle: 'italic', marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 4 },
  km: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16) },
  accept: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18) },
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), paddingVertical: 20, textAlign: 'center' },
  modalTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1 },
  modalSub: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14), marginTop: 4 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 6 },
  label: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(12), letterSpacing: 1, marginTop: 12 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.background, marginTop: 6 },
  cta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  ctaText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18), letterSpacing: 0.9 },
  footerRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  footerCta: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  footerSecondary: { height: 52, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  footerSecondaryText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  linkBtn: { alignItems: 'center', marginTop: 12, minHeight: MIN_TOUCH, justifyContent: 'center' },
  link: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13) },
});
