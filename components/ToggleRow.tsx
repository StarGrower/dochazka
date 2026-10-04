// Řádek s přepínačem (zap/vyp) - Nastavení -> Zápisy/Aplikace.

import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, fonts, radii, fs } from '@/theme';

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}

export default function ToggleRow({ label, description, value, onValueChange, disabled }: ToggleRowProps) {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.textBlock}>
        <Text style={styles.label}>{label}</Text>
        {description && <Text style={styles.description}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={colors.text}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  rowDisabled: { opacity: 0.5 },
  textBlock: { flex: 1, marginRight: 12 },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  description: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), marginTop: 2 },
});
