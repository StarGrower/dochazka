// Testy logiky pobytů (lib/visitEngine.ts) a rozpadu na dny
// (lib/dayTimeline.ts). Spuštění: npm run test:engine
//
// SOUKROMÍ: repozitář je veřejný - souřadnice tady jsou SMYŠLENÉ (okolí
// 0,0 v Guinejském zálivu), žádná skutečná místa. Test se skutečným
// ladicím deníkem je jen lokálně v private/ (v .gitignore).

import assert from 'node:assert/strict';

import { backupsToDelete, formatRecoveryKey, parseRecoveryKey } from '../lib/backupKey';
import { buildDayTimeline } from '../lib/dayTimeline';
import { consumptionSegments, estimateCounter, learnRatio, parseCounterText, parseReceiptText, serviceStatus, stockState, usagePerWorkday } from '../lib/machineCalc';
import { computeOrderStats } from '../lib/orderStats';
import { proposeStayRecord } from '../lib/stayProposal';
import { DEFAULT_SETTINGS, type WorkCategory } from '../lib/types';
import { applyRounding } from '../lib/workCalc';
import { acceptRoadDistance, computeGapTrips, filterRoutePoints, matchTrips, planRoadSegments, tripKm, type PlanVisit } from '../lib/tripPlan';
import { computeVisits, type EngineEvent, type EnginePlace, type EngineVisit } from '../lib/visitEngine';

const A: EnginePlace = { id: 1, latitude: 0.01, longitude: 0.01, radiusM: 150 };
const B: EnginePlace = { id: 2, latitude: 0.05, longitude: 0.05, radiusM: 150 };
const places = [A, B];
const opts = { minStayMinutes: 10 };

const t = (hhmm: string, day = '2026-01-05') => Date.parse(`${day}T${hhmm}:00Z`);
const ev = (kind: EngineEvent['kind'], at: number, p: { latitude: number; longitude: number } | null, placeId: number | null = null): EngineEvent => ({
  kind,
  atMs: at,
  latitude: p?.latitude ?? null,
  longitude: p?.longitude ?? null,
  placeId,
});
const summary = (vs: EngineVisit[]) =>
  vs.map((v) => `${v.placeId ?? '?'} ${v.startUncertain ? '?' : new Date(v.startMs).toISOString().slice(11, 16)}-${v.endMs === null ? 'open' : new Date(v.endMs).toISOString().slice(11, 16)}`);

