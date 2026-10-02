// Nastavení -> Moje údaje a odběratelé (ČÁST 3) - příprava na
// fakturaci (zadání "PŘÍPRAVA NA FAKTURACI"), zatím čistě "Připravujeme"
// - datový model (clients/orders) ještě neexistuje, viz POZNAMKY.md.

import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ScreenHeader from '@/components/ScreenHeader';
import { colors, fonts, radii } from '@/theme';

export default function OdberateleSettingsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="MOJE ÚDAJE A ODBĚRATELÉ" />

      <View style={styles.content}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            PŘIPRAVUJEME - tahle sekce bude součástí fakturace (vlastní firemní údaje, odběratelé -
            název, IČO, DIČ, adresa). Datový model je promyšlený dopředu (viz POZNAMKY.md), ale
            zatím se nestaví, ať se nepředbíhá zadání.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  banner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radii.card,
    padding: 14,
  },
  bannerText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
});
