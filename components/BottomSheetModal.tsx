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
//
// OPRAVA (po buildu 37503018105) - obsah se VŽDY dá posouvat: karta má
// výšku počítanou z okna (bez horní bezpečné oblasti a bez klávesnice) a
// obsah je ve ScrollView. Dřív "maxHeight 80 %" se počítalo z rodiče bez
// výšky -> na malém displeji / s klávesnicí / větším písmem se spodek okna
// (pole ZAKÁZKA, tlačítka) nevešel a nešel posunout. `scroll={false}` jen
// pro obsah, který se posouvá sám.

import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme';

interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  cardStyle?: StyleProp<ViewStyle>; // vlastní rozměry karty (např. podle grafické předlohy)
  scroll?: boolean; // výchozí ano
}

export default function BottomSheetModal({ visible, onClose, children, cardStyle, scroll = true }: BottomSheetModalProps) {
  const { height } = useWindowDimensions();
  // okraje z hlavního okna (uvnitř Modal by byly 0)
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const maxHeight = Math.max(240, height - Math.max(insets.top, 20) - 16 - keyboard);

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
              <View style={[styles.card, { maxHeight, paddingBottom: keyboard > 0 ? 16 : Math.max(36, insets.bottom + 16) }, cardStyle]}>
                {scroll ? (
                  <ScrollView
                    style={styles.scroll}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="interactive"
                    showsVerticalScrollIndicator
                  >
                    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
                      <View>{children}</View>
                    </TouchableWithoutFeedback>
                  </ScrollView>
                ) : (
                  children
                )}
              </View>
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
  },
  scroll: { flexGrow: 0 },
});
