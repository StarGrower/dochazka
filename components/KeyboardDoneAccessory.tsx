// ČÁST 1 (oprava): numerická klávesnice ("decimal-pad") na iOS NEMÁ
// žádné tlačítko Hotovo/Return - jediný způsob, jak ji zavřít, je
// vlastní InputAccessoryView. Mountuje se JEDNOU globálně v
// app/_layout.tsx (ne v každé obrazovce zvlášť) - víc instancí se
// stejným nativeID by si na iOS konkurovalo; takhle je jistota, že
// existuje přesně jedna. Každý numerický TextInput v appce na ni
// odkazuje přes `inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}`.

import { InputAccessoryView, Keyboard, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fonts, MIN_TOUCH, fs } from '@/theme';

export const KEYBOARD_ACCESSORY_ID = 'dochazka-keyboard-done';

export default function KeyboardDoneAccessory() {
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={KEYBOARD_ACCESSORY_ID}>
      <View style={styles.bar}>
        <TouchableOpacity style={styles.button} onPress={() => Keyboard.dismiss()}>
          <Text style={styles.buttonText}>HOTOVO</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'flex-end',
    paddingHorizontal: 8,
  },
  button: {
    minWidth: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  buttonText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(15), letterSpacing: 0.5 },
});
