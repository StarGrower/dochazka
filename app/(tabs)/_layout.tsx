// Dolní lišta (vizuální směr "A · Stavba") - zatím jen 2 ze 4 záložek
// ze zadání (Kalendář, Nastavení). "Místa" (etapa 2) a "Export" (etapa
// 4) přibudou ve svých etapách - viz POZNAMKY.md, design pro ně je
// zachycený, ať se při jejich stavbě nemusí vymýšlet znovu.

import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';

import { colors, fonts } from '@/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.bodySemiBold,
          fontSize: 11,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Kalendář',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'calendar', android: 'calendar_today', web: 'calendar_today' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="nastaveni"
        options={{
          title: 'Nastavení',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
              tintColor={color}
              size={26}
            />
          ),
        }}
      />
    </Tabs>
  );
}
