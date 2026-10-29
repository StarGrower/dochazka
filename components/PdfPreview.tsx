// Společný náhled PDF před sdílením (faktura, export zakázky, výkaz pro
// šéfa) - stejné HTML jako PDF ve WebView přes celou obrazovku.
// Ovládání je ve spodní liště (components/ScreenModal.tsx): vlevo Zavřít,
// vpravo hlavní akce žlutě; nahoře jen nadpis. Stažení dolů náhled zavře.
// Volby (`options`, např. poznámky ke dnům, ceny) jsou nad lištou a mění
// PDF hned - HTML přegeneruje volající.

import { useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import ScreenModal, { ModalBarButton } from './ScreenModal';
import { colors, fonts, fs } from '@/theme';

export interface PreviewAction {
  label: string;
  onPress: () => void;
  primary?: boolean; // hlavní akce (žlutá, vpravo)
}

export interface PreviewOption {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}

interface PdfPreviewProps {
  html: string | null; // null = zavřeno
  title: string;
  actions?: PreviewAction[]; // pořadí zleva doprava, hlavní poslední
  options?: PreviewOption[];
  busy?: boolean; // přegenerování po změně volby
  onClose: () => void;
}

const BG = '#0B0B0A';

export default function PdfPreview({ html, title, actions = [], options = [], busy = false, onClose }: PdfPreviewProps) {
  // Akce (sdílení, potvrzení vystavení) až po zavření náhledu - na iOS se
  // Alert / sdílecí list otevřený během zavírání modalu ztratí.
  const pending = useRef<(() => void) | null>(null);
  const run = (fn: () => void) => {
    if (Platform.OS === 'ios') pending.current = fn;
    onClose();
    if (Platform.OS !== 'ios') fn();
  };
  const dismissed = () => {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  };
  return (
    <ScreenModal
      visible={html !== null}
      onClose={onClose}
      onDismiss={dismissed}
      title={title}
      background={BG}
      footer={
        <>
          <ModalBarButton label="Zavřít" onPress={onClose} />
          {actions.map((a) => (
            <ModalBarButton key={a.label} label={a.label} onPress={() => run(a.onPress)} primary={a.primary} disabled={busy} />
          ))}
        </>
      }
    >
      {html !== null && (
        <WebView
          style={styles.web}
          originWhitelist={['*']}
          source={{ html }}
          javaScriptEnabled
          setBuiltInZoomControls
          showsVerticalScrollIndicator
        />
      )}
      {options.length > 0 && (
        <View style={styles.options}>
          {options.map((o) => (
            <View key={o.label} style={styles.option}>
              <Text style={styles.optionLabel}>{o.label}</Text>
              <Switch
                value={o.value}
                onValueChange={o.onChange}
                disabled={busy}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.text}
                ios_backgroundColor={colors.border}
              />
            </View>
          ))}
          {busy && <ActivityIndicator color={colors.accent} style={styles.spinner} />}
        </View>
      )}
    </ScreenModal>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: BG },
  options: { paddingHorizontal: 16, paddingTop: 6, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  optionLabel: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15), flex: 1, marginRight: 12 },
  spinner: { position: 'absolute', right: 80, top: 18 },
});
