// ČÁST 3 (zadání "krok číselníku ... i v NumPadu") - +/- tlačítka
// kroku podle Nastavení -> Zápisy, uprostřed hodnota, kterou lze i
// přímo přepsat (klávesnice s globální "Hotovo" lištou - viz
// KeyboardDoneAccessory.tsx, ČÁST 1 oprava). Zaokrouhlení (zadání
// "zaokrouhlení času") se aplikuje JEN na ručně přepsanou hodnotu, ne
// na krokování +/- (to už je podle definice "čisté" číslo).

import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { KEYBOARD_ACCESSORY_ID } from './KeyboardDoneAccessory';
import { colors, fonts, radii, fs } from '@/theme';

interface NumPadProps {
  value: number;
  step: number;
  unitLabel: string;
  onChange: (next: number) => void;
  roundTypedValue?: (value: number) => number;
}

export default function NumPad({ value, step, unitLabel, onChange, roundTypedValue }: NumPadProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    // Záměrné: znovu synchronizovat draft, když se `value` změní Z VENKU
    // (krokování +/- i uložení z jiné obrazovky) - ne bug, standardní
    // vzor pro "controlled" input se zpoždění za propem.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(String(value));
  }, [value]);

  const handleStep = (delta: number) => {
    const next = Math.max(0, Math.round((value + delta) * 100) / 100);
    onChange(next);
  };

  const commitTyped = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isNaN(parsed) || parsed < 0) {
      setDraft(String(value));
      return;
    }
    onChange(roundTypedValue ? roundTypedValue(parsed) : parsed);
  };

  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.stepButton} onPress={() => handleStep(-step)}>
        <Text style={styles.stepButtonText}>−</Text>
      </TouchableOpacity>
      <View style={styles.valueBox}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onBlur={commitTyped}
          keyboardType="decimal-pad"
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        <Text style={styles.unit}>{unitLabel}</Text>
      </View>
      <TouchableOpacity style={styles.stepButton} onPress={() => handleStep(step)}>
        <Text style={styles.stepButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonText: { color: colors.text, fontSize: fs(18), fontFamily: fonts.body, marginTop: -2 },
  valueBox: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 8,
    paddingVertical: 6,
    width: 56,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
    textAlign: 'center',
  },
  unit: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
});
