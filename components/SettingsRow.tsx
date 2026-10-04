// Řádek rozcestníku Nastavení (ikona, název, popis, šipka ›) - viz
// app/(tabs)/nastaveni.tsx.

import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fonts, radii, MIN_TOUCH, fs } from '@/theme';

interface SettingsRowProps {
  icon: SFSymbol;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
}

export default function SettingsRow({ icon, title, description, onPress, disabled }: SettingsRowProps) {
  return (
    <TouchableOpacity
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.iconWrap}>
        <SymbolView name={icon} tintColor={colors.accent} size={22} />
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
    gap: 12,
    minHeight: MIN_TOUCH,
  },
  rowDisabled: { opacity: 0.5 },
  iconWrap: { width: 32, alignItems: 'center' },
  textBlock: { flex: 1 },
  title: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  description: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: fs(20), fontFamily: fonts.body },
});
