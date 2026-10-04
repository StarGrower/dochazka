# Docházka - poznámky k projektu

Osobní iPhone aplikace pro evidenci docházky, práce a strojů na stavbách.
Vyvíjí se na Windows/WSL2 (bez Macu), bez placených služeb.

## Stav

**Etapa 1 (kalendář, ruční zápis hodin, kategorie/stroje se sazbami) - HOTOVO.**
**Vizuální styl "A · Stavba" - HOTOVO.**
**Test na iPhonu, 3 části (klávesnice, barvy, přestavba Nastavení) - HOTOVO.**
**Etapa 2, ČÁST A (GitHub + sestavení) - HOTOVO, první build na GitHubu OVĚŘEN (13m59s, všechny kroky zelené, `.ipa` 14,7 MB).**
**Etapa 2, ČÁST B (záznam míst) - HOTOVO, build OVĚŘEN (15m42s, všechny kroky zelené vč. kompilace Swift modulu `visit-monitor`, `.ipa` ~14,5 MB, run 37043119315). Test v terénu proběhl 2.-4. 10. 2026.**
**Oprava 2 (po terénním testu etapy 2) - HOTOVO (skupiny A-F), build OVĚŘEN (run 37210061504, 13m21s, všechny kroky zelené vč. Swift modulu, `.ipa` ~15 MB). Čeká na test v telefonu - viz "Co otestovat v telefonu (oprava 2)".**

**Etapa 4 (záloha, stav záznamu, připomenutí, výkaz pro šéfa) - HOTOVO, build OVĚŘEN (run 37242592887, 16m52s, vše zelené vč. Swift modulu dochazka-native, `.ipa` ~15,8 MB). Čeká na test - viz "Etapa 4 - co testovat".**
**Plán etap 4-8: `PLAN_DALSI_ETAPY.md` (jen lokálně, v `.gitignore`), grafické předlohy v `private/` (predloha-pripominka.html, predloha-zakazky.html).**
**Etapa 3 (přejezdy, trasy, km, mapa) + ikona, logo a úvodní animace - HOTOVO, build OVĚŘEN (run 37218589500, 15m34s, vše zelené vč. react-native-maps a react-native-svg, `.ipa` ~15 MB). Čeká na test v terénu - viz "Etapa 3 - co testovat v terénu".**
- Etapa 4 (export, záloha) - nezačato.

## Etapa 4 - záloha, stav záznamu, připomenutí, výkaz pro šéfa

### Bezplatné Apple ID - co a proč jinak

- **Vlastní místní upozornění místo `expo-notifications`** - jeho config
  plugin přidává oprávnění pro push (`aps-environment`), které bezplatný
  podpis nepodporuje. Místní upozornění žádné oprávnění nepotřebují.
- **iCloud Klíčenka**: klíč zálohy je `kSecAttrSynchronizable` (žádné
  placené oprávnění; přepodepsání stejným Apple ID = stejný tým = klíč
  čitelný). Skutečnou synchronizaci NEJDE ověřit (uživatel nemá druhé
  zařízení) -> **obnovovací klíč je hlavní pojistka**.
- **Složka v iCloud Drive** přes výběr v Souborech + security-scoped
  bookmark - bez oprávnění pro iCloud. Každý pokus o zálohu se zapíše do
  deníku (ZÁLOHA OK/SELHALA, v popředí / na pozadí) = zároveň pokus pro
  etapu 8 (zápis do iCloud Drive na pozadí s bezplatným podpisem).

### Nativní modul `modules/dochazka-native` (Swift 5.9)

- `BackupVault.swift` - složka (bookmark v UserDefaults, zápis/čtení přes
  `NSFileCoordinator`), AES-256-GCM (CryptoKit; soubor = "DOCHZK01" +
  `SealedBox.combined`), klíč v Klíčence (`AfterFirstUnlock` +
  `Synchronizable`, když synchronizovatelný nejde uložit, tak místní),
  datum vypršení podpisu z `embedded.mobileprovision`.
- `LocalNotifications.swift` - upozornění s akcemi. NETRIVIÁLNÍ
  ROZHODNUTÍ: odpovědi (i akce, kvůli které iOS appku spustí na pozadí)
  jdou do fronty v UserDefaults a JS si je vyzvedne (`drainNotification
  Responses`) - stejný vzor jako fronta CLVisit. Delegate nastavuje
  `DochazkaNotificationsSubscriber` (AppDelegate subscriber) hned při
  startu procesu, jinak by se odpověď při studeném startu ztratila. Text
  tlačítek je u iOS součástí kategorie -> každé upozornění s textem
  "Zapsat: Bagr 7,5 h" má vlastní kategorii (všechny v UserDefaults).
- `MapSnapshot.swift` - snímek Apple Maps s trasou pro PDF (bez internetu
  chyba -> trasa v SVG bez podkladu).
- Místní soubory: dočasné cesty, nahrazení souboru DB při obnově.

### 4.1 Záloha (`lib/backup.ts`, `lib/backupKey.ts`, Nastavení -> Záloha)

- `Dochazka-zaloha-RRRR-MM-DD.dochazka` = šifrovaný snímek celé DB
  (`VACUUM INTO`, včetně nastavení). Automaticky max. 1× denně při startu
  appky i při probuzení polohou (proces na pozadí žije dny -> kontrola i
  po každém zpracování událostí), po chybě nejdřív za hodinu; před každou
  migrací DB `Dochazka-pred-migraci-vN-…` (hook `setPreMigrationHook`,
  rotace je nemaže); "Zálohovat teď".
- Rotace 7 denních / 4 týdenní / 12 měsíčních (`backupsToDelete`, testované).
- Obnovovací klíč: 32 B -> base32 ve skupinách po 4 + QR
  (`DOCHAZKA-KEY:…`), Kopírovat / Sdílet / Tisk; ukáže se při nastavení.
- Obnova: soubor ze složky nebo z Souborů (nový telefon) -> dešifrování
  do dočasné DB -> náhled (období, dny, položky, místa, pobyty) -> záloha
  aktuálního stavu -> zavřít DB, nahradit soubor, `reloadAppAsync`
  (migrace proběhnou při startu). Bez klíče v Klíčence se zeptá na
  obnovovací klíč a uloží ho zpět do Klíčenky. Bookmark složky a klíč
  jsou mimo DB - obnova je nepřepíše. Velikost písma se po obnově
  dorovná z nastavení v DB (`syncFontScaleStorage`).
- Kalendář: na čerstvé instalaci (prázdná DB, bez zálohy) karta "Máš
  zálohu z jiného telefonu? OBNOVIT / Ne, začít znovu".

### 4.2 Stav záznamu (`lib/health.ts`, Nastavení -> Stav záznamu)

Poloha "Vždy", přesná poloha, režim nízké spotřeby, aktualizace na
pozadí, podpis appky (< 2 dny = problém), záloha (nenastavená / složka
nedostupná / > 7 dní), dnes žádná událost polohy (po 3 h časového okna
v pracovní den), upozornění nepovolená (když jsou připomenutí zapnutá).
Proužek v kalendáři (žlutý pozor / červený problém) -> Stav záznamu;
vážné problémy = místní upozornění max. 1× denně na problém.

### 4.3 Připomenutí (`lib/reminders.ts`, `lib/stayProposal.ts`, `components/StaySheet.tsx`)

- NETRIVIÁLNÍ ROZHODNUTÍ - "požadovaný stav" upozornění na dnešek se
  spočítá znovu po každém přepočtu pobytů, po zápisu a při startu
  (`evaluateReminders`) a sladí se s naplánovanými (naplánovat /
  přeplánovat / zrušit; stav v `reminder_state`).
- Pobyt = pracovní místo za den (víc pobytů sečteno); zapsaný = zápis s
  `place_id` toho místa v ten den. Nikdy soukromá ani neznámá místa,
  jen v časovém okně, volitelně jen pracovní dny.
- Odjezd (pobyt >= 30 min, upozornění za 10 min, návrat = zrušit), doma
  (jedno upozornění se všemi nezapsanými), večer (jen když něco chybí);
  akce Zapsat (uloží bez otevření appky, `source = 'reminder'`) / Upravit
  v aplikaci (Detail dne `?stay=<místo>` -> okno Zapsat pobyt) /
  Připomenout večer / Dnes nezapisovat.
- Návrh: stroj zamčený pro místo (`place_suggestions`) -> naučený
  (nejčastější z posledních 30 zápisů u místa) -> první výchozí položka
  -> první stroj; hodiny = délka − přestávka, zaokrouhleno (na nejbližší
  krok - v předloze je u 8 h 15 min − 30 min "7,5 h", appka dá 8 h).
- Okno "Zapsat pobyt" přesně podle předlohy (rozměry z HTML, písma a
  barvy z theme): čipy (navržený první, "+ Další"), hodnota s +/− (dá se
  i přepsat), vysvětlení, "<stroj> nabízet pro toto místo" (zamčení),
  ULOŽIT, "Rozdělit na víc strojů". V Detailu dne odkaz "Zapsat pobyt ›"
  u nezapsaného pracovního pobytu.

### 4.4 Výkaz pro šéfa (`lib/report.ts`, Nastavení -> Výkaz pro šéfa)

Období (týden, měsíc, vlastní), místa (zakázky až v etapě 5), volby s
cenami / s mapou tras (PDF; Apple Maps snímek, offline SVG) / podrobně
(pobyty, přejezdy, poznámky) / podpis prstem (`components/SignaturePad
.tsx`, SVG cesta). PDF přes `expo-print`, skutečné XLSX (vlastní zápis
OOXML + `fflate`) a CSV (středník, UTF-8 BOM), Sdílet. Hlavička: logo +
Moje údaje (nová obrazovka místo "Připravujeme"). **Soukromá místa a
jízdy se nikdy nevypíšou; body tras do poloměru + 300 m od soukromých
míst se z mapy ořežou.**

