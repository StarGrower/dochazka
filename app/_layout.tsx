import { Barlow_400Regular, Barlow_600SemiBold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import KeyboardDoneAccessory from '@/components/KeyboardDoneAccessory';
import { colors } from '@/theme';
import { initDb } from '@/lib/db';

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

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_600SemiBold,
    BarlowCondensed_700Bold,
  });
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<Error | null>(null);

  useEffect(() => {
    initDb()
      .then(() => setDbReady(true))
      .catch((err) => setDbError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (fontError) throw fontError;
    if (dbError) throw dbError;
  }, [fontError, dbError]);

  const ready = fontsLoaded && dbReady;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    // react-native-gesture-handler (potřebuje reanimated-color-picker,
    // ČÁST 2 - vlastní odstín) vyžaduje tenhle wrapper NAD celou appkou,
    // ne jen kolem obrazovky, co gesta používá.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navigationTheme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="day/[date]" />
          <Stack.Screen name="settings/categories" />
          <Stack.Screen name="settings/zapisy" />
          <Stack.Screen name="settings/poloha" />
          <Stack.Screen name="settings/aplikace" />
          <Stack.Screen name="settings/odberatele" />
        </Stack>
        {/* Globální "Hotovo" lišta nad číselnou klávesnicí (ČÁST 1 oprava) -
            mountuje se JEDNOU tady, viz components/KeyboardDoneAccessory.tsx. */}
        <KeyboardDoneAccessory />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
