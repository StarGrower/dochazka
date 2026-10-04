// Proužek nahoře v kalendáři (etapa 4.2): nejvážnější problém záznamu,
// žlutě (pozor) / červeně (problém). Klepnutí -> Stav záznamu.

import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

import type { HealthCheck } from '@/lib/health';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

export default function HealthBanner({ problem, count }: { problem: HealthCheck; count: number }) {
  const error = problem.level === 'error';
  return (
    <TouchableOpacity style={[styles.banner, error ? styles.error : styles.warn]} onPress={() => router.push('/settings/stav')}>
      <Text style={[styles.text, error && styles.textError]} numberOfLines={2}>
        {problem.title}
        {count > 1 ? ` (+${count - 1} další)` : ''} ›
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: { minHeight: MIN_TOUCH, borderRadius: radii.card, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center', marginBottom: 12 },
  warn: { backgroundColor: colors.accent },
  error: { backgroundColor: colors.danger },
  text: { color: colors.onAccent, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  textError: { color: colors.text },
});
