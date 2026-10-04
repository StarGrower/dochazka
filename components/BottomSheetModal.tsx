// ČÁST 1 (oprava): sdílený "bottom sheet" modal - nativní RN `<Modal>`
// (NE vlastní absolutně pozicovaný <View>, viz historie konverzace:
// to se ukázalo nulové/nekliknutelné, navíc by se při VNOŘENÍ dvou
// takových panelů druhý počítal vůči kartě prvního, ne vůči celé
// obrazovce - nativní Modal renderuje do samostatného okna, takže
// vnoření funguje správně i takhle). Dvě vrstvy řeší klávesnici:
// `KeyboardAvoidingView` posune kartu nad ni, vnější
// `TouchableWithoutFeedback` (celá plocha) + vnitřní (karta, prázdný
// onPress) zavřou klávesnici klepnutím mimo kartu, aniž by to počítalo
// jako klik NA kartu - standardní RN vzor.
//
// OPRAVA 2 (C3) - klepnutí kamkoliv do karty mimo pole teď klávesnici
// ZAVŘE (dřív vnitřní onPress nedělal nic, takže z pole ceny nešlo
// odejít jinak než lištou HOTOVO). Pole hodnotu uloží při ztrátě
// fokusu (onBlur). Klepnutí mimo kartu při otevřené klávesnici zavře
// jen klávesnici, ne celé okno - rozepsaná hodnota se tak neztratí.

import type { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';

import { colors } from '@/theme';

interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function BottomSheetModal({ visible, onClose, children }: BottomSheetModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback
        onPress={() => (Keyboard.isVisible() ? Keyboard.dismiss() : onClose())}
        accessible={false}
      >
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.avoider}
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View style={styles.card}>{children}</View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  avoider: { width: '100%' },
  card: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '80%',
  },
});
