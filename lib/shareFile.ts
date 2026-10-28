// Sdílení vygenerovaných souborů (PDF z HTML přes expo-print, XLSX/CSV) -
// systémové Sdílet (e-mail, WhatsApp, Soubory, AirDrop).

import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

// Název souboru bez diakritiky a zvláštních znaků.
export function safeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// A4 bez okrajů (595 × 842 bodů) - pro stránky skládané v HTML (faktura).
export const A4_NO_MARGINS = { width: 595, height: 842, margins: { top: 0, right: 0, bottom: 0, left: 0 } };

export async function sharePdfFromHtml(html: string, baseName: string, dialogTitle: string, page?: typeof A4_NO_MARGINS): Promise<void> {
  const printed = await Print.printToFileAsync({ html, ...page });
  const target = new File(Paths.cache, `${safeFileName(baseName)}.pdf`);
  if (target.exists) target.delete();
  await new File(printed.uri).move(target);
  await Sharing.shareAsync(target.uri, { mimeType: 'application/pdf', dialogTitle });
}

export async function shareBytes(content: Uint8Array | string, fileName: string, mimeType: string, dialogTitle: string): Promise<void> {
  const target = new File(Paths.cache, fileName);
  if (target.exists) target.delete();
  target.create();
  target.write(content);
  await Sharing.shareAsync(target.uri, { mimeType, dialogTitle });
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