### Migrace v4 (`user_version` 3 -> 4)

`day_work_records.place_id` (+ index), tabulky `place_suggestions` a
`reminder_state`, nové klíče nastavení (připomenutí, Moje údaje). Záloha
`dochazka-zaloha-pred-etapou-4.db` + šifrovaná do složky (když je
nastavená). Ověřeno lokálně z v0 i z v3. (Oprava: název zálohy před
migrací = cílová verze, `…pred-etapou-${from + 1}`.)

### Etapa 4 - co testovat

1. **Záloha:** Nastavení -> Záloha -> VYBRAT SLOŽKU (iCloud Drive ->
   nová složka Docházka) -> obnovovací klíč ULOŽIT (Hesla/tisk) -> v
   Souborech se objeví `Dochazka-zaloha-…dochazka`. Další den: v deníku
   ZÁLOHA OK - **hlavně "na pozadí"** (probuzení polohou) - a soubor s
   novým datem. Pokud SELHALA, pošli export deníku.
2. **Obnova (opatrně):** Obnovit u dnešní zálohy -> náhled sedí ->
   Nahradit -> appka se znovu načte a data jsou stejná. (Před obnovou se
   udělá záloha `Dochazka-pred-migraci-pred-obnovou-…`.)
3. **Stav záznamu:** vypni na chvíli "Vždy" / zapni úsporný režim ->
   proužek v kalendáři a položka v Stavu záznamu; podpis appky ukazuje
   datum vypršení.
4. **Připomenutí:** Zápisy -> Připomenutí zapnout (povolit upozornění).
   Odjeď ze stavby po > 30 min -> za 10 min upozornění s návrhem;
   podržet -> "Zapsat: …" (zápis vznikne bez otevření appky) / Upravit
   v aplikaci (otevře okno Zapsat pobyt) / Připomenout večer / Dnes
   nezapisovat. Vrátit se na stavbu do 10 min = upozornění nepřijde.
   Doma: souhrn nezapsaných. Večer: souhrn jen když něco chybí.
5. **Zapsat pobyt** (Detail dne -> "Zapsat pobyt ›"): čipy, +/−,
   zamknout stroj pro místo, rozdělit na víc strojů.
6. **Výkaz:** Moje údaje vyplnit -> Výkaz -> Minulý měsíc -> PDF (s
   cenami, s mapou, podrobně, podpis) -> Sdílet; XLSX otevřít v
   Excelu/Numbers. Ověř, že domov a soukromé jízdy ve výkazu nejsou.

## Etapa 3 - přejezdy, trasy, kilometry, mapa

### Záznam trasy (`lib/tripTracking.ts`)

- Samostatný úkol `dochazka-trip-task` (`startLocationUpdatesAsync`,
  `AutomotiveNavigation`, `pausesUpdatesAutomatically`). Kvalita:
  **přesná** = `Accuracy.High` (~10 m) + bod po 50 m; **úsporná** =
  `Accuracy.Balanced` (~100 m, spíš Wi-Fi/BTS) + bod po 100 m.
- **NETRIVIÁLNÍ ROZHODNUTÍ - start/konec ze STAVU POBYTŮ** po každém
  přepočtu (`evaluateTripSession`): poslední pobyt právě skončil (CLVisit
  odjezd, výstup z geofence nebo významná změna > 1 km - co přijde
  dřív; CLVisit odjezd chodí se zpožděním) = zapnout GPS; začal nový
  pobyt = vypnout. Dále vypnutí po ~10 min stání (body do 100 m) a
  pojistka 4 h. Odjezd starší než 30 min sledování nespustí; po konci
  sledování se pro stejný pobyt znovu nezapne (`trip_handled_departure`).
- Jen úsporný režim. V průběžném GPS běží stejně - jeho body se ukládají
  i jako body trasy (hrubé, interval 5-10 min).
- Body: `route_points` (přesnost > 100 m a skoky > 200 km/h se zahodí
  už při příjmu i znovu při výpočtu).

### Přejezdy (`lib/tripPlan.ts` čistě, `lib/trips.ts` s DB)

- **NETRIVIÁLNÍ ROZHODNUTÍ - přejezd je vlastní trvalý řádek** (`trips`),
  odvozený z mezer mezi pobyty na RŮZNÝCH místech a po každém přepočtu
  pobytů SLADĚNÝ podle časového překryvu (`matchTrips`) - pobyty mění
  ID, přejezd ne; ruční úpravy, body a vazba na položku práce přežijí.
  Ručně smazaný zůstane smazaný; zaniklý (pobyty se sloučily) se měkce
  smaže (`deleted_by = 'rebuild'`).
- Délka: místo odjezdu -> body (okno přejezdu ± 2 min) -> místo
  příjezdu (úsek k 1. bodu vzdušnou čarou - GPS startuje pozdě). Méně
  než 2 body = **odhad** (vzdušná × 1,3). Pod `minTripMeters` (300 m)
  se přejezd nepočítá (v průběhu dne zůstane "Přejezd · X min" bez km).
- Km přejezdu = `km_override` ?? vypočtené. Soukromá jízda se nepočítá
  do pracovních km (hlavička dne, NAJETO KM v kalendáři - podle dne
  začátku přejezdu; NAJETO KM je teď z přejezdů, ne z položek v km).
- **Ladicí deník:** START JÍZDY (důvod, odjezd, kvalita, baterie),
  KONEC JÍZDY (důvod, počet bodů, km, **zpoždění startu GPS** = 1. bod -
  odjezd; bez bodů důvod), PŘEJEZD po dokončení (km, odhad ano/ne +
  důvod, body, zpoždění). Důvody chybějících bodů: start GPS selhal (text
  chyby), GPS nedodala body, záznam tras vypnutý, průběžný režim,
  přejezd z doby před etapou 3.

### UI

- **Mapa** (`components/DayMap.tsx`, `react-native-maps`, Apple Maps
  `mutedStandard` + dark, 200 px, klepnutí = celá obrazovka): trasy
  žlutě (soukromé šedě), zastávky žluté čtverečky s číslem, soukromá
  místa šedě s domkem. Výběr místa v Uložených místech zůstal na
  `expo-maps` (přepisovat ho nemělo smysl).
- **Průběh dne:** klepnutí na řádek = zvýraznění a přiblížení na mapě;
  "upravit" = úprava (pobyt: časy - DŘÍV to bylo klepnutím na řádek;
  přejezd: `components/TripSheet.tsx`).
- **TripSheet:** ruční km (+ vrátit vypočtené), soukromá jízda, vozidlo
  (výchozí = 1. stroj s výchozí jednotkou Kč/km, jinak 1. s Kč/km),
  "PŘIDAT KM DO PRÁCE A STROJŮ" (položka v km, `source = 'trip'`, sazba
  a příplatek v okamžiku zápisu; volitelně součet všech pracovních
  přejezdů dne se stejným vozidlem, které ještě v práci nejsou), přejezd
  si pamatuje `work_record_id` (po smazání položky jde přidat znovu),
  "Zahodit trasu" (body `trip_id = -1` -> odhad), smazat přejezd.
- **Nastavení -> Poloha a trasy:** Zaznamenávat trasy jízd, kvalita,
  minimální přejezd (změna -> přepočet posledních 3 dnů).

### Etapa 3 - co testovat v terénu

Instalace přes Sideloadly jako dřív, appku NEMAŽ (migrace v3 + záloha
při prvním startu). Režim **Úsporný**, Poloha a trasy -> Zaznamenávat
trasy jízd ZAP; ladicí deník zapnutý.

1. **Ikona a start:** nová ikona DO; po spuštění značka na tmavém
   splashi -> animace (helma, kruh, ručičky, CHÁZKA) -> kalendář.
   Otevření appky probuzené polohou na pozadí = bez animace. S iOS
   "Omezit pohyb" jen statické logo.
2. **Minulé dny:** 2.-4. 10. mají přejezdy s "≈ km" (odhad), v deníku
   "přejezd z doby před etapou 3".
3. **Jízda (hlavní test):** odjeď z uloženého místa, jeď aspoň pár km,
   přijeď na jiné místo. V deníku: START JÍZDY (důvod, odjezd), KONEC
   JÍZDY (body, km, **zpoždění startu GPS**), PŘEJEZD (km, odhad ne).
   V detailu dne "Přejezd · X km · Y min" a žlutá trasa na mapě.
   Porovnej km s tachometrem / mapou.
4. **Krátká zastávka bez uloženého místa** (benzínka > 10 min) - nesmí
   rozbít přejezd; stání ~10 min vypne GPS (KONEC JÍZDY "stání 10 min").
5. **Selhání:** když START JÍZDY chybí nebo KONEC hlásí "žádné body",
   přejezd musí být odhad s důvodem v deníku - pošli export.
6. **Mapa:** klepnutí na pobyt/přejezd v seznamu zvýrazní a přiblíží;
   klepnutí na mapu = celá obrazovka; soukromá místa šedě s domkem.
7. **Přejezd -> upravit:** ruční km, soukromá jízda (zmizí z km dne i
   NAJETO KM), vozidlo, PŘIDAT KM DO PRÁCE A STROJŮ (položka v km se
   sazbou + příplatek o víkendu), součet přejezdů dne, Zahodit trasu,
   Smazat.
8. **Kvalita trasy** úsporná vs. přesná - porovnej trasu na mapě a
   spotřebu.
9. **Baterie:** zapiš si % ráno a večer + kolik jsi jel; v deníku je
   baterie u START/KONEC JÍZDY. Odhad: mimo jízdu beze změny (~7 %/den),
   jízda úsporná ~3-5 %/h, přesná ~6-10 %/h.

### Migrace v3 (`user_version` 2 -> 3)

