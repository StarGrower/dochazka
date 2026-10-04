// Sdílené záhlaví obrazovky (šipka zpět + VERZÁLKOVÝ titulek, volitelně
// prvek vpravo) - používá Detail dne i všechny podobrazovky Nastavení
// (viz app/settings/*.tsx), ať se stejný vzhled nepíše pětkrát znovu.

import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import { colors, fonts, MIN_TOUCH, fs } from '@/theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
}

export default function ScreenHeader({ title, subtitle, right, onBack }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={onBack ?? (() => router.back())} hitSlop={8}>
        <Text style={styles.backButtonText}>‹</Text>
      </TouchableOpacity>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backButton: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  backButtonText: { color: colors.text, fontSize: fs(28), fontFamily: fonts.body, marginTop: -2 },
  titleBlock: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(17), letterSpacing: 1 },
  subtitle: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginTop: 2 },
  right: { minWidth: MIN_TOUCH, alignItems: 'flex-end' },
});
