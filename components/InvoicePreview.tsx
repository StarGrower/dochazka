// Náhled PDF faktury před sdílením - stejné HTML jako PDF (lib/invoiceReport.ts,
// režim "preview"), zobrazené ve WebView přes celou obrazovku.

import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

interface InvoicePreviewProps {
  html: string | null; // null = zavřeno
  title: string;
  shareLabel?: string; // bez tlačítka, když chybí
  onShare?: () => void;
  onClose: () => void;
}

export default function InvoicePreview({ html, title, shareLabel, onShare, onClose }: InvoicePreviewProps) {
  return (
    <Modal visible={html !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.bar}>
          <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={8} accessibilityLabel="Zavřít náhled">
            <Text style={styles.closeText}>Zavřít</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {shareLabel && onShare ? (
            <TouchableOpacity style={styles.share} onPress={onShare}>
              <Text style={styles.shareText}>{shareLabel}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.close} />
          )}
        </View>
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
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B0A' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.background },
  close: { minWidth: 72, minHeight: MIN_TOUCH, justifyContent: 'center' },
  closeText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(17), letterSpacing: 0.8 },
  share: { minHeight: MIN_TOUCH, paddingHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.accent, justifyContent: 'center' },
  shareText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 0.6 },
  web: { flex: 1, backgroundColor: '#0B0B0A' },
});
