// Obecný segmentovaný výběr (label + řada tlačítek) - Nastavení ->
// Zápisy/Aplikace (zaokrouhlení, krok číselníku, velikost písma, ...).

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fonts, radii, fs } from '@/theme';

interface SegmentedControlProps<T extends string | number> {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}

export default function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
}: SegmentedControlProps<T>) {
  return (
    <View style={[styles.wrap, disabled && styles.wrapDisabled]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <TouchableOpacity
              key={String(opt.value)}
              style={[styles.button, active && styles.buttonActive]}
              onPress={() => !disabled && onChange(opt.value)}
              disabled={disabled}
            >
              <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  wrapDisabled: { opacity: 0.5 },
  label: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15), marginBottom: 10 },
  row: { flexDirection: 'row', gap: 8 },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  buttonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonText: { color: colors.text, fontFamily: fonts.body, fontSize: fs(13) },
  buttonTextActive: { color: colors.onAccent, fontFamily: fonts.bodySemiBold },
});
