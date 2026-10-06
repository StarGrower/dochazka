// Fotky (etapa 6) - počitadlo, účtenka, závada. Vyfotit / vybrat ->
// zmenšit na max. 1280 px JPEG (~150 kB) -> uložit do DB (photos), ať
// jsou v šifrované záloze. Text se rozpozná přímo v telefonu (Apple
// Vision, offline); výsledek vždy potvrzuje uživatel.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import DochazkaNative from '../modules/dochazka-native/src/DochazkaNative';
import { savePhoto } from './machines';

const MAX_SIDE = 1280;

export interface TakenPhoto {
  id: number;
  base64: string;
  lines: string[]; // rozpoznaný text (prázdné, když se nerozpoznávalo)
}

export async function takePhoto(source: 'camera' | 'library', recognize: boolean): Promise<TakenPhoto | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Fotoaparát není povolený (Nastavení iPhonu → Docházka → Fotoaparát).');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const scale = Math.min(1, MAX_SIDE / Math.max(asset.width || MAX_SIDE, asset.height || MAX_SIDE));
  const context = ImageManipulator.manipulate(asset.uri);
  if (scale < 1) context.resize({ width: Math.round((asset.width || MAX_SIDE) * scale) });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
  if (!saved.base64) return null;
  const id = await savePhoto(saved.base64, saved.width, saved.height);
  let lines: string[] = [];
  if (recognize) lines = await DochazkaNative.recognizeText(saved.base64).catch(() => []);
  return { id, base64: saved.base64, lines };
}
