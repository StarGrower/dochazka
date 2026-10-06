import { Barlow_400Regular, Barlow_600SemiBold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import Storage from 'expo-sqlite/kv-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
// Definice background tasků (geofencing, průběžný režim) - musí běžet
// v globálním scope, co nejdřív, i při probuzení appky na pozadí (viz
// lib/backgroundTasks.ts). Import jen pro vedlejší efekt.
import '@/lib/backgroundTasks';

import IntroAnimation from '@/components/IntroAnimation';
import KeyboardDoneAccessory from '@/components/KeyboardDoneAccessory';
import { colors, FONT_SCALE_STORAGE_KEY } from '@/theme';
import { backupBeforeMigration } from '@/lib/backup';
import { getSettings, initDb, setPreMigrationHook } from '@/lib/db';
import { initLocationTracking } from '@/lib/locationTracking';
import { setNavigationReady } from '@/lib/reminders';
import { finishLegacyVisitMigrationIfNeeded } from '@/lib/visits';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Appka je VŽDY tmavá (viz app.json "userInterfaceStyle": "dark") -
// vlastní paleta navázaná na react-navigation DarkTheme, ne přepínání
// podle systému (useColorScheme/Themed.tsx bylo kvůli tomu smazáno).
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.card,
    text: colors.text,
    border: colors.border,
  },
};

// Prevent the splash screen from auto-hiding before asset loading (fonty
// + inicializace SQLite databáze, viz useEffect níž) je hotová.
SplashScreen.preventAutoHideAsync();

// Úvodní animace jen při spuštění uživatelem - když iOS appku probudí na
// pozadí kvůli poloze, proces startuje ve stavu 'background' a animace
// se nespouští (a nikdy by ji nikdo neviděl).
const launchedInForeground = AppState.currentState !== 'background';

// Etapa 4: před každou migrací DB i šifrovaná záloha do složky v Souborech.
setPreMigrationHook(backupBeforeMigration);

// Velikost písma se čte synchronně z kv-store (theme.ts) - po obnově
// zálohy ji dorovnat z nastavení v DB (projeví se při dalším startu).
async function syncFontScaleStorage(): Promise<void> {
  try {
    const { fontScale } = await getSettings();
    if (Storage.getItemSync(FONT_SCALE_STORAGE_KEY) !== fontScale) Storage.setItemSync(FONT_SCALE_STORAGE_KEY, fontScale);
  } catch {
    // nevadí
  }
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_600SemiBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
  });
  const [showIntro, setShowIntro] = useState(launchedInForeground);
  const finishIntro = useCallback(() => setShowIntro(false), []);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<Error | null>(null);

  useEffect(() => {
    initDb()
      // Oprava 2: přepočet pobytů po migraci - ještě před prvním
      // zobrazením, ať Detail dne neukáže staré (poškozené) pobyty.
      .then(() => finishLegacyVisitMigrationIfNeeded())
      .then(() => syncFontScaleStorage())
      .then(() => setDbReady(true))
      // initLocationTracking je "best effort" - chyba v ní (např. appka
      // běží v Expo Go, kde nativní modul neexistuje) nesmí appce
      // zabránit nastartovat, proto samostatný .catch (ne společný s initDb).
      .then(() => initLocationTracking().catch(() => {}))
      .catch((err) => setDbError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (fontError) throw fontError;
    if (dbError) throw dbError;
  }, [fontError, dbError]);

  const ready = fontsLoaded && dbReady;

  // Navigace existuje -> "Upravit v aplikaci" z upozornění může otevřít den.
  useEffect(() => {
    if (ready) setNavigationReady();
  }, [ready]);

  // S úvodní animací se nativní splash (statická značka na #131311)
  // schová hned po fontech - animace pak běží souběžně s načítáním DB.
  useEffect(() => {
    if (showIntro ? fontsLoaded : ready) {
      SplashScreen.hideAsync();
    }
  }, [showIntro, fontsLoaded, ready]);

  if (!fontsLoaded || (!ready && !showIntro)) {
    return null;
  }

  return (
    // react-native-gesture-handler (potřebuje reanimated-color-picker,
    // ČÁST 2 - vlastní odstín) vyžaduje tenhle wrapper NAD celou appkou,
    // ne jen kolem obrazovky, co gesta používá.
    // Úvodní animace je VŽDY na stejném místě stromu (poslední dítě) -
    // dokončení načítání DB ji tak nepřemountuje a nezačne znovu.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      {ready && (
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="day/[date]" />
            <Stack.Screen name="settings/categories" />
            <Stack.Screen name="settings/zapisy" />
            <Stack.Screen name="settings/poloha" />
            <Stack.Screen name="settings/places" />
            <Stack.Screen name="settings/place-edit" />
            <Stack.Screen name="settings/aplikace" />
            <Stack.Screen name="settings/debug-log" />
            <Stack.Screen name="settings/odberatele" />
            <Stack.Screen name="settings/zaloha" />
            <Stack.Screen name="settings/stav" />
            <Stack.Screen name="settings/pripominky" />
            <Stack.Screen name="settings/vykaz" />
            <Stack.Screen name="settings/pracovnici" />
            <Stack.Screen name="order/[id]" />
            <Stack.Screen name="order/edit" />
            <Stack.Screen name="order/assign" />
            <Stack.Screen name="machine/[id]" />
            <Stack.Screen name="machine/edit" />
            <Stack.Screen name="fuel/edit" />
            <Stack.Screen name="fuel/stock" />
            <Stack.Screen name="logbook" />
          </Stack>
          {/* Globální "Hotovo" lišta nad číselnou klávesnicí (ČÁST 1 oprava) -
              mountuje se JEDNOU tady, viz components/KeyboardDoneAccessory.tsx. */}
          <KeyboardDoneAccessory />
        </ThemeProvider>
      )}
      {showIntro && <IntroAnimation ready={ready} onFinish={finishIntro} />}
    </GestureHandlerRootView>
  );
}
