// ČÁST 1 (oprava): sdílený 'bottom sheet' modal - nativní RN `<Modal>`
// (NE vlastní absolutně pozicovaný <View>, viz historie konverzace:
// to se ukázalo nulové/nekliknutelné, navíc by se při VNOŘENÍ dvou
// takových panelů druhý počítal vůči kartě prvního, ne vůči celé
// obrazovce - nativní Modal renderuje do samostatného okna, takže
// vnoření funguje správně i takhle).
//
// OPRAVA (po buildu 37503018105) - posouvání napoprvé a tlačítka vždy
// vidět:
// - tmavý podklad je SOUROZENEC karty (Pressable přes celou plochu), ne
//   její rodič -> karta už nepotřebuje TouchableWithoutFeedback, který
//   chytal první dotyk dřív, než ScrollView poznal posun;
// - obsah je v JEDNÉ ScrollView (okna uvnitř už vlastní ScrollView nemají -
//   vnořené svislé ScrollView se přetahovaly o stejný tah);
// - `footer` = pevná spodní lišta (ULOŽIT / ZRUŠIT / SMAZAT) mimo
//   posouvaný obsah, nad spodní bezpečnou oblastí a nad klávesnicí;
// - zavření tahem dolů JEN za úchyt / hlavičku nahoře (PanResponder na
//   úchytu), obsah tah nikdy nezavírá; klepnutí na podklad okno zavře
//   (při otevřené klávesnici jen klávesnici);
// - výška karty z okna bez horní bezpečné oblasti a bez klávesnice
//   (okraje z hlavního okna - uvnitř Modal by byly 0).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
  footer?: ReactNode; // pevná spodní lišta s tlačítky
  cardStyle?: StyleProp<ViewStyle>; // vlastní rozměry karty (např. podle grafické předlohy)
  scroll?: boolean; // výchozí ano
}

const CLOSE_DRAG = 90; // px tahu dolů za úchyt = zavřít

export default function BottomSheetModal({
  visible,
  onClose,
  children,
  footer,
  cardStyle,
  scroll = true,
}: BottomSheetModalProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  const [drag] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboard(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboard(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) drag.setValue(0);
  }, [visible, drag]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => g.dy > 4,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > CLOSE_DRAG || g.vy > 1.2) {
            Keyboard.dismiss();
            onClose();
          } else {
            Animated.spring(drag, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 4,
            }).start();
          }
        },
        onPanResponderTerminate: () =>
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [drag, onClose],
  );

  const maxHeight = Math.max(
    260,
    height - Math.max(insets.top, 20) - 16 - keyboard,
  );
  const bottomPad = keyboard > 0 ? 12 : Math.max(20, insets.bottom + 8);

  return (
    <Modal
      visible={visible}
      transparent
      animationType='slide'
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() =>
            Keyboard.isVisible() ? Keyboard.dismiss() : onClose()
          }
          accessibilityLabel='Zavřít okno'
        >
          <View style={styles.backdrop} />
        </Pressable>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoider}
          pointerEvents='box-none'
        >
          <Animated.View
            style={[
              styles.card,
              { maxHeight, transform: [{ translateY: drag }] },
              cardStyle,
            ]}
          >
            <View
              style={styles.grabArea}
              {...pan.panHandlers}
              accessibilityLabel='Tahem dolů zavřít'
            >
              <View style={styles.grab} />
            </View>
            {scroll ? (
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                  styles.content,
                  !footer && { paddingBottom: bottomPad },
                ]}
                keyboardShouldPersistTaps='handled'
                keyboardDismissMode='interactive'
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {children}
              </ScrollView>
            ) : (
              <View
                style={[
                  styles.content,
                  !footer && { paddingBottom: bottomPad },
                ]}
              >
                {children}
              </View>
            )}
            {footer ? (
              <View style={[styles.footer, { paddingBottom: bottomPad }]}>
                {footer}
              </View>
            ) : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  avoider: { width: '100%' },
  card: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  grabArea: { height: 26, alignItems: 'center', justifyContent: 'center' },
  grab: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: 20, paddingTop: 4 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
});
