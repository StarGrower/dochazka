// ČÁST 3 - Nastavení je teď rozcestník (vizuální směr "A · Stavba"),
// obsah jednotlivých sekcí žije ve vlastních podobrazovkách pod
// app/settings/*.tsx (šipka zpět, stejný styl).

import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import SettingsRow from '@/components/SettingsRow';
import { colors, fonts } from '@/theme';

export default function SettingsHubScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.screenTitle}>NASTAVENÍ</Text>

      <View style={styles.list}>
        <SettingsRow
          icon="wrench.and.screwdriver"
          title="Stroje a kategorie"
          description="Seznam, sazby, barvy"
          onPress={() => router.push('/settings/categories')}
        />
        <SettingsRow
          icon="clock"
          title="Zápisy"
          description="Výchozí délka dne, zaokrouhlení, přestávka"
          onPress={() => router.push('/settings/zapisy')}
        />
        <SettingsRow
          icon="location"
          title="Poloha a trasy"
          description="Záznam na pozadí, uložená místa (připravujeme)"
          onPress={() => router.push('/settings/poloha')}
        />
        <SettingsRow
          icon="gearshape"
          title="Aplikace"
          description="Formát času, záloha, reset"
          onPress={() => router.push('/settings/aplikace')}
        />
        <SettingsRow
          icon="person.2"
          title="Moje údaje a odběratelé"
          description="Pro budoucí fakturaci (připravujeme)"
          onPress={() => router.push('/settings/odberatele')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
  screenTitle: {
    color: colors.text,
    fontFamily: fonts.headingBold,
    fontSize: 20,
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 16,
  },
  list: { marginTop: 4 },
});
