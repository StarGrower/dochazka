// Nastavení -> Záloha (etapa 4.1): automatická šifrovaná záloha do
// složky v Souborech (doporučeno iCloud Drive/Docházka), obnovovací klíč
// (QR + text), "Zálohovat teď", seznam záloh a obnova s náhledem.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import { useFocusEffect } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import BottomSheetModal from '@/components/BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import DochazkaNative, { type BackupFileInfo } from '../../modules/dochazka-native/src/DochazkaNative';
import {
  backupNow,
  currentRecoveryKey,
  getLastBackup,
  getLastBackupAttempt,
  isBackupConfigured,
  listBackups,
  markRecoveryKeyShown,
  MissingKeyError,
  performRestore,
  prepareRestore,
  RECOVERY_QR_PREFIX,
  setUpBackupFolder,
  type BackupAttempt,
  type BackupRecord,
  type RestorePreview,
} from '@/lib/backup';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return `dnes ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `včera ${time}`;
  return `${d.getDate()}. ${d.getMonth() + 1}. ${time}`;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

const fmtDay = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}` : '-');

export default function ZalohaScreen() {
  const [configured, setConfigured] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [last, setLast] = useState<BackupRecord | null>(null);
  const [attempt, setAttempt] = useState<BackupAttempt | null>(null);
  const [files, setFiles] = useState<BackupFileInfo[]>([]);
  const [keySync, setKeySync] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<{ source: string } | null>(null);
  const [keyDraft, setKeyDraft] = useState('');

  const load = useCallback(async () => {
    let ok = false;
    try {
      const folder = DochazkaNative.getBackupFolder();
      setFolderName(folder.name);
      setFolderError(folder.configured && !folder.accessible ? folder.error || 'složka není dostupná' : '');
      setKeySync(DochazkaNative.getKeyStatus().synchronizable);
      ok = isBackupConfigured();
    } catch {
      ok = false;
    }
    setConfigured(ok);
    setLast(await getLastBackup());
    setAttempt(await getLastBackupAttempt());
    setFiles(ok ? await listBackups().catch(() => []) : []);
  }, []);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém
  // překreslení a přepíše rozepsané hodnoty v polích (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try {
      await task();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/zrušen/i.test(message)) Alert.alert('Nepovedlo se', message);
    } finally {
      setBusy(null);
      await load();
    }
  };

  const handleSetUp = () =>
    run('Nastavuji…', async () => {
      const result = await setUpBackupFolder();
      setRecoveryKey(result.recoveryKey);
      await backupNow('první záloha');
    });

  const handleBackupNow = () => run('Zálohuji…', async () => void (await backupNow('ručně')));

  const startRestore = (source: string, keyText?: string) =>
    run('Připravuji obnovu…', async () => {
      try {
        setPreview(await prepareRestore(source, keyText));
        setKeyPrompt(null);
        setKeyDraft('');
      } catch (err) {
        if (err instanceof MissingKeyError) {
          setKeyPrompt({ source });
          if (keyText) Alert.alert('Klíč nesedí', 'Zálohu se tímhle klíčem nepodařilo otevřít.');
          return;
        }
        throw err;
      }
    });

  const confirmRestore = () => {
    if (!preview) return;
    Alert.alert(
      'Obnovit ze zálohy?',
      'Současná data se celá nahradí zálohou. Před obnovou se aktuální stav ještě zazálohuje. Appka se pak znovu načte.',
      [
        { text: 'Zrušit', style: 'cancel' },
        { text: 'Obnovit', style: 'destructive', onPress: () => run('Obnovuji…', () => performRestore(preview)) },
      ]
    );
  };

  const keyText = recoveryKey ?? '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="ZÁLOHA" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {configured && last ? (
            <>
              <Text style={styles.cardTitle}>Poslední záloha: {formatWhen(last.at)}</Text>
              <Text style={styles.cardDetail}>
                {last.folderName || folderName} · {formatSize(last.size)}
              </Text>
            </>
          ) : (
            <Text style={styles.cardTitle}>{configured ? 'Zatím žádná záloha' : 'Záloha není nastavená'}</Text>
          )}
          {!!folderError && <Text style={styles.error}>Složka: {folderError}</Text>}
          {attempt && !attempt.ok && (
            <Text style={styles.error}>
              Poslední pokus {formatWhen(attempt.at)} ({attempt.background ? 'na pozadí' : 'v popředí'}) selhal: {attempt.error}
            </Text>
          )}
        </View>

        {!configured ? (
          <>
            <Text style={styles.hint}>
              Vyber složku v aplikaci Soubory - doporučeno iCloud Drive → vytvoř složku „Docházka“. Appka pak zálohuje sama
              (nejvýš 1× denně a před každou aktualizací databáze). Záloha je šifrovaná, heslo není potřeba.
            </Text>
            <TouchableOpacity style={styles.primary} onPress={handleSetUp} disabled={!!busy}>
              <Text style={styles.primaryText}>VYBRAT SLOŽKU A ZAPNOUT</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.primary} onPress={handleBackupNow} disabled={!!busy}>
              <Text style={styles.primaryText}>ZÁLOHOVAT TEĎ</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              Šifrovací klíč je v Klíčence{keySync ? ' (synchronizuje se přes iCloud Klíčenku)' : ' (jen v tomhle telefonu)'}. Na novém
              telefonu bez klíče je potřeba obnovovací klíč - měj ho uložený v Heslech nebo vytištěný.
            </Text>
            <TouchableOpacity style={styles.secondary} onPress={() => setRecoveryKey(currentRecoveryKey())}>
              <Text style={styles.secondaryText}>Zobrazit obnovovací klíč</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => run('Měním složku…', async () => void (await setUpBackupFolder()))}>
              <Text style={styles.secondaryText}>Změnit složku ({folderName})</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeader}>ZÁLOHY VE SLOŽCE</Text>
            {files.map((f) => (
              <View key={f.name} style={styles.fileRow}>
                <View style={styles.fileMain}>
                  <Text style={styles.fileName}>{f.name.replace('.dochazka', '')}</Text>
                  <Text style={styles.cardDetail}>{formatSize(f.size)}</Text>
                </View>
                <TouchableOpacity onPress={() => startRestore(f.name)} hitSlop={8}>
                  <Text style={styles.link}>Obnovit</Text>
                </TouchableOpacity>
              </View>
            ))}
            {files.length === 0 && <Text style={styles.hint}>Ve složce zatím nejsou žádné zálohy.</Text>}
          </>
        )}

        <Text style={styles.sectionHeader}>OBNOVA</Text>
        <TouchableOpacity style={styles.secondary} onPress={() => startRestore('pick')} disabled={!!busy}>
          <Text style={styles.secondaryText}>Obnovit ze souboru… (nový telefon)</Text>
        </TouchableOpacity>

        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.cardDetail}>{busy}</Text>
          </View>
        )}
      </ScrollView>

      {/* Obnovovací klíč - jednou při nastavení, pak kdykoliv na požádání. */}
      <BottomSheetModal
        visible={recoveryKey !== null}
        onClose={() => setRecoveryKey(null)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={styles.footerCta}
              onPress={async () => {
                await markRecoveryKeyShown();
                setRecoveryKey(null);
              }}
            >
              <Text style={styles.primaryText}>MÁM ULOŽENO</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <>
          <Text style={styles.modalTitle}>OBNOVOVACÍ KLÍČ</Text>
          <Text style={styles.hint}>
            Ulož si ho (Hesla, poznámka, tisk). Je potřeba jen při obnově na novém telefonu, když klíč nepřejde přes iCloud
            Klíčenku. Kdo má klíč i zálohu, přečte tvoje data - nesdílej ho.
          </Text>
          {!!keyText && (
            <View style={styles.qr}>
              <QRCode value={`${RECOVERY_QR_PREFIX}${keyText}`} size={180} backgroundColor="#FFFFFF" color="#131311" />
            </View>
          )}
          <Text style={styles.keyText} selectable>
            {keyText || 'Klíč zatím neexistuje.'}
          </Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.half} onPress={() => Clipboard.setStringAsync(keyText)}>
              <Text style={styles.secondaryText}>Kopírovat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.half} onPress={() => Share.share({ message: `Docházka - obnovovací klíč zálohy:\n${keyText}` })}>
              <Text style={styles.secondaryText}>Sdílet</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.half}
              onPress={() =>
                Print.printAsync({
                  html: `<html><body style="font-family:-apple-system;padding:40px"><h2>Docházka - obnovovací klíč zálohy</h2><p style="font-size:22px;font-family:Menlo,monospace;word-break:break-all">${keyText}</p><p>Potřeba jen při obnově zálohy na novém telefonu.</p></body></html>`,
                }).catch(() => {})
              }
            >
              <Text style={styles.secondaryText}>Tisk</Text>
            </TouchableOpacity>
          </View>
        </>
      </BottomSheetModal>

      {/* Klíč chybí -> zadat obnovovací klíč. */}
      <BottomSheetModal
        visible={keyPrompt !== null}
        onClose={() => setKeyPrompt(null)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.footerCancel} onPress={() => setKeyPrompt(null)}>
              <Text style={styles.footerCancelText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerCta} onPress={() => keyPrompt && startRestore(keyPrompt.source, keyDraft)}>
              <Text style={styles.primaryText}>POKRAČOVAT</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.modalTitle}>ZADEJ OBNOVOVACÍ KLÍČ</Text>
        <Text style={styles.hint}>V tomhle telefonu šifrovací klíč není (nepřešel přes iCloud Klíčenku). Opiš nebo vlož obnovovací klíč.</Text>
        <TextInput
          style={styles.input}
          value={keyDraft}
          onChangeText={setKeyDraft}
          placeholder="ABCD-EFGH-…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          multiline
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
      </BottomSheetModal>

      {/* Náhled obnovy. */}
      <BottomSheetModal
        visible={preview !== null}
        onClose={() => setPreview(null)}
        footer={
          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.footerCancel} onPress={() => setPreview(null)}>
              <Text style={styles.footerCancelText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footerCta, styles.danger]} onPress={confirmRestore}>
              <Text style={styles.primaryText}>NAHRADIT DATA ZÁLOHOU</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.modalTitle}>OBNOVIT ZE ZÁLOHY</Text>
        {preview && (
          <>
            <Text style={styles.cardDetail}>{preview.sourceName}</Text>
            <Text style={styles.previewLine}>
              Období: {fmtDay(preview.firstDate)} – {fmtDay(preview.lastDate)}
            </Text>
            <Text style={styles.previewLine}>Dní se zápisem: {preview.dayCount}</Text>
            <Text style={styles.previewLine}>Položek práce: {preview.recordCount}</Text>
            <Text style={styles.previewLine}>Uložených míst: {preview.placeCount}</Text>
            <Text style={styles.previewLine}>Pobytů: {preview.visitCount}</Text>
          </>
        )}
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  footerCta: { flex: 1, height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  footerCancel: { height: 52, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  footerCancelText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 10 },
  card: { backgroundColor: colors.card, borderRadius: radii.card, padding: 14, gap: 4 },
  cardTitle: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(16) },
  cardDetail: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: fs(12), marginTop: 4 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12), lineHeight: fs(17), marginBottom: 6 },
  primary: { height: 54, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(17), letterSpacing: 1 },
  danger: { backgroundColor: colors.danger },
  secondary: {
    minHeight: MIN_TOUCH,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  sectionHeader: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(12), letterSpacing: 1, marginTop: 12 },
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radii.card, padding: 12, minHeight: MIN_TOUCH },
  fileMain: { flex: 1 },
  fileName: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14) },
  link: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  busy: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  modalTitle: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(16), letterSpacing: 1, marginBottom: 10 },
  qr: { alignSelf: 'center', padding: 12, backgroundColor: '#FFFFFF', borderRadius: radii.card, marginVertical: 10 },
  keyText: { color: colors.text, fontFamily: 'Menlo', fontSize: fs(15), textAlign: 'center', marginBottom: 12, lineHeight: fs(22) },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  half: { flex: 1, minHeight: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: 12,
    minHeight: 72,
    color: colors.text,
    fontFamily: 'Menlo',
    fontSize: fs(15),
    backgroundColor: colors.background,
    marginBottom: 8,
  },
  previewLine: { color: colors.text, fontFamily: fonts.body, fontSize: fs(15), marginTop: 6 },
});
