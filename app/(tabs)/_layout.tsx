// Dolní lišta (vizuální směr "A · Stavba"): Kalendář / Zakázky (etapa 5)
// / Stroje (etapa 6) / Nastavení - podle předlohy zakázek.

import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';

import { colors, fonts, fs } from '@/theme';

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
          fontSize: fs(11),
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
        name="zakazky"
        options={{
          title: 'Zakázky',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'briefcase', android: 'work', web: 'work' }} tintColor={color} size={26} />
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
