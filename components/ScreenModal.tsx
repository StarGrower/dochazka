// Celoobrazovkový modal (náhled PDF, mapa a další) - společné řešení
// bezpečných okrajů a zavírání, ať se tlačítka nikdy nedostanou pod
// stavový řádek / Dynamic Island ani pod home indikátor.
//
// NETRIVIÁLNÍ ROZHODNUTÍ:
// - SafeAreaView uvnitř RN Modal dostává nulové okraje (Modal = samostatné
//   okno) - proto okraje z hlavního okna přes useSafeAreaInsets (kontext
//   přes Modal prochází).
// - iOS: list "pageSheet" začíná pod stavovým řádkem (horní okraj netřeba)
//   a jde stáhnout dolů. V RN 0.86 jen s `allowSwipeDismissal` (jinak je
//   gesto vypnuté) - stažení zavolá onRequestClose. Android: přes celou
//   obrazovku (edge-to-edge), horní okraj z insets, zavření tlačítkem Zpět.
// - Ovládání patří do `footer` (spodní lišta nad home indikátorem);
//   nahoře je jen úchyt a nadpis, nic klikacího.

import type { ReactNode } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

interface ScreenModalProps {
  visible: boolean;
  onClose: () => void; // i stažení dolů (iOS) a tlačítko Zpět (Android)
  title?: string;
  footer?: ReactNode; // spodní lišta s tlačítky (ModalBarButton)
  background?: string;
  onDismiss?: () => void; // iOS: po dozavření (pak teprve Alert / sdílení)
  children: ReactNode;
}

export default function ScreenModal({ visible, onClose, title, footer, background = colors.background, onDismiss, children }: ScreenModalProps) {
  const insets = useSafeAreaInsets();
  const sheet = Platform.OS === 'ios';
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={sheet ? 'pageSheet' : 'fullScreen'}
      allowSwipeDismissal
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={[styles.root, { backgroundColor: background, paddingTop: sheet ? 0 : insets.top }]}>
        <View style={styles.head}>
          {sheet && <View style={styles.grab} />}
          {!!title && (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          )}
        </View>
        <View style={styles.body}>{children}</View>
        {footer ? (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>{footer}</View>
        ) : (
          <View style={{ height: insets.bottom }} />
        )}
      </View>
    </Modal>
  );
}

interface ModalBarButtonProps {
  label: string;
  onPress: () => void;
  primary?: boolean; // hlavní akce - žlutá
  disabled?: boolean;
}

// Tlačítko spodní lišty (min. 44 pt, styl appky).
export function ModalBarButton({ label, onPress, primary = false, disabled = false }: ModalBarButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.button, primary ? styles.primary : styles.secondary, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={primary ? styles.primaryText : styles.secondaryText} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { alignItems: 'center', paddingTop: 8, paddingBottom: 6, paddingHorizontal: 16, gap: 6, backgroundColor: colors.background },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
  title: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(17), letterSpacing: 0.8 },
  body: { flex: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  button: { minHeight: MIN_TOUCH, height: 48, paddingHorizontal: 16, borderRadius: radii.card, alignItems: 'center', justifyContent: 'center' },
  primary: { flex: 1, backgroundColor: colors.accent },
  secondary: { borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.4 },
  primaryText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 0.8 },
  secondaryText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
});
