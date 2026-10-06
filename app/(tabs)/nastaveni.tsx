// ČÁST 3 - Nastavení je teď rozcestník (vizuální směr "A · Stavba"),
// obsah jednotlivých sekcí žije ve vlastních podobrazovkách pod
// app/settings/*.tsx (šipka zpět, stejný styl).

import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import SettingsRow from '@/components/SettingsRow';
import { colors, fonts, fs } from '@/theme';

export default function SettingsHubScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.screenTitle}>NASTAVENÍ</Text>

      <ScrollView contentContainerStyle={styles.list}>
        <SettingsRow
          icon="wrench.and.screwdriver"
          title="Stroje a kategorie"
          description="Seznam, sazby h/den/km, příplatky, barvy"
          onPress={() => router.push('/settings/categories')}
        />
        <SettingsRow
          icon="person.2"
          title="Pracovníci"
          description="Kolegové a řidiči, výchozí sazba, fakturovat / jen evidence"
          onPress={() => router.push('/settings/pracovnici')}
        />
        <SettingsRow
          icon="clock"
          title="Zápisy"
          description="Délka dne, zaokrouhlení, výchozí položky, připomenutí"
          onPress={() => router.push('/settings/zapisy')}
        />
        <SettingsRow
          icon="location"
          title="Poloha a trasy"
          description="Záznam na pozadí, trasy jízd, uložená místa"
          onPress={() => router.push('/settings/poloha')}
        />
        <SettingsRow
          icon="lock.shield"
          title="Záloha"
          description="Automatická šifrovaná záloha, obnova"
          onPress={() => router.push('/settings/zaloha')}
        />
        <SettingsRow
          icon="checkmark.seal"
          title="Stav záznamu"
          description="Oprávnění, podpis appky, poslední událost"
          onPress={() => router.push('/settings/stav')}
        />
        <SettingsRow
          icon="doc.text"
          title="Výkaz pro šéfa"
          description="PDF a Excel za období, odeslání"
          onPress={() => router.push('/settings/vykaz')}
        />
        <SettingsRow
          icon="person"
          title="Moje údaje"
          description="Jméno, IČO, adresa - hlavička výkazu"
          onPress={() => router.push('/settings/odberatele')}
        />
        <SettingsRow
          icon="gearshape"
          title="Aplikace"
          description="Písmo, ladicí deník, reset"
          onPress={() => router.push('/settings/aplikace')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
  screenTitle: {
    color: colors.text,
    fontFamily: fonts.headingBold,
    fontSize: fs(20),
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 16,
  },
  list: { marginTop: 4, paddingBottom: 24 },
});
