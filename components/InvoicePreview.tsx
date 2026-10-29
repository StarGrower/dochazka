// Náhled PDF faktury před sdílením - stejné HTML jako PDF (lib/invoiceReport.ts,
// režim "preview"), zobrazené ve WebView přes celou obrazovku.
// Ovládání je ve spodní liště (components/ScreenModal.tsx): vlevo Zavřít,
// vpravo hlavní akce; nahoře jen nadpis. Stažení dolů náhled zavře.

import { useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import ScreenModal, { ModalBarButton } from './ScreenModal';

export interface PreviewAction {
  label: string;
  onPress: () => void;
  primary?: boolean; // hlavní akce (žlutá, vpravo)
}

interface InvoicePreviewProps {
  html: string | null; // null = zavřeno
  title: string;
  actions?: PreviewAction[]; // pořadí zleva doprava, hlavní poslední
  onClose: () => void;
}

const BG = '#0B0B0A';

export default function InvoicePreview({ html, title, actions = [], onClose }: InvoicePreviewProps) {
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
            <ModalBarButton key={a.label} label={a.label} onPress={() => run(a.onPress)} primary={a.primary} />
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
    </ScreenModal>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: BG },
});
