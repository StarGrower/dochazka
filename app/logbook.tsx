// Kniha jízd - doplní etapa 7.

import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import ScreenHeader from '@/components/ScreenHeader';
import { colors, fonts, fs } from '@/theme';

export default function LogbookScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="KNIHA JÍZD" onBack={() => router.back()} />
      <Text style={styles.text}>Připravuje se.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  text: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(14), padding: 16 },
});
