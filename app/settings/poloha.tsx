// Nastavení -> Poloha a trasy (ČÁST 3) - zadání výslovně chce tuhle
// obrazovku připravit TEĎ (vzhled, prvky), ale neaktivní - funkční bude
// až s záznamem polohy v etapě 2-3. Proto jsou tu ovládací prvky
// disabled (ne live-state), jen jako náhled budoucího chování.

import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ScreenHeader from '@/components/ScreenHeader';
import SegmentedControl from '@/components/SegmentedControl';
import ToggleRow from '@/components/ToggleRow';
import { colors, fonts, radii } from '@/theme';

export default function PolohaSettingsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="POLOHA A TRASY" />

      <View style={styles.content}>
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            PŘIPRAVUJEME - tahle sekce bude funkční v etapě 2-3 (uložená místa, záznam polohy na
            pozadí). Ovládací prvky níž jsou náhled, teď na ně nejde klepnout.
          </Text>
        </View>

        <ToggleRow label="Zaznamenávat trasy" value={false} onValueChange={() => {}} disabled />

        <SegmentedControl
          label="Režim"
          value="usporny"
          onChange={() => {}}
          disabled
          options={[
            { label: 'Úsporný', value: 'usporny' },
            { label: 'Průběžný', value: 'prubezny' },
          ]}
        />

        <View style={styles.row}>
          <Text style={styles.label}>Interval (průběžný režim)</Text>
          <Text style={styles.value}>5-10 min</Text>
        </View>

        <Text style={styles.sectionHeader}>KDY ZAZNAMENÁVAT</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Dny v týdnu</Text>
          <Text style={styles.value}>Po-Pá</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Časové okno</Text>
          <Text style={styles.value}>6:00-19:00</Text>
        </View>

        <Text style={styles.sectionHeader}>ULOŽENÁ MÍSTA</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Stavby, rybníky</Text>
          <Text style={styles.value}>0 míst</Text>
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
    marginBottom: 16,
  },
  bannerText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    opacity: 0.5,
  },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15 },
  value: { color: colors.textMuted, fontFamily: fonts.body, fontSize: 14 },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: fonts.headingBold,
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
  },
});