Záloha `dochazka-zaloha-pred-etapou-3.db` (stejně jako u opravy 2).
Tabulky `trips` a `route_points`, sloupec `day_work_records.trip_id`,
nové klíče nastavení. Minulé přejezdy (mezery mezi už uloženými
pobyty) se doplní jako odhad (`trips_backfill_pending` ->
`finishLegacyVisitMigrationIfNeeded`), v deníku "přejezd z doby před
etapou 3". `location_points` se nepřevádějí. Ověřeno lokálně
(`private/migration-test.ts`) z v0 i z v2: 4 přejezdy 2.-4. 10. jako
odhad (~9,7 a ~14,8 km), pobyty beze změny, druhý start nic nemění.

### Baterie (odhad, ověří terén)

Mimo jízdu beze změny (CLVisit + geofence). Během jízdy GPS: úsporná
~3-5 %/h jízdy, přesná ~6-10 %/h. Baterie se zapisuje u START/KONEC
JÍZDY - z exportu deníku jde spotřeba na jízdu změřit.

## Ikona, logo a úvodní animace (s etapou 3)

- Zdroje `assets/brand/` (`mark.svg` - souřadnice přesně podle zadání,
  `icon.svg` - pozadí #131311, značka vycentrovaná podle spočteného
  ohraničení (střed 54,08/52,54, šířka 95,8, měřítko 0,75), `splash.svg`,
  `logo.svg`). PNG: `npm i --no-save sharp && node
  scripts/generate-brand.mjs` -> `assets/images/icon.png` (1024, bez
  průhlednosti), `splash-icon.png`, `favicon.png`.
- `components/Logo.tsx` (react-native-svg, Barlow Condensed ExtraBold
  800 - načítá se v `app/_layout.tsx`). **Rozhodnutí: logo jen na úvodní
  obrazovce** - v kalendáři by se s šipkami a názvem měsíce tlačilo.