const tests: Array<[string, () => void]> = [
  ['duplicitní příjezd (4×) = jeden pobyt', () => {
    const at = t('15:08');
    const r = computeVisits([ev('visit_arrival', at, A), ev('visit_arrival', at, A), ev('visit_arrival', at + 300, A), ev('visit_arrival', at, A)], places, opts);
    assert.deepEqual(summary(r), ['1 15:08-open']);
  }],
  ['odjezd uzavře pobyt i po dlouhé době', () => {
    const r = computeVisits([ev('visit_arrival', t('18:34', '2026-01-02'), A), ev('visit_departure', t('04:49', '2026-01-03'), A)], places, opts);
    assert.deepEqual(summary(r), ['1 18:34-04:49']);
  }],
  ['nový pobyt uzavře předchozí (jen jeden otevřený)', () => {
    const r = computeVisits([ev('visit_arrival', t('08:00'), A), ev('visit_arrival', t('12:00'), B)], places, opts);
    assert.deepEqual(summary(r), ['1 08:00-12:00', '2 12:00-open']);
  }],
  ['stejné místo do 15 min = jeden pobyt', () => {
    const r = computeVisits([ev('visit_arrival', t('08:00'), A), ev('visit_departure', t('10:00'), A), ev('visit_arrival', t('10:10'), A), ev('visit_departure', t('12:00'), A)], places, opts);
    assert.deepEqual(summary(r), ['1 08:00-12:00']);
  }],
  ['krátký pobyt se zahodí', () => {
    const r = computeVisits([ev('visit_arrival', t('08:00'), B), ev('visit_departure', t('08:05'), B)], places, opts);
    assert.deepEqual(summary(r), []);
  }],
  ['pořadí doručení nehraje roli (pozdě doručený odjezd)', () => {
    const events = [ev('visit_arrival', t('12:00'), B), ev('visit_arrival', t('08:00'), A), ev('visit_departure', t('11:30'), A)];
    assert.deepEqual(summary(computeVisits(events, places, opts)), ['1 08:00-11:30', '2 12:00-open']);
  }],
  ['geofence vstup těsně po odjezdu se ignoruje', () => {
    const r = computeVisits([ev('visit_arrival', t('08:00'), A), ev('visit_departure', t('12:32'), A), ev('geofence_enter', t('12:33'), null, 1)], places, opts);
    assert.deepEqual(summary(r), ['1 08:00-12:32']);
  }],
  ['geofence výstup + pozdější CLVisit odjezd -> čas odjezdu z CLVisit', () => {
    const r = computeVisits([ev('visit_arrival', t('08:00'), A), ev('geofence_exit', t('12:30'), null, 1), ev('visit_departure', t('12:35'), A)], places, opts);
    assert.deepEqual(summary(r), ['1 08:00-12:35']);
  }],
  ['odjezd bez příjezdu = neznámý začátek', () => {
    const r = computeVisits([ev('visit_departure', t('18:23'), B), ev('visit_arrival', t('18:34'), A)], places, opts);
    assert.deepEqual(summary(r), ['2 ?-18:23', '1 18:34-open']);
  }],
  ['neznámé místo: příjezd a odjezd s mírně jinými souřadnicemi', () => {
    const u1 = { latitude: 0.2, longitude: 0.2 };
    const u2 = { latitude: 0.2001, longitude: 0.2001 };
    const r = computeVisits([ev('visit_arrival', t('07:06'), u1), ev('visit_departure', t('16:50'), u2)], places, opts);
    assert.deepEqual(summary(r), ['? 07:06-16:50']);
  }],
  ['CLVisit kus za poloměrem se přiřadí k místu', () => {
    const near = { latitude: A.latitude + 0.0023, longitude: A.longitude }; // ~255 m od středu
    const r = computeVisits([ev('visit_arrival', t('08:00'), near)], places, opts);
    assert.deepEqual(summary(r), ['1 08:00-open']);
  }],
  ['významná změna daleko od místa uzavře pobyt', () => {
    const far = { latitude: 0.03, longitude: 0.03 };
    const r = computeVisits([ev('visit_arrival', t('08:00'), A), ev('significant', t('12:00'), far)], places, opts);
    assert.deepEqual(summary(r), ['1 08:00-12:00']);
  }],
  ['průběh dne: přes půlnoc, probíhá jen do teď, ne v budoucnu, přejezd jen mezi různými místy', () => {
    const visits = [
      { placeId: 1, unknownLatitude: null, unknownLongitude: null, startAt: '2026-01-03T17:09:00.000Z', endAt: '2026-01-04T12:32:00.000Z', startUncertain: false },
      { placeId: 2, unknownLatitude: null, unknownLongitude: null, startAt: '2026-01-04T12:43:00.000Z', endAt: null, startUncertain: false },
    ];
    const now = Date.parse('2026-01-04T15:00:00Z');
    const sat = buildDayTimeline(visits, '2026-01-03', now);
    assert.equal(sat.length, 1);
    assert.ok(sat[0].kind === 'stay' && sat[0].endsAfterDay && !sat[0].startsBeforeDay);
    const sun = buildDayTimeline(visits, '2026-01-04', now);
    assert.deepEqual(sun.map((i) => i.kind), ['stay', 'travel', 'stay']);
    assert.ok(sun[0].kind === 'stay' && sun[0].startsBeforeDay);
    assert.ok(sun[2].kind === 'stay' && sun[2].ongoing && sun[2].segEndMs === now);
    assert.deepEqual(buildDayTimeline(visits, '2026-01-05', now), []);
  }],
  ['průběh dne: probíhající pobyt přes 24 h = nejistý konec', () => {
    const visits = [{ placeId: 1, unknownLatitude: null, unknownLongitude: null, startAt: '2026-01-02T18:34:00.000Z', endAt: null, startUncertain: false }];
    const day = buildDayTimeline(visits, '2026-01-04', Date.parse('2026-01-04T10:00:00Z'));
    assert.ok(day[0].kind === 'stay' && day[0].uncertainEnd);
  }],
  // --- etapa 3: přejezdy ---
  ['přejezd z bodů: místo -> body -> místo, nepřesné a skokové body pryč', () => {
    const visits: PlanVisit[] = [
      { placeId: 1, unknownLatitude: null, unknownLongitude: null, placeLatitude: 0, placeLongitude: 0, startAt: '2026-01-05T06:00:00.000Z', endAt: '2026-01-05T08:00:00.000Z', startUncertain: false },
      { placeId: 2, unknownLatitude: null, unknownLongitude: null, placeLatitude: 0, placeLongitude: 0.1, startAt: '2026-01-05T08:20:00.000Z', endAt: null, startUncertain: false },
    ];
    const pt = (min: number, lon: number, accuracyM = 10) => ({ timestamp: `2026-01-05T08:${String(min).padStart(2, '0')}:00.000Z`, latitude: 0, longitude: lon, accuracyM, speedMps: null });
    const points = [pt(2, 0.02), pt(5, 0.04), pt(6, 0.5), pt(8, 0.06, 500), pt(10, 0.08)];
    assert.equal(filterRoutePoints(points).length, 3); // skok na 0.5 a přesnost 500 m pryč
    const [trip] = computeGapTrips(visits, points, 300);
    assert.equal(trip.isEstimate, false);
    assert.equal(trip.pointCount, 3);
    assert.ok(Math.abs(trip.distanceM - 11132) < 50, `vzdálenost ${trip.distanceM}`); // 0,1° délky na rovníku
    assert.equal(trip.gpsFirstPointAt, '2026-01-05T08:02:00.000Z');
  }],
  ['přejezd bez bodů = odhad (vzdušná × 1,3), krátký se nepočítá, stejné místo ne', () => {
    const v = (placeId: number, lon: number, start: string, end: string | null): PlanVisit => ({ placeId, unknownLatitude: null, unknownLongitude: null, placeLatitude: 0, placeLongitude: lon, startAt: start, endAt: end, startUncertain: false });
    const visits = [
      v(1, 0, '2026-01-05T06:00:00.000Z', '2026-01-05T08:00:00.000Z'),
      v(2, 0.1, '2026-01-05T08:20:00.000Z', '2026-01-05T09:00:00.000Z'),
      v(3, 0.101, '2026-01-05T09:05:00.000Z', '2026-01-05T10:00:00.000Z'), // ~110 m - pod minimem
      v(3, 0.101, '2026-01-05T10:20:00.000Z', null), // stejné místo - žádný přejezd
    ];
    const trips = computeGapTrips(visits, [], 300);
    assert.equal(trips.length, 1);
    assert.ok(trips[0].isEstimate && Math.abs(trips[0].distanceM - 11132 * 1.3) < 60);
  }],
  ['sladění přejezdů: shoda podle překryvu, ručně smazaný zůstane smazaný, zaniklý se odebere', () => {
    const c = (s: string, e: string) => ({ startAt: s, endAt: e, fromPlaceId: 1, fromLatitude: null, fromLongitude: null, toPlaceId: 2, toLatitude: null, toLongitude: null, distanceM: 1000, isEstimate: false, pointCount: 5, gpsFirstPointAt: null });
    const plan = matchTrips(
      [c('2026-01-05T08:00:00Z', '2026-01-05T08:20:00Z'), c('2026-01-05T12:00:00Z', '2026-01-05T12:30:00Z'), c('2026-01-05T15:00:00Z', '2026-01-05T15:10:00Z')],
      [
        { id: 10, startAt: '2026-01-05T08:05:00Z', endAt: '2026-01-05T08:25:00Z', isDeleted: false, deletedBy: null },
        { id: 11, startAt: '2026-01-05T12:00:00Z', endAt: '2026-01-05T12:30:00Z', isDeleted: true, deletedBy: 'user' },
        { id: 12, startAt: '2026-01-05T13:00:00Z', endAt: '2026-01-05T13:30:00Z', isDeleted: false, deletedBy: null },
      ]
    );
    assert.deepEqual(plan.updates.map((u) => u.id), [10]);
    assert.equal(plan.inserts.length, 1);
    assert.deepEqual(plan.removals, [12]);
  }],
  // --- etapa 4 ---
  ['obnovovací klíč: base32 ve skupinách, tam a zpět, překlepy v mezerách nevadí', () => {
    const key = 'q2FzZGZnaGprbHF3ZXJ0eXVpb3BhenhjdmJubTEyMzQ='; // 32 bajtů
    const text = formatRecoveryKey(key);
    assert.match(text, /^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
    assert.equal(parseRecoveryKey(text), key);
    assert.equal(parseRecoveryKey(`DOCHAZKA-KEY:${text.toLowerCase().replace(/-/g, ' ')}`), key);
    assert.equal(parseRecoveryKey('ABC'), null);
  }],
  ['rotace záloh: 7 denních, 4 týdenní, 12 měsíčních', () => {
    const names: string[] = [];
    for (let i = 0; i < 400; i++) {
      const d = new Date(2026, 9, 5 - i);
      names.push(`Dochazka-zaloha-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.dochazka`);
    }
    names.push('Dochazka-pred-migraci-v3-2026-10-05.dochazka');
    const deleted = new Set(backupsToDelete(names));
    const kept = names.filter((n) => !deleted.has(n));
    assert.ok(kept.includes('Dochazka-pred-migraci-v3-2026-10-05.dochazka'), 'zálohy před migrací se nemažou');
    const daily = kept.filter((n) => n.startsWith('Dochazka-zaloha-'));
    assert.ok(daily.length >= 12 && daily.length <= 23, `ponecháno ${daily.length}`);
    for (let i = 0; i < 7; i++) assert.ok(daily.includes(names[i]), `chybí ${names[i]}`);
    assert.ok(!kept.includes(names[399]), 'nejstarší (přes rok) se smaže');
  }],
  ['návrh zápisu pobytu: zamčený / naučený stroj, přestávka a zaokrouhlení', () => {
    const cat = (id: number, name: string): WorkCategory => ({ id, name, rates: { hour: 900, day: 0, km: 0 }, defaultUnit: 'hour', weekendPct: null, holidayPct: null, sortOrder: id, isDeleted: false, color: '#F2B705', kind: 'machine' });
    const categories = [cat(1, 'Tatra'), cat(2, 'Bagr')];
    const settings = { ...DEFAULT_SETTINGS, autoSubtractBreak: true, breakMinutes: 30, roundingMinutes: 30 as const };
    const ms = (8 * 60 + 15) * 60000; // 8 h 15 min
    const p = proposeStayRecord(ms, { categoryId: 2, unit: 'hour', locked: true }, settings, categories);
    assert.ok(p);
    assert.equal(p.category.name, 'Bagr');
    assert.equal(p.quantity, 8); // 7,75 h zaokrouhleno na 0,5 h
    assert.equal(p.explanation, '8 h 15 min − 30 min přestávka, zaokrouhleno na 0,5 h');
    assert.equal(p.locked, true);
    assert.equal(proposeStayRecord(ms, null, settings, categories)?.category.name, 'Tatra'); // bez návrhu první stroj
  }],
  ['zaokrouhlení: nejbližší / dolů / nahoru, bez chyb plovoucí čárky', () => {
    const r = (h: number, mode: 'nearest' | 'down' | 'up') => applyRounding(h, { roundingMinutes: 30, roundingMode: mode });
    assert.equal(r(7.75, 'nearest'), 8);
    assert.equal(r(7.75, 'down'), 7.5);
    assert.equal(r(7.6, 'up'), 8);
    assert.equal(r(7.5000001, 'up'), 7.5);
    assert.equal(applyRounding(7.33, { roundingMinutes: 0, roundingMode: 'down' }), 7.33);
  }],
  ['dopočet po silnici: začátek, mezery > 300 m a konec; hustá trasa bez dopočtu', () => {
    const pt = (sec: number, lon: number) => ({ timestamp: new Date(Date.UTC(2026, 0, 5, 8, 0, sec)).toISOString(), latitude: 0, longitude: lon, accuracyM: 10, speedMps: null });
    // body po ~111 m (0,001°), jedna mezera ~1,1 km (0,010 -> 0,020)
    const points = [pt(10, 0.002), pt(20, 0.003), pt(30, 0.004), pt(100, 0.014), pt(110, 0.015)];
    const plan = planRoadSegments(points, { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.0152 });
    assert.deepEqual(plan.segments.map((s) => s.kind), ['start', 'gap']); // konec 22 m - bez dopočtu
    assert.ok(Math.abs(plan.gpsM - (111 * 3 + 22)) < 10, `gps ${plan.gpsM}`);
    const none = planRoadSegments([], { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.1 });
    assert.deepEqual(none.segments.map((s) => s.kind), ['whole']);
    assert.equal(acceptRoadDistance(1000, 1250), 1250);
    assert.equal(acceptRoadDistance(1000, 800), 1000); // silnice nikdy kratší než vzdušná čára
    assert.equal(acceptRoadDistance(1000, 9000), 1000); // nesmyslná objížďka
    assert.equal(acceptRoadDistance(1000, -1), 1000); // trasa nenalezena
    assert.equal(tripKm({ kmOverride: null, distanceM: 20600, roadDistanceM: 24800 }), 24.8);
  }],
  // --- etapa 5: zakázky ---
  ['zakázka: k fakturaci po strojích a km, nevyfakturováno, výsledek a Kč/h', () => {
    const rec = (name: string, id: number, q: number, rate: number, batch: number | null, pct = 0) => ({ categoryId: id, categoryName: name, color: '#fff', unit: 'hour' as const, quantity: q, rateKc: rate, surchargePct: pct, date: '2026-10-05', authorId: 1, invoiceBatchId: batch });
    const stats = computeOrderStats({
      priceMode: 'budget',
      fixedPriceKc: null,
      budgetKc: 10000,
      records: [rec('Bagr', 1, 4, 1000, 7), rec('Bagr', 1, 2, 1000, null, 25), rec('Ruční práce', 2, 3, 400, null)],
      trips: [{ km: 20, rateKc: 10, date: '2026-10-05', invoiceBatchId: null }],
      expenses: [{ amountKc: 500, category: 'material', date: '2026-10-05' }],
      fuelCostKc: 300,
      fuelLiters: 15,
      invoicedKc: 4000,
      people: new Map([[1, 'Já']]),
    });
    assert.equal(stats.lines[0].name, 'Bagr');
    assert.equal(stats.lines[0].amountKc, 4000 + 2500); // příplatek 25 % u druhé položky
    assert.equal(stats.kmAmountKc, 200);
    assert.equal(stats.ratesTotalKc, 6500 + 1200 + 200);
    assert.equal(stats.unbilledKc, 2500 + 1200 + 200); // vyfakturovaná položka se nepočítá
    assert.equal(stats.resultKc, 7900 - 500 - 300);
    assert.equal(stats.hours, 9);
    assert.ok(stats.kcPerHour !== null && Math.abs(stats.kcPerHour - 7100 / 9) < 0.01);
    assert.equal(Math.round(stats.budgetPct ?? 0), 79);
    assert.deepEqual(stats.people, [{ name: 'Já', hours: 9 }]);
  }],
  ['zakázka s pevnou cenou: k fakturaci = pevná cena minus vystavené podklady', () => {
    const stats = computeOrderStats({
      priceMode: 'fixed', fixedPriceKc: 50000, budgetKc: null, records: [], trips: [], expenses: [], fuelCostKc: 0, fuelLiters: 0, invoicedKc: 20000, people: new Map(),
    });
    assert.equal(stats.billableKc, 50000);
    assert.equal(stats.unbilledKc, 30000);
    assert.equal(stats.budgetPct, null);
  }],
  ['stroj: poměr Mth/zapsané hodiny z kotev a odhad počitadla', () => {
    const D = 24 * 3600 * 1000;
    const t0 = Date.UTC(2026, 9, 1, 12);
    const samples = [1, 2, 3, 4, 5, 6].map((d) => ({ atMs: t0 + d * D, amount: 8 }));
    // 1.-4. den: 32 h zapsáno, Mth +28 -> poměr 0,875
    const anchors = [{ atMs: t0, value: 1000 }, { atMs: t0 + 4 * D + 1000, value: 1028 }];
    assert.equal(learnRatio(anchors, samples), 0.875);
    const est = estimateCounter(anchors, samples, t0 + 6 * D + 1000);
    assert.ok(est);
    assert.equal(est.sinceAnchor, 16);
    assert.equal(est.value, 1028 + 16 * 0.875);
    // chybná kotva (poměr 10) se omezí na 3
    assert.equal(learnRatio([{ atMs: t0, value: 0 }, { atMs: t0 + 1.5 * D, value: 80 }], samples), 3);
    // bez kotev není odhad, s jednou kotvou poměr 1
    assert.equal(estimateCounter([], samples, t0), null);
    assert.equal(estimateCounter([anchors[0]], samples, t0 + 2 * D + 1)?.value, 1016);
    assert.equal(usagePerWorkday(samples, t0 + 6 * D + 1, 1), 8);
  }],
  ['stroj: servis - co nastane dřív (Mth / čas) a prahy upozornění', () => {
    const now = Date.parse('2026-10-06T12:00:00');
    const base = { intervalValue: 250, intervalDays: 365, warnFirst: 50, warnSecond: 20, warnDaysFirst: 30, warnDaysSecond: 7, lastDoneValue: 1000, lastDoneDate: '2026-06-01' };
    const ok = serviceStatus(base, 1100, now, 7);
    assert.equal(ok.level, 'ok');
    assert.equal(ok.remainingValue, 150);
    assert.equal(ok.estimatedWorkdays, 21);
    assert.equal(serviceStatus(base, 1210, now, 7).threshold, 'first');
    assert.equal(serviceStatus(base, 1235, now, 7).threshold, 'second');
    assert.equal(serviceStatus(base, 1251, now, 7).level, 'overdue');
    // čas: rok od 9. 10. 2025 -> za 3 dny -> druhý práh
    const byDate = serviceStatus({ ...base, lastDoneDate: '2025-10-09' }, 1100, now, 7);
    assert.equal(byDate.remainingDays, 3);
    assert.equal(byDate.threshold, 'second');
    assert.equal(serviceStatus({ ...base, intervalDays: null }, null, now, 0).level, 'unknown');
  }],
  ['stroj: spotřeba plná-plná se skokem +20 %', () => {
    const seg = consumptionSegments([
      { atMs: 1, liters: 80, fullTank: true, counter: 1000 },
      { atMs: 2, liters: 30, fullTank: false, counter: null },
      { atMs: 3, liters: 50, fullTank: true, counter: 1010 }, // 80 l / 10 Mth
      { atMs: 4, liters: 100, fullTank: true, counter: 1020 }, // 10 l/Mth -> skok
    ]);
    assert.equal(seg.length, 2);
    assert.equal(seg[0].liters, 80);
    assert.equal(seg[0].perUnit, 8);
    assert.equal(seg[0].jump, false);
    assert.equal(seg[1].jump, true);
  }],
  ['stroj: zásoba nafty - vážený průměr a výdej', () => {
    const st = stockState([
      { atMs: 1, kind: 'purchase', liters: 1000, priceTotalKc: 30000 },
      { atMs: 2, kind: 'issue', liters: 400, priceTotalKc: null },
      { atMs: 3, kind: 'purchase', liters: 400, priceTotalKc: 14000 },
    ]);
    assert.equal(st.liters, 1000);
    assert.equal(Math.round(st.avgPricePerL * 100) / 100, 32);
  }],
  ['OCR: počitadlo a účtenka (jen návrh)', () => {
    assert.equal(parseCounterText(['12:45', 'MTH', '4 512,3']), 4512.3);
    assert.equal(parseCounterText(['06.10.2026', '00123456']), 123456);
    assert.equal(parseCounterText(['bez cisel']), null);
    const r = parseReceiptText(['Cerpaci stanice X', 'Nafta 52,34 l', '36,90 Kč/l', 'CELKEM 1 931,35 Kč', '6. 10. 2026 14:02']);
    assert.equal(r.liters, 52.34);
    assert.equal(r.pricePerL, 36.9);
    assert.equal(r.totalKc, 1931.35);
    assert.equal(r.date, '2026-10-06');
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`OK    ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(err as Error).message.split('\n').join('\n      ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} OK`);
process.exit(failed ? 1 : 0);
