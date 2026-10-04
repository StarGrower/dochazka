// Testy logiky pobytů (lib/visitEngine.ts) a rozpadu na dny
// (lib/dayTimeline.ts). Spuštění: npm run test:engine
//
// SOUKROMÍ: repozitář je veřejný - souřadnice tady jsou SMYŠLENÉ (okolí
// 0,0 v Guinejském zálivu), žádná skutečná místa. Test se skutečným
// ladicím deníkem je jen lokálně v private/ (v .gitignore).

import assert from 'node:assert/strict';

import { buildDayTimeline } from '../lib/dayTimeline';
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