- `components/IntroAnimation.tsx` (~2,5 s podle zadání). NETRIVIÁLNÍ
  ROZHODNUTÍ - části loga jsou samostatné vrstvy (vlastní `<Svg>`),
  rotace/měřítko přes `Animated.View` s `transformOrigin` v pivotu
  (helma 30/50, hodiny 72/52); kruh přes animovaný `strokeDashoffset`
  (od vrchu - kruh otočený -90°); text v ořezovém okně od středu hodin.
  Nativní splash (značka na #131311) zmizí hned po fontech, animace
  běží souběžně s DB/migracemi; fade až po doběhnutí animace A načtení
  dat. Animace je v kořeni stromu pořád na stejném místě (dokončení DB
  ji nepřemountuje). Start na pozadí (`AppState` 'background' při
  startu procesu) = bez animace. Reduce Motion = statické logo + fade.

## Oprava 2 - po terénním testu etapy 2

Zadání je v `ZADANI_OPRAVY_2.md` - **jen lokálně, v `.gitignore`**
(obsahuje ladicí deník se souřadnicemi). Postup po skupinách A-F.

### SOUKROMÍ - repozitář je veřejný

- `.gitignore`: `ZADANI_OPRAVY*.md`, `private/`, `*.db*`, exporty
  ladicího deníku. Do repozitáře NIKDY souřadnice, názvy míst, exporty
  deníku ani zálohy databáze. Historie commitů zkontrolována (4. 10.) -
  jediné souřadnice jsou obecný střed Prahy (výchozí bod mapy).
- `private/` (lokálně): `denik-2026-10-04.txt` (deník z telefonu),
  `replay-test.ts` (přehrání deníku, `npm run test:replay`),
  `migration-test.ts` (migrace na napodobené staré DB přes `node:sqlite`,
  `npx tsc -p private/tsconfig.test.json && TZ=Europe/Prague
  TEST_DB_DIR=<dočasná složka> node private/run-migration-test.js`).
- `scripts/test-visit-engine.ts` (v repu, `npm run test:engine`) má jen
  SMYŠLENÉ souřadnice kolem 0,0.

### Skupina A - poloha a pobyty (HOTOVO)

**Příčiny chyb z deníku:**
1. Duplicitní CLVisit (2-4×): Swift modul uložil událost do fronty
   a zároveň ji poslal živě; JS ji zpracoval živě, ale z fronty se
   nesmazala -> při dalším startu znovu. Baterie se četla až při
   zpracování, proto různá % u téže události.
2. Bouře geofence: `startGeofencingAsync` se volal při každém startu
   appky i každé significant change; iOS po registraci hlásí stav všech
   oblastí a to se bralo jako příjezd/odjezd.
3. Časové okno podle času ZPRACOVÁNÍ; sobotní odjezd padl mimo okno
   (Po-Pá) a zahodil se -> páteční pobyt zůstal otevřený 42 h.
4. Probíhající pobyt v budoucích dnech: dotaz `end_at IS NULL` se
   překrývá s jakýmkoliv dnem.
5. Smíchané formáty času (CLVisit v UTC `...Z`, ruční úpravy v místním
   čase bez zóny) + textové porovnání v SQL -> posun o 2 h.
6. **`useFocusEffect(() => load())` bez `useCallback`** na 8 obrazovkách
   -> `load` po KAŽDÉM překreslení: přepisoval rozepsaná pole (časové
   okno, délka dne, poznámka "nejdou změnit") a souběžně vkládal výchozí
   položky dne (Osobák 2×). Opraveno všude.

**NETRIVIÁLNÍ ROZHODNUTÍ - pobyty se přepočítávají z událostí.**
Nová tabulka `location_events` (každá událost JEDNOU - UNIQUE otisk:
typ + čas události [+ místo/souřadnice]). Pobyty (`visits` se source
clvisit/geofence/continuous) jsou odvozená data: po každé nové
události se přepočítají od jejího času (`lib/visits.ts ->
rebuildVisits`) čistou funkcí `lib/visitEngine.ts -> computeVisits`.
Pořadí doručení tím nehraje roli. Trvalé jsou jen ruční zásahy:
upravený pobyt -> `source = 'manual'` (přepočet ho nepřepíše, automatické
se kolem něj oříznou; otevřený ruční pobyt uzavře začátek dalšího),
smazaný -> `deleted_by = 'user'` (přepočet ho nevrátí). Přepočet sahá
max. tam, kde začíná pobyt běžící přes čas nové události (+15 min);
po změně místa / min. délky pobytu se přepočítají poslední 3 dny.
Události se drží 60 dní. Vše, co mění události/pobyty, běží přes
jednu frontu (`runExclusive`) - iOS doručuje víc událostí naráz.

Pravidla v `computeVisits`:
- hlavní zdroj CLVisit; geofence vstup = rychlejší příjezd (vstup do 5
  min po CLVisit odjezdu ze stejného místa se ignoruje), geofence výstup
  = záloha odjezdu (pozdější CLVisit odjezd ho zpřesní); significant
  change > 1 km za hranicí místa = důkaz odjezdu
- jen jeden otevřený pobyt; nový příjezd uzavře předchozí
- duplicity (stejný typ + sekunda) se zahodí
- CLVisit se k místu přiřadí i kus za poloměrem (tolerance +200 m -
  souřadnice CLVisit jsou "těžiště" s přesností desítek-stovek m;
  v deníku byl příjezd ~255 m od středu místa)
- odjezd bez příjezdu (sledování začalo, když už jsem na místě byl) ->
  pobyt s **neznámým začátkem** (`start_uncertain`, zobrazí se "?-20:23",
  do návrhu hodin se nepočítá)
- stejné místo do 15 min -> sloučit; krátké pobyty (< min. délky) pryč
- dvě "neznámá místa" do 300 m = totéž místo

**Nativní modul:** fronta je JEDINÁ cesta do JS - živá událost jen
spustí `drainPendingEvents()`; fronta je za zámkem (`NSLock`), k
události se přidává `receivedAt`.

**Geofence:** registrace jen při změně sady míst (otisk v
`settings` jako `internal.geofence_signature`), hlášení do 15 s po
registraci se ignorují (v deníku "úvodní stav po registraci, ignorováno").

**NETRIVIÁLNÍ ROZHODNUTÍ - časové okno už nefiltruje pobyty.**
Vyhodnocuje se podle času události a určuje (1) kdy průběžný režim
sbírá body (jinde se body vůbec nezapisují) a (2) jaká část pobytů se
počítá do "NAVRHNOUT Z POBYTŮ" (jen pracovní a neznámá místa, jen úsek
v tom dni, jen v okně a ve vybraných dnech). Příjezdy/odjezdy se
zaznamenávají vždy - iOS je dodá stejně (baterie navíc 0) a zahozený
odjezd mimo okno byl příčinou neuzavřených pobytů. Očekávaný výsledek
rekonstrukce ze zadání (pátek 20:34, sobota, neděle) to ostatně
předpokládá.

**Ladicí deník:** zapisují se jen NOVÉ události (duplicity ne), čas =
čas události; baterie k času události, u událostí doručených > 2 min
později "· doručeno později" + čas a baterie doručení zvlášť
(`debug_log.delivered_at/delivered_battery`).

**Průběh dne** (`lib/dayTimeline.ts`): pobyt přes půlnoc jen v rozsahu
dne (0:00 / 24:00), probíhající končí "teď" a v budoucích dnech se
neukazuje, délka jen za daný den, přejezd jen mezi RŮZNÝMI místy.
Probíhající > 24 h -> červené "Nejistý konec · Doplnit konec" (otevře
úpravu pobytu). Úprava času mění čas v rámci PŮVODNÍHO dne začátku/
konce (pobyt přes půlnoc jde upravit z kteréhokoliv dne), nezměněné
pole zůstane přesně.

**Místa - pracovní / soukromá** (`places.is_private`): domov je vždy
soukromý (hlídá i `lib/db.ts`). Soukromá se nepočítají do návrhu hodin,
v průběhu dne jsou tlumená s ikonou domku, v seznamu míst dvě skupiny.

### Skupina B - zápisy (HOTOVO)

- **B1** délka dne šla změnit až po opravě `useCallback` (viz A, bod 6);
  nově **0 = proměnná pracovní doba** - hodinové položky se
  nepředvyplňují (`defaultHourlyQuantity` vrátí 0), hodiny jen z pobytů
  nebo ručně.
- **B2 NETRIVIÁLNÍ ROZHODNUTÍ - výchozí položky jsou jen NÁVRH.** Nikdy
  se neuloží otevřením dne (`applyDayDefaultsIfNeeded` a `day_initialized`
  pryč). V prázdném dni se nabídnou v panelu "+ Přidat" (box "VÝCHOZÍ
  POLOŽKY" -> "POUŽÍT VÝCHOZÍ"); "+ ZAPSAT DNEŠEK" otevře den rovnou s
  tímhle panelem (`/day/<datum>?add=1`). Ne pro budoucí dny, volitelně
  jen v pracovní dny (`defaultsOnlyWorkdays`, výchozí zapnuto - bez
  víkendů a svátků). Pojistka proti dvojímu uložení: před uložením se
  ověří, že den je pořád prázdný.
- Položky mají `source` (manual / default / suggestion).

### Skupina C - stroje, sazby, příplatky (HOTOVO)

- **C1** stroj má `rate_hour_kc`, `rate_day_kc`, `rate_km_kc` +
  `default_unit`; položka dne má `unit`, `rate_kc` a `surcharge_pct` -
  **snímek v okamžiku zápisu** (pozdější změna ceníku staré dny nemění).
  Při zápisu jde jednotku přepnout (h / den / km), číselník se pak ptá
  na hodiny / dny / km (krok: nastavení / 0,5 / 10). Při úpravě položky
  a změně jednotky se vezme sazba nové jednotky z aktuálního ceníku,
  uložený příplatek zůstává. Původní `rate_type`/`rate_kc` u kategorie
  se dál plní podle výchozí jednotky (CHECK jen hourly/daily), nic na
  nich nestojí. Kalendář: "NAJETO KM" = součet položek v km.
- **C2** výchozí víkend % a svátek % v Nastavení -> Zápisy (výchozí 0);
  u stroje vlastní % (`weekend_pct`/`holiday_pct`, NULL = výchozí, 0 =
  bez příplatku), zobrazení "Víkend: výchozí (25 %)" / "Víkend: 40 %
  (vlastní)". Svátek o víkendu = součet. Platí i pro km. Detail dne:
  "Bagr · 5 h · 850 Kč/h · +25 %", částka už s příplatkem.
- **C3** `BottomSheetModal`: klepnutí kamkoliv do karty zavře klávesnici
  (dřív vnitřní onPress nedělal nic), klepnutí mimo kartu při otevřené
  klávesnici zavře jen klávesnici (ne okno - rozepsané se neztratí).
  Hodnota se uloží při ztrátě fokusu (onBlur). Panel stroje se roluje.
  Ostatní editační obrazovky jsou ScrollView/FlatList, kde klepnutí mimo
  pole klávesnici zavírá samo.

### Skupina D - kalendář a detail dne (HOTOVO)

- **D1** `lib/holidays.ts` - státní a ostatní svátky ČR (zákon
  245/2000 Sb.), Velký pátek (od 2016) a Velikonoční pondělí z data
  Velikonoc pro každý rok. Kalendář: víkend tlumeně, svátek červeně +
  proužek; Detail dne: štítek "Státní svátek · název" / "Víkend".
- **D2** pryč "UPRAVIT"; "+ Přidat" -> nabídka strojů -> hned číselník +
  přepínač jednotky -> OK = uloženo; klepnutí na položku -> úprava +
  Smazat (`components/WorkItemSheet.tsx`). "NAVRHNOUT Z POBYTŮ" otevře
  stejný panel s navrženými hodinami.
- **D3** poznámka - příčina byla `useFocusEffect` bez `useCallback`
  (každé písmeno přepsal `load`); ukládá se při ztrátě fokusu a pro
  jistotu i při odchodu zpět.

### Skupina E - aplikace (HOTOVO)

- Hmatová odezva úplně pryč (nastavení, `lib/haptics.ts`, balíček
  `expo-haptics`).
- **Velikost písma SKUTEČNĚ funguje** - NETRIVIÁLNÍ ROZHODNUTÍ: styly
  vznikají při načtení modulů (`StyleSheet.create`), takže měřítko se
  čte SYNCHRONNĚ při startu z `expo-sqlite/kv-store` (klíč
  `dochazka.fontScale`, zapisuje ho Nastavení -> Aplikace vedle hlavní
  DB) a všechna `fontSize` v appce jdou přes `fs()` z `theme.ts`
  ("Větší" = ×1,18). Po přepnutí se appka sama znovu načte
  (`reloadAppAsync` z `expo`).

### Skupina F - názvy míst (HOTOVO)

- `lib/geocode.ts` - nejbližší obec přes `Location.reverseGeocodeAsync`
  (Apple, zdarma), **až při zobrazení/exportu** deníku a v průběhu dne
  (ne při záznamu), cache `geocode_cache` podle souřadnic zaokrouhlených
  na ~100 m, max. 25 nových dotazů na jedno otevření (limit Apple).
  Bez sítě zůstanou souřadnice, obec se doplní příště.
- Deník: "50.08755,14.42139 · u Prahy" (i v exportu); průběh dne:
  "Neznámé místo · u Obce".
- NETRIVIÁLNÍ ROZHODNUTÍ - 2. pád ("u Tábora") podle nejčastějších
  koncovek (-ov/-ín/-ice/-ek/-ec/-ň/-a/-o...); víceslovné názvy se
  neskloňují ("· Karlovy Vary"). U méně obvyklých jmen může tvar
  vyjít nepřesně (např. "u Mosta").

### Migrace v1 (`PRAGMA user_version` 0 -> 1)

Číslované migrace přes `user_version` (`lib/db.ts ->
runVersionedMigrations`), každá jednou. Před první čekající migrací na
existující DB **záloha** `dochazka-zaloha-pred-opravami-2.db` (VACUUM
INTO, vedle `dochazka.db`; existující záloha se nepřepisuje, výsledek v
`settings.internal.backup_before_fixes_2`).

v1: nové sloupce (`visits.start_uncertain/deleted_by`,
`places.is_private` z `is_home`, `debug_log.delivered_at/
delivered_battery`), tabulky `location_events` a `geocode_cache`, časy
pobytů na UTC ISO, **přehrání CLVisit událostí z ladicího deníku** do
`location_events` (duplicity zmizí otiskem), staré automatické pobyty
z doby před deníkem -> umělé události příjezd/odjezd. Při startu pak
`finishLegacyVisitMigrationIfNeeded()` (ještě před UI): staré
automatické pobyty `is_deleted = 1, deleted_by = 'migration'`, nové z
přepočtu všech událostí. Ruční pobyty se nemění.

Ověřeno lokálně (`private/migration-test.ts`, napodobená DB s deníkem
z telefonu a poškozenými pobyty) - výsledek přesně podle zadání:
- Pá 2. 10.: místo #2 ?-20:23, přejezd 11 min, domov 20:34-24:00
- So 3. 10.: domov 0:00-6:49, přejezd, neznámé místo 7:06-16:50,
  přejezd, domov 17:08-24:00
- Ne 4. 10.: domov 0:00-14:32, přejezd 11 min, místo #2 14:43-probíhá
- záloha obsahuje všechna původní data, druhý start nic nezmění.

### Migrace v2 (`user_version` 1 -> 2) - skupiny B a C

Sloupce sazeb u `work_categories` (naplní se z `rate_type`/`rate_kc`),
`unit`/`rate_kc`/`surcharge_pct`/`source` u `day_work_records` (jednotka
a sazba podle kategorie, příplatek 0, source manual), tabulka
`day_work_records_removed`. **Úklid B2** (podle odpovědi na zadání): do
`day_work_records_removed` se PŘESUNOU (ne smažou) položky výchozího
stroje s výchozím množstvím od 2. 10. 2026 (`reason = 'auto_default'`) a
přesné duplicity (stejný den + stroj + množství, `reason = 'duplicate'`).
Ověřeno lokálně: 7× "Osobák 8 h" (i zdvojené, budoucí dny, neděle) pryč,
jiné položky a položky před 2. 10. zůstaly.

Pozor: přiřazení příjezdu k místu #2 vyžaduje poloměr místa aspoň
~60 m (CLVisit hlásil bod ~255 m od středu, tolerance je poloměr +
200 m). Při poloměru 50 m by se ukázalo "Neznámé místo".

### Co otestovat v telefonu (oprava 2)

Instalace jako dřív (Sideloadly, stejné Bundle ID -> data zůstanou).
**Appku před instalací NEMAŽ.** Při prvním spuštění proběhnou migrace
(záloha DB + přepočet pobytů) - start může trvat o chvilku déle.

1. **Pobyty 2.-4. 10.** (Detail dne): Pá - místo #2 "?–20:23", přejezd,
   domov 20:34–24:00; So - domov 0:00–6:49, přejezd, "Neznámé místo ·
   u <obec>" 7:06–16:50, přejezd, domov 17:08–24:00; Ne - domov
   0:00–14:32, přejezd, místo #2 14:43–… Domov tlumeně s ikonou domku.
   5. 10. a dál nic "probíhá". (Pokud by Pá/Ne místo #2 vyšlo jako
   "Neznámé místo", má místo poloměr pod ~60 m - zvětšit a pobyt se
   přepočítá.)
2. **Osobák 8 h** zmizel ze všech dnů od 2. 10. (i 9. a 25. 10.).
3. **Nový den**: otevření dne nic neuloží; "+ ZAPSAT DNEŠEK" / "+ Přidat"
   nabídne "VÝCHOZÍ POLOŽKY" (jen pracovní den, ne budoucí) - uloží se
   až "POUŽÍT VÝCHOZÍ".
4. **+ Přidat** -> stroj -> číselník + Hodiny/Dny/Km -> OK. Klepnutí na
   položku -> úprava / Smazat.
5. **Stroje a kategorie**: tři sazby, výchozí jednotka, příplatky
   (prázdné = výchozí). Klávesnice u ceny se zavře klepnutím kamkoliv do
   panelu, hodnota zůstane.
6. **Zápisy**: délka dne jde změnit (i na 0), výchozí příplatky víkend/
   svátek; v sobotu/neděli/svátek u položky "+X %".
7. **Kalendář**: víkendy tlumeně, svátky červeně (28. 10., 17. 11.,
   Vánoce); v detailu svátku jeho název.
8. **Poznámka ke dni**: jde psát, uloží se.
9. **Poloha a trasy**: časové okno jde změnit.
10. **Aplikace**: žádná hmatová odezva; "Větší" písmo -> appka se znovu
    načte a písmo je větší všude.
11. **Ladicí deník** (večer): žádné duplicitní PŘÍJEZD/ODJEZD, po startu
    appky jen jedno "úvodní stav po registraci, ignorováno" na místo (a
    jen když se změnila místa), body jen v průběžném režimu a v okně;
    u souřadnic "· u <obec>"; pozdě doručené "· doručeno později" +
    baterie doručení zvlášť. Export mi pošli jako dřív.

## DŮLEŽITÉ - co jsem NEMOHL ověřit sám (ČÁST B)

Nemám Mac ani iPhone - CLVisit/geofencing/background sledování se
nedá odzkoušet z WSL. Co jsem udělal pro co největší jistotu:
- TypeScript/JS strana: typecheck + lint bez chyby, JS bundle se
  úspěšně sestavil (Metro).
- Swift strana nativního modulu: NEMŮŽU lokálně zkompilovat (žádný
  Xcode) - jediný skutečný test je `xcodebuild` na GitHub Actions
  (macOS runner), což je přesně to, co se teď pustilo (viz níž).
- Co zbývá a může ověřit jen SKUTEČNÉ zařízení v terénu: jestli CLVisit
  opravdu vzbudí appku po zavření, jestli geofence enter/exit chodí
  spolehlivě, přesnost GPS v průběžném režimu. Na tohle slouží ladicí
  deník (ČÁST B bod 9) - exportuj ho mi, kdybys narazil na něco
  podezřelého.

## Test v terénu - co teď udělat a na co se dívat

Build je ověřený (viz Stav výše), appka je ke stažení jako nový `.ipa`
(návod na instalaci/aktualizaci přes Sideloadly níž v sekci "Jak appku
nainstalovat" - stejný postup, jen stáhni novou verzi z posledního
běhu Actions, run ID 37043119315).

### Co nastavit RÁNO (jednou, pak už to běží samo)

1. Otevři appku → **Nastavení → Poloha a trasy**.
2. Zapni **"Zaznamenávat trasy"**. Appka se zeptá na oprávnění k
   poloze - potvrď nejdřív "Při používání", pak až se appka zeptá
   znovu (nebo přes vyskakující červené upozornění v tomhle
   nastavení), potvrď i **"Vždy"** - bez něj appka nebude sledovat
   polohu, když ji zavřeš.
3. Zvol **režim**: pro běžný pracovní den dej **"Úsporný"** (šetří
   baterii, používá CLVisit/geofencing) - "Průběžný" je spíš na
   testování přesnosti, víc žere baterii.
4. Nastav **dny a časové okno** (např. Po-Pá, 6:00-19:00) - mimo tohle
   okno appka nic nezaznamená.
5. V **Nastavení → Aplikace** zapni **"Ladicí deník"** (pro první
   týdny testování - pak se může vypnout).
6. Přidej aspoň pár **Uložených míst** (Nastavení → Poloha a trasy →
   Uložená místa) - hlavně "Domov" a stavby, kde se dnes bude
   pracovat, přes "Zde jsem teď" nebo výběrem na mapě.
7. Appku pak klidně zavři (nebo i vypni telefon ze zámku) - sledování
   běží na pozadí.

### Co kontrolovat VEČER v Ladicím deníku

Nastavení → Aplikace → Zobrazit ladicí deník:

- **Objevily se vůbec nějaké záznamy?** Pokud je deník prázdný celý
  den, sledování na pozadí nefunguje (nejpravděpodobnější příčina:
  chybí oprávnění "Vždy", nebo appku mezitím někdo z telefonu
  odstranil/restartoval telefon bez dalšího spuštění appky).
- **Jsou tam příjezdy/odjezdy (CLVisit) k uloženým místům**, odpovídá
  jejich čas realitě (kdy jsi skutečně přijel/odjel)?
- **Odpovídá úroveň baterie u jednotlivých záznamů realitě** (orientačně,
  jestli sledování nezabíjí baterii nepřiměřeně rychle)?
- Jde appka po probuzení z pozadí (po "app wake" záznamu) normálně
  otevřít a reaguje?
- Pak v **Detailu dne** (ten konkrétní den) zkontroluj sekci
  **"PRŮBĚH DNE"** - jsou tam skutečné pobyty se správnými časy? Pokud
  ano, zkus tlačítko **"NAVRHNOUT Z POBYTŮ"** a porovnej navržený čas
  se skutečně odpracovanými hodinami.
- Kdyby něco vypadalo podezřele (chybí záznamy, špatné časy, appka
  padá), použij v Ladicím deníku **export** (ikona/tlačítko export) a
  pošli mi ten exportovaný soubor - z toho poznám, co se dělo.

Klidně to zkoušej i víc dní za sebou, než budeš appce věřit natolik,
že deník vypneš a začneš appce důvěřovat jako hlavnímu nástroji pro
evidenci docházky.

## ČÁST B - záznam míst (datový model a rozhodnutí)

### Nativní modul `modules/visit-monitor` (Expo Modules API, Swift)

`expo-location` nemá CLVisit ani "significant location changes" jako
samostatnou věc - proto malý lokální modul (`npx create-expo-module
--local`), jen 2 funkce párů (start/stop) + `drainPendingEvents`.

NETRIVIÁLNÍ ROZHODNUTÍ - "store-and-forward" fronta přes UserDefaults
(`ios/VisitMonitorModule.swift`): když iOS vzbudí appku na pozadí kvůli
CLVisit, JS bridge běží chvilku, než se stihnou zaregistrovat listenery
(`app/_layout.tsx` -> `initLocationTracking()`). Aby se v tom okně
nic neztratilo, KAŽDÁ událost se nejdřív uloží do UserDefaults a
TEPRVE POTOM zkusí poslat živě. JS si při startu zavolá
`drainPendingEvents()` a frontu vyprázdní - i to, co `sendEvent`
nestihl nikam doručit.

NETRIVIÁLNÍ ROZHODNUTÍ - žádné `nil`/`Any?` v datech pro UserDefaults:
plist serializace (na čem UserDefaults stojí) neumí Swift `nil` -
CLVisit reportuje `Date.distantPast`/`distantFuture` pro "neznámé
datum", převádí se na prázdný string `""`, ne na `nil` (viz
`modules/visit-monitor/src/VisitMonitor.types.ts`).

`OnCreate` (spustí se při KAŽDÉM startu JS runtime, i na pozadí) znovu
zapne monitoring podle vlajky v UserDefaults - `CLLocationManager`
samotný si mezi restarty procesu pamatuje, že má sledovat, ale
`delegate` (kam se posílají výsledky) je jen v paměti a musí se
nastavit znovu po každém startu.

### Datový model (`lib/db.ts`, `lib/types.ts`)

- `places` - uložená místa (název, souřadnice, poloměr 50-500m,
  `order_label` pro budoucí fakturaci, `is_home` - vyloučeno z
  "NAVRHNOUT Z POBYTŮ").
- `visits` - pobyty (místo NEBO `unknown_lat/lon` pro "Neznámé místo",
  začátek, konec - `NULL` = probíhá, `source`: clvisit/geofence/
  continuous/manual).
- `location_points` - body z průběžného režimu (prořezáváno po 14 dnech).
- `debug_log` - ladicí deník (prořezáváno po 14 dnech), zapíná/vypíná
  se centrálně v `addDebugLogEntry()` podle `settings.debugLogEnabled`.
- Měkké smazání u `places` (stejný důvod jako `work_categories` -
  staré pobyty by jinak ztratily jméno místa).

### Orchestrace (`lib/locationTracking.ts` + `lib/backgroundTasks.ts`)

Rozdělení do dvou souborů je záměrné: `expo-task-manager`
(geofencing, průběžné updaty) vyžaduje, aby `TaskManager.defineTask`
běžel v GLOBÁLNÍM scope modulu (ne v komponentě) - `backgroundTasks.ts`
proto obsahuje JEN tyhle definice a hned se importuje pro vedlejší
efekt na začátku `app/_layout.tsx`. Samotná logika (`handleVisitEvent`,
`handleGeofenceEvent`, `processContinuousLocationPoint`...) je v
`locationTracking.ts`, odkud ji oba volají.

- **Úsporný režim**: `VisitMonitor.startVisitMonitoring()` +
  `startSignificantLocationMonitoring()` + geofencing na nejbližších
  až 18 uložených místech (`refreshGeofences()`, limit iOS je 20).
  Significant location change přepočítá "nejbližších 18" znovu -
  zadání "obnovuj výběr při významné změně polohy".
- **Průběžný režim**: `Location.startLocationUpdatesAsync` s nízkou
  přesností a intervalem z Nastavení (5-10 min), z každého bodu se
  přímo odvodí pobyt (jsem/nejsem v okruhu nějakého místa) - bez
  CLVisitu, jak zadání chtělo.
- **Krátké pobyty** (< `settings.minStayMinutes`, výchozí 10 min) se
  po zavření hned měkce smažou (`closeVisitAndMaybeDiscard`) - stejná
  funkce na všech 3 cestách (CLVisit/geofence/continuous), ať se
  pravidlo neřeší trojmo.
- **Časové okno** (`isWithinTrackingWindow`) se neřeší vypínáním a
  zapínáním nativního sledování (zbytečně složité), ale filtrováním
  PŘI ZPRACOVÁNÍ události - sledování běží pořád, mimo okno se jen
  nic neuloží (ale do ladicího deníku ano, pro kontrolu).

### UI

- **Nastavení -> Poloha a trasy** (`app/settings/poloha.tsx`) - hlavní
  přepínač vyžádá nejdřív "Při používání", pak "Vždy" (`ensureLocation
  Permissions`); když "Vždy" chybí, appka to sledování i tak zapne,
  ale ukáže trvalé červené upozornění (appka na pozadí nic nezaznamená
  bez něj). Dny v týdnu, časové okno (HH:MM text), minimální délka
  pobytu, odkaz na Uložená místa - všechno skutečně funkční.
- **Uložená místa** (`app/settings/places.tsx` + `place-edit.tsx`) -
  JEDNA obrazovka pro oba vstupy ze zadání ("Zde jsem teď" i "výběr na
  mapě"): mapa (`expo-maps` -> `AppleMaps.View`) se otevře vycentrovaná
  na aktuální polohu (= "zde jsem teď"), klepnutím kamkoliv jinam se
  značka přesune (= "výběr na mapě"). Přepínač "Domov" vylučuje místo
  z návrhu hodin.
- **Detail dne - PRŮBĚH DNE** - skutečné pobyty, žlutý číslovaný
  čtvereček, čas od-do, délka. Klepnutím na pobyt -> modal s úpravou
  času (HH:MM) a mazáním. "Neznámé místo" -> "Uložit jako nové místo"
  (otevře `place-edit` s předvyplněnými souřadnicemi, po uložení se
  pobyt automaticky připojí). Mezi pobyty "Přejezd" (bez km, to je
  etapa 3).
- **NAVRHNOUT Z POBYTŮ** - sečte pobyty na nepracovních... pardon,
  PRACOVNÍCH místech (bez domova) za ten den, odečte přestávku a
  zaokrouhlí podle Nastavení -> Zápisy, a otevře stejný picker jako
  "+ Přidat stroj nebo práci" s předvyplněným množstvím - NEULOŽÍ SE
  nic, dokud nevybereš kategorii (zadání "návrh nic neuloží, dokud ho
  nepotvrdím").
- **Ladicí deník** (`app/settings/debug-log.tsx`, zapnutí v Nastavení
  -> Aplikace) - časová řada událostí + stav baterie, export přes
  `expo-sharing` do textového souboru (pro poslání).

### Oprávnění (`app.json`)

`NSLocationWhenInUseUsageDescription` +
`NSLocationAlwaysAndWhenInUseUsageDescription` (český text, vysvětluje
proč) + `UIBackgroundModes: location` - všechno přes `expo-location`
plugin config, ne ručně v Info.plist. `expo-task-manager` nemá vlastní
config plugin (nic k nastavení), proto v `app.json` není.

## Repozitář a sestavení (Etapa 2, ČÁST A)

- GitHub: **https://github.com/StarGrower/dochazka** (veřejný - viz
  níž proč, přihlášen jako `StarGrower` přes `gh auth login`).
- Větev `main`, `gh` CLI je nainstalované lokálně v
  `~/.local/bin/gh` (bez root práv, apt chtěl sudo heslo).
- Bundle ID: `cz.kalensky.dochazka` (potvrzeno).

### Proč veřejný repozitář

GitHub Actions je u veřejných repozitářů ÚPLNĚ zdarma, bez limitu na
minuty, i na macOS runneru. U soukromého by GitHub Free dával 2000
minut/měsíc zdarma, ale macOS runner je účtuje 10× - reálně tedy
~200 minut měsíčně, což je podle délky sestavení (10-25 min) zhruba
8-20 sestavení/měsíc zdarma. Rozhodli jsme se pro veřejný - v repozitáři
není nic citlivého (jen kód appky pro osobní použití).

### GitHub Actions workflow (`.github/workflows/build-ios.yml`)

Spouští se automaticky při pushi do `main` (kromě pushů, které mění
jen `.md` soubory - `paths-ignore`, aby úprava poznámek nespotřebovala
build minuty zadarmo), nebo ručně (záložka Actions → "Build unsigned
iOS .ipa" → "Run workflow"). Kroky: `expo
prebuild --platform ios` → `pod install` → `xcodebuild` v Release
konfiguraci s `CODE_SIGNING_ALLOWED=NO` (JS bundle se zabalí dovnitř
automaticky, díky Release konfiguraci - appka pak běží bez počítače) →
zabalení `.app` do `Payload/` → `.ipa` → nahráno jako artifact
(`Dochazka-unsigned-ipa`, 14 dní). Cache pro `node_modules`
(klíč podle `package-lock.json`) a `ios/Pods` (klíč podle
vygenerovaného `ios/Podfile`).

NETRIVIÁLNÍ ROZHODNUTÍ - proč se v workflow objevuje "Dochzka", ne
"Dochazka": `expo prebuild` odvozuje název Xcode projektu/schématu
z `app.json` "name" ("Docházka") a při převodu na ASCII diakritiku i
písmeno za ní prostě VYPUSTÍ, místo aby ji přepsalo na "a" - vyšlo
"Dochzka" (ověřeno lokálním prebuildem). Na zobrazovaný název appky
pod ikonkou (`CFBundleDisplayName`) to vliv nemá, zůstává "Docházka" -
jde jen o vnitřní technické jméno projektu/schématu/workspace, které
`xcodebuild` potřebuje přesně.

### Jak appku nainstalovat (Sideloadly)

1. Na GitHubu → záložka **Actions** → poslední úspěšný běh "Build
   unsigned iOS .ipa" → dole **Artifacts** → stáhni
   `Dochazka-unsigned-ipa.zip` → rozbal → uvnitř je
   `Dochazka-unsigned.ipa`.
2. Stáhni a nainstaluj [Sideloadly](https://sideloadly.io/) (Windows).
3. Připoj iPhone k počítači kabelem, na iPhonu potvrď "Důvěřovat
   tomuto počítači".
4. V Sideloadly: vyber stažené `.ipa`, zadej svoje Apple ID.
   - **Pokud máš na Apple ID dvoufaktorové ověření** (asi ano) - NEZADÁVEJ
     normální heslo, ale vytvoř si **heslo pro aplikaci** na
     https://appleid.apple.com → Zabezpečení → Hesla pro aplikace, a
     zadej tohle vygenerované heslo do Sideloadly.
   - Sideloadly si přes tvoje Apple ID vyžádá bezplatný vývojářský
     certifikát (žádné roční předplatné) a appku jím podepíše.
5. Po instalaci na iPhonu: **Nastavení → Obecné → VPN a správa
   zařízení** → najdi profil se svým Apple ID → **Důvěřovat**.
6. Při prvním spuštění appka odmítne jít otevřít, dokud nezapneš
   **Režim pro vývojáře**: Nastavení → Soukromí a zabezpečení →
   Režim pro vývojáře → zapnout → telefon se restartuje → při dalším
   odemčení potvrdit zapnutí.
7. Teď appka běží normálně, bez počítače a bez Wi-Fi/tunelu.

### Po 7 dnech - znovu podepsat BEZE ztráty dat

Certifikát z bezplatného Apple ID platí jen 7 dní - appka pak
přestane jít otevřít ("Nelze ověřit appku"). Řešení je rychlé:

1. Spusť Sideloadly znovu, vyber **ten samý** `.ipa` soubor (není
   potřeba stahovat nový, pokud jsi appku mezitím neaktualizoval) a
   stejné Apple ID.
2. Nainstaluje se znovu (přepíše se) - **data v appce (SQLite)
   zůstanou zachovaná**, protože se nic nemaže, jen se appka přepíše
   novým podpisem se stejným Bundle ID.
3. **Důležité pravidlo: appku mezi tím NIKDY nemaž z telefonu** (ani
   gestem, ani přes Nastavení) - smazání appky smaže i její data.
   Jen čekej na "Unable to Verify App" a znovu ji přes Sideloadly
   přeinstaluj.

Když budeš chtít NOVOU verzi appky (po další etapě vývoje), stáhni
nový `.ipa` z GitHubu a sideloaduj ten - Bundle ID zůstává stejné,
data se zachovají i při přechodu na novou verzi.

## Test na iPhonu - 3 části (oprava klávesnice, barvy, přestavba Nastavení)

### ČÁST 1 - klávesnice nejde zavřít

Příčina: numerická klávesnice (`keyboardType="decimal-pad"`) na iOS NEMÁ
žádné tlačítko Hotovo/Return - jediná cesta ven je vlastní
`InputAccessoryView`. Navíc předchozí modaly (`<Modal>`) se neuměly
posunout nad klávesnici a klepnutí "mimo" nic nedělalo.

Oprava:
- `components/KeyboardDoneAccessory.tsx` - JEDNA globální lišta
  "HOTOVO" nad klávesnicí, mountovaná jednou v `app/_layout.tsx`.
  Každý číselný `TextInput` v appce na ni odkazuje přes
  `inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}`.
- `components/BottomSheetModal.tsx` - náhrada za `<Modal>` (vlastní
  absolutně umístěný overlay, ne nativní RN Modal - ten má na iOS
  known issues s klávesnicí). Umí `KeyboardAvoidingView` (karta se
  posune nad klávesnici) a klepnutí mimo kartu zavře klávesnici.
- Použito v Nastavení -> Stroje a kategorie a v Detailu dne (picker).

### ČÁST 2 - barvy kategorií (DOPLNĚNO podle upřesněného zadání)

- `theme.ts` -> `categoryPalette` - 16 barev (dřív 4), dobře
  rozlišitelné na tmavém pozadí `#131311`.
- `components/ColorPicker.tsx` - mřížka 2×8 (ne flexWrap - pevně
  rozdělené řádky s `flex:1` + `maxWidth` stropem na čtvereček, ať se
  i na úzkém telefonu vejde přesně 8 na řádek), vybraná = žlutý rámeček.
- Tlačítko "VLASTNÍ ODSTÍN" otevře opravdový výběr barvy přes knihovnu
  **`reanimated-color-picker`** (čistě JS, funguje v Expo Go, instalace
  `npx expo install react-native-gesture-handler reanimated-color-picker`
  - gesture-handler vyžaduje `GestureHandlerRootView` kolem celé appky,
    doplněno do `app/_layout.tsx`).
  Uvnitř: `Panel1` (pole sytost/jas) + `HueSlider` (posuvník odstínu) +
  `Preview` (náhled) + hex pole JEN jako doplňkový vstup (obousměrně
  propojený s pickerem přes `ColorPickerRef.setColor`).
- Poslední použité VLASTNÍ barvy (ne paletové) se dál ukládají do
  `AppSettings.recentCustomColors` (max 6, nejnovější první) a nabízí
  se jako řádek "NAPOSLEDY POUŽITÉ" pod paletou.

### ČÁST 3 - přestavba Nastavení

`app/(tabs)/nastaveni.tsx` je teď jen rozcestník (`SettingsRow`), obsah
žije v `app/settings/*.tsx` (vlastní trasy, šipka zpět přes
`ScreenHeader`):

- `categories.tsx` - STROJE A KATEGORIE (přesunuto z dřívějšího
  Nastavení, + ČÁST 1/2 oprava, + nové pole `kind` "typ stroj/práce" -
  čistě informační, jen jiná ikona na řádku).
- `zapisy.tsx` - ZÁPISY, VŠECHNO skutečně použité (viz níž).
- `poloha.tsx` - POLOHA A TRASY, zadáním výslovně chtěné jako náhled s
  "PŘIPRAVUJEME" - ovládací prvky jsou disabled, žádná logika za nimi.
- `aplikace.tsx` - APLIKACE (viz NETRIVIÁLNÍ ROZHODNUTÍ v souboru -
  formát času a velikost písma se ukládají, ale vizuální efekt zatím
  nemají, viz níž).
- `odberatele.tsx` - MOJE ÚDAJE A ODBĚRATELÉ, "PŘIPRAVUJEME" (fakturace).

**Nastavení "Zápisy" se SKUTEČNĚ používají** (zadání to vyžadovalo
explicitně), viz `lib/workCalc.ts` a `app/day/[date].tsx`:
- Výchozí délka dne + automatické odečtení přestávky -> výchozí
  množství u NOVÉ hodinové položky.
- Krok číselníku -> +/- tlačítka v novém `components/NumPad.tsx`.
- Zaokrouhlení -> aplikuje se na RUČNĚ přepsanou hodnotu v NumPadu
  (ne na krokování +/-, to už je čisté číslo podle kroku).
- Výchozí položky nového dne -> `applyDayDefaultsIfNeeded()`, spustí se
  JEN při první návštěvě prázdného dne (viz `day_initialized` tabulka
  v `lib/db.ts` - jinak by se vracely položky po úmyslném smazání).
- Poznámka povinná -> při odchodu z prázdné poznámky se zeptá, jestli
  opravdu odejít.

**NETRIVIÁLNÍ ROZHODNUTÍ - co má a nemá VIZUÁLNÍ efekt v Aplikace:**
- "První den týdne pondělí" - SKUTEČNĚ ovládá `MonthGrid` (kalendář).
- "Hmatová odezva" - zapojená v NumPadu a uložení/mazání (Detail dne,
  Stroje a kategorie) - ne úplně všude v appce.
- "Formát času 24h" - ukládá se, ale appka nikde nezobrazuje čas
  hodin:minut (není z čeho formátovat) - bez efektu, dokud to etapa 3
  nepřinese (časy příjezdu/odjezdu).
- "Velikost písma" - ukládá se, ale NENÍ zapojené vizuálně. Důsledné
  škálování by znamenalo upravit fontSize ve všech obrazovkách najednou
  - udělat to jen na části appky by vypadalo jako bug (nekonzistentní),
  tak jsem to raději nedodělal napolo. Dej vědět, jestli na tom trváš a
  najdu čas to udělat pořádně všude najednou.

**SQLite migrace** - stejný bezpečný vzor jako barva v etapě "A ·
Stavba" (`PRAGMA table_info` + `ALTER TABLE` jen když sloupec/tabulka
chybí) - nic z toho, co sis už zadal v telefonu, se nesmaže.

**"Smazat všechna data"** (Nastavení -> Aplikace) je FUNKČNÍ (dvojité
potvrzení, červeně) - smaže vše a vrátí výchozí 3 kategorie, jako
čerstvá instalace.

### Jednotné zadávání čísel (dotaz z testu)

Sazba v Nastavení -> Stroje a kategorie teď používá STEJNÝ
`components/NumPad.tsx` jako hodiny/dny v Detailu dne (+/- tlačítka,
tap-to-type s globální klávesnicovou lištou) - jen jiný krok (10 Kč
místo 0,25/0,5/1 h, viz `RATE_STEP_KC` v `app/settings/categories.tsx`).

### OPRAVA - "nejde upravit stroje/práci, ani přidat"

Skutečná chyba (ne jen vzhled). `components/BottomSheetModal.tsx` (viz
ČÁST 1 výš) byl vlastní `<View>` s `position: absolute` místo
nativního `<Modal>` - tenkrát záměrně, kvůli klávesnici. Měl ale dvě
vady:

1. Byl obalený navíc v `<View style={!visible && styles.hidden}>` -
   ten obal neměl žádný rozměr a jeho jediné dítě bylo `position:
   absolute`. V RN se absolutní pozice počítá vůči rozměru
   NEJBLIŽŠÍHO rodiče, a protože se absolutně pozicované děti
   nezapočítávají do výpočtu velikosti rodiče, obal vycházel 0×0 -
   celý modal se vykresloval s nulovou velikostí (neviditelný,
   nekliknutelný), i když se stav (`visible`) správně měnil.
2. I po opravě týhle konkrétní vady by zůstal druhý problém:
   "VLASTNÍ ODSTÍN" (ČÁST 2) se otevírá VNOŘENĚ uvnitř karty editace
   kategorie - vlastní `position: absolute` se počítá jen vůči
   NEJBLIŽŠÍMU rodiči, takže vnitřní modal by se omezil na rozměr
   vnější karty, ne na celou obrazovku.

**Řešení: zpátky na nativní `<Modal transparent>`** - ten renderuje do
samostatného okna, takže funguje správně i při vnoření (modal v
modalu). Oprava klávesnice (globální "Hotovo" lišta,
`KeyboardAvoidingView`, zavření dotykem mimo kartu) na tomhle vůbec
nezávisela, zůstala stejná.

### Vysvětlení "failed" smoke testu z minula

Hlášení "Final smoke-test dev server start … failed with exit code 1"
NEBYLA chyba v projektu - v logu je vidět, že server naběhl, Metro
úspěšně sestavil iOS bundle (1770 modulů, žádná chyba), a `exited with
code 1` je jen důsledek toho, že jsem ho sám ukončil (`pkill`) po
ověření, že bundle je v pořádku - standardní úklid po smoke testu, ne
pád aplikace.

## Vizuální styl "A · Stavba"

Appka je od teď VŽDY tmavá (`app.json` -> `"userInterfaceStyle": "dark"`),
bez ohledu na nastavení telefonu - viz zadání "tím zároveň odpadnou
problémy s bílým textem na bílém pozadí".

### `theme.ts` - jediný zdroj barev/písem/rozměrů

Žádná barva napevno v komponentách - všude se importuje z `theme.ts`
(`colors`, `fonts`, `radii`, `categoryPalette`, `MIN_TOUCH`). Písmo
Barlow/Barlow Condensed (`@expo-google-fonts/barlow*`), načítá se v
`app/_layout.tsx`.

### NETRIVIÁLNÍ ROZHODNUTÍ - zrušen starší systém pro světlý/tmavý režim

Protože appka je teď VŽDY tmavá, ztratil smysl dřívější
`components/Themed.tsx` + `useColorScheme` + `constants/Colors.ts`
(přepínání podle systému) - smazáno, nahrazeno plochým `theme.ts`.
Zjednodušení, ne jen kosmetika - jinak by v kódu zůstaly dvě souběžné,
matoucí cesty, jak se dostat k barvě.

### NETRIVIÁLNÍ ROZHODNUTÍ - vlastní `components/MonthGrid.tsx` namísto `react-native-calendars`

Požadovaný vzhled dne (plná karta vs. čárkovaný okraj, 35% průhlednost
pro jiný měsíc, žluté dnešní pozadí) nešel rozumně dosáhnout přes theme
API téhle knihovny - `react-native-calendars` je odinstalovaný,
měsíční mřížka (výpočet dní/offsetu) je vlastních ~40 řádků v
`components/MonthGrid.tsx`.

### NETRIVIÁLNÍ ROZHODNUTÍ - barva kategorie je nové DB pole (migrace)

Zadání chce barevné rozlišení kategorií/strojů, volitelné v Nastavení
(`theme.ts` -> `categoryPalette`, 4 barvy). To je nové pole
`work_categories.color`, které v etapě 1 ještě neexistovalo - `lib/db.ts`
má `migrateAddCategoryColor()`, co při startu zjistí (`PRAGMA
table_info`), jestli sloupec chybí, a pokud ano, přidá ho (`ALTER
TABLE`) a existujícím řádkům přiřadí barvy z palety podle pořadí.
Funguje i na telefonu, kde už něco je uložené z dřívějšího testování
etapy 1 - žádná ztráta dat.

### NETRIVIÁLNÍ ROZHODNUTÍ - "upravit"/"hotovo" přepínač v Detailu dne

Zadání popisuje v záhlaví Detailu dne tlačítko "upravit" - bez
časové osy/mapy (ty jsou až v etapě 3) by ale nemělo co přepínat.
Rozhodl jsem, že "upravit" přepíná PRÁCE A STROJE mezi čistým
výpisem (karty, žádné vstupy - jak design ukazuje) a editačním
režimem (vstupní pole na množství, mazání, tlačítko "+ Přidat stroj
nebo práci"). Výchozí stav po otevření dne je čistý výpis.

### Co ze zadání designu ZATÍM NENÍ (patří do pozdějších etap)

- **Mapa + "PRŮBĚH DNE"** (zastávky, přejezdy) v Detailu dne - potřebuje
  záznam polohy (etapa 3). Místo toho je tam jen krátká poznámka, že
  to přibude. Jakmile se etapa 3 postaví, bude se řídit stejnou
  specifikací barev (žlutá trasa, žluté čtverečky zastávek).
- **Záložky "Místa" a "Export"** v dolní liště - přibydou v etapách 2 a
  4. Design (žlutá aktivní záložka, stejné ikony/fonty jako teď) je
  zachycený v zadání, nemusí se znovu promýšlet.
- **"Najeto km" karta v kalendáři** - zobrazuje se, ale vždy 0 km, dokud
  etapa 3 nezačne počítat skutečné přejezdy.

## Prostředí

- Projekt žije v `E:\Dochazka` (na Windows), Claude Code k němu přistupuje
  přes WSL2 jako `/mnt/e/Dochazka`.
- Node.js v22, npm 9, Git - už byly nainstalované, nic se neinstalovalo.
- Expo SDK 57, TypeScript, Expo Router (file-based routing v `app/`),
  React 19 / React Native 0.86.
- **Watchman není nainstalovaný** (volitelné, jen zrychluje sledování
  změn souborů). Pokud by bylo hot-reload nápadně pomalé, dá se doinstalovat.

### Důležité: síť WSL2 a testování na telefonu

WSL2 na tomhle počítači běží v NAT režimu - má JINOU IP adresu než
Windows (`172.21.x.x` vs. LAN `192.168.0.108`). Telefon na stejné WiFi
by se proto přes běžný "LAN" režim Expo Go k vývojovému serveru
nepřipojil (Windows sice umí přesměrovat `localhost`, ale ostatní
zařízení v síti ne).

**Řešení: `npx expo start --tunnel`** - vytvoří veřejný tunel (přes
bezplatný ngrok), na který se telefon připojí odkudkoliv, bez ohledu na
síť. Trochu pomalejší reload, ale funguje spolehlivě a nic nestojí.

Pokud by to časem vadilo, jde to vyřešit i natrvalo přepnutím WSL2 do
"mirrored" síťového režimu (sdílí síť s Windows) - vyžaduje úpravu
`C:\Users\<uživatel>\.wslconfig` a `wsl --shutdown`. Zatím neuděláno,
protože je to systémová změna mimo tenhle projekt - řeknu předem, kdyby
na to došlo.

## Datový model (SQLite, `lib/db.ts`)

### NETRIVIÁLNÍ ROZHODNUTÍ - "kategorie prací" a "stroje" = jedna tabulka

Zadání mluví o "kategoriích prací (Tatra, bagr, ruční práce)" a hned
pod tím o "přidání dalších strojů ze seznamu strojů" - Tatra a bagr
JSOU stroje, takže jde o jeden a týž seznam, ne dva oddělené. V DB je
to tabulka `work_categories` (id, name, rate_type, rate_kc, sort_order,
is_deleted) - jeden ceník pro cokoliv, co se dá ke dni přiřadit.

### NETRIVIÁLNÍ ROZHODNUTÍ - smazání kategorie je měkké

`is_deleted = 1`, ne smazání řádku - staré denní záznamy na kategorii
pořád odkazují (kvůli historii/výkazu za minulé měsíce). Smazaná
kategorie zmizí z nabídky při přidávání NOVÉ položky, ale v už
existujících dnech se dál zobrazí (s poznámkou "(smazáno)" v detailu dne).

### NETRIVIÁLNÍ ROZHODNUTÍ - "quantity" je jedno obecné číslo

`day_work_records.quantity` znamená hodiny NEBO dny/půldny podle toho,
jaký `rate_type` má navázaná kategorie - jeden sloupec místo dvou
věčně poloprázdných.

### Tabulky (etapa 1)

- `work_categories` - kategorie/stroje + sazba (hodinová/denní).
- `day_notes` - poznámka ke dni (date je primární klíč, TEXT `YYYY-MM-DD`).
- `day_work_records` - položky práce za den (den, kategorie, množství).

### Plánované tabulky (další etapy, ZATÍM NEEXISTUJÍ)

Aby šla později doplnit fakturace (viz zadání), počítám dopředu s:

- `places` (etapa 2) - id, name, radius_m, lat, lon, + `client_id` a
  `order_id` (NULL zatím, obsadí se, až/pokud přibude fakturace).
- `clients` (odběratel) - name, ico, dic, address - až bude potřeba.
- `orders` (zakázka) - name, client_id - až bude potřeba.
- `visits`/`trips` (etapa 3) - záznamy pobytu na místě a přejezdů
  (CLVisit-like), z nich se bude počítat km a navrhovat odpracovaný čas.
- `rate_kc_per_km` - asi jako jedno globální nastavení, ne per-kategorie
  (upřesní se v etapě 3).

Tohle je jen orientační poznámka pro budoucí etapy, ŽÁDNÁ z těchto
tabulek zatím v kódu není - podle zadání se má postupovat po etapách a
nepředbíhat.

### Součet hodin v kalendáři

Zadání: "u každého dne součet hodin". Sčítají se jen položky s
`rate_type = 'hourly'` - denní/půldenní položky (`'daily'`) se do hodin
nedají bez dalšího předpokladu převést, zobrazují se v kalendáři i
detailu dne VEDLE jako doplňkový údaj (např. "6,5 h + 1 d"). Pokud si
to představuješ jinak (např. denní položku počítat jako pevný počet
hodin), dej vědět a přepočet upravím.

### "Aplikace navrhne odpracovaný čas podle pobytu na místě"

Tahle část zadání (bod 3, poslední odrážka) potřebuje záznam polohy
(etapa 3) - bez něj není z čeho navrhovat. V etapě 1 proto tlačítko
"navrhnout" vůbec není (raději žádné tlačítko než neživé/mrtvé).

## Struktura projektu

```
theme.ts                   - barvy/písma/rozměry (vizuální styl "A · Stavba")
metro.config.js            - .wasm asset ext (jen pro expo-sqlite web, iOS nedotčeno)
app/
  _layout.tsx              - root layout: fonty, SQLite (initDb), vždy-tmavé téma
  (tabs)/
    _layout.tsx            - dolní záložky: Kalendář, Nastavení (Místa/Export přijdou)
    index.tsx              - KALENDÁŘ
    nastaveni.tsx           - NASTAVENÍ - správa kategorií/strojů + barva
  day/[date].tsx            - DETAIL DNE - rozpis práce, poznámka, upravit/hotovo
components/
  MonthGrid.tsx             - vlastní měsíční mřížka (bez react-native-calendars)
lib/
  db.ts                     - SQLite schema + migrace + CRUD funkce
  types.ts                  - sdílené TS typy
  format.ts                 - české formátování data/hodin/Kč
```

## Jak vyzkoušet (Expo Go)

1. Na počítači ve složce `E:\Dochazka` spusť (v obyčejném Windows
   terminálu, nebo přes `wsl` - kterýkoliv funguje):
   ```
   npx expo start --tunnel
   ```
   První spuštění může požádat o instalaci `@expo/ngrok` - potvrď.
2. Počkej, až se objeví QR kód v terminálu.
3. V telefonu nainstaluj appku **Expo Go** (App Store, zdarma).
4. V Expo Go naskenuj QR kód (nebo zvol "Enter URL manually" a zadej
   adresu `exp://...`, která se vypíše pod QR kódem).
5. Co zkontrolovat (vzhled "A · Stavba"):
   - Appka je tmavá hned od spuštění, i kdyby měl telefon světlý režim.
   - **Kalendář** - šipky ‹› nahoře, VERZÁLKOVÝ název měsíce, tři karty
     (odpracováno žlutě, najeto km = vždy 0 zatím, počet pracovních dní),
     mřížka Po-Ne, dnešní den žlutě, žluté tlačítko "+ ZAPSAT DNEŠEK" dole.
   - Klepni na den -> **Detail dne**: záhlaví "ÚT 1. ŘÍJEN" + hodiny,
     tlačítko "UPRAVIT" vpravo nahoře. Zkus přidat položku (jen v
     editačním režimu), zadej množství, přepni na "HOTOVO" - položky by
     měly vypadat jako čisté karty s barevným čtverečkem.
   - **Nastavení** - u kategorie zkus změnit barvu (4 kolečka), ověř že
     se barva propsala na kartu i do Detailu dne.
   - Zkontroluj dotykové plochy (šipky, tlačítka) - nemělo by nic
     působit "narvaně" nebo těžko zmáčknutelně.
   - Zavři a znovu otevři appku - ověř, že stará data (pokud jsi něco
     zadal už dřív v etapě 1) zůstala a kategorie mají přiřazené barvy
     (automatická migrace, viz výš).

Napiš, co sedí a co ne (barvy, rozměry, chování "upravit" přepínače) -
pak navážu etapou 2 (uložená místa).
