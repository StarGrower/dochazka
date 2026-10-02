# Docházka - poznámky k projektu

Osobní iPhone aplikace pro evidenci docházky, práce a strojů na stavbách.
Vyvíjí se na Windows/WSL2 (bez Macu), bez placených služeb.

## Stav

**Etapa 1 (kalendář, ruční zápis hodin, kategorie/stroje se sazbami) - HOTOVO.**
**Vizuální styl "A · Stavba" - HOTOVO.**
**Test na iPhonu, 3 části (klávesnice, barvy, přestavba Nastavení) - HOTOVO, čeká na otestování.**

- Etapa 2 (uložená místa) - nezačato.
- Etapa 3 (přejezdy, mapa, km, záznam polohy na pozadí) - nezačato.
- Etapa 4 (export, záloha) - nezačato.

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
   "VLASTNÍ ODSTÍN" (ČÁST 2) se otevírá VNOŘENĖ uvnitř karty editace
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

- **Mapa + "PRŮBĖH DNE"** (zastávky, přejezdy) v Detailu dne - potřebuje
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
