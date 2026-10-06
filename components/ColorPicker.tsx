// ČÁST 2 (opraveno podle doplněného zadání): mřížka 16 připravených
// barev (8×2, 36px, vybraná = žlutý rámeček) + tlačítko "VLASTNÍ
// ODSTÍN", které otevře opravdový výběr barvy (posuvník odstínu + pole
// sytost/jas + náhled) přes reanimated-color-picker - čistě JS
// knihovna, funguje v Expo Go, žádný vlastní dev-client není potřeba.
// Hex pole je v tomhle modalu jen DOPLŇKOVÉ (pro kdo přesně ví, jaký
// kód chce). WorkCategory.color je stejně jen prostý TEXT (hex) -
// paletová i vlastní barva se ukládají úplně stejně.

import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ColorPickerLib, {
  HueSlider,
  Panel1,
  Preview,
  type ColorPickerRef,
  type ColorFormatsObject,
} from 'reanimated-color-picker';

import BottomSheetModal from './BottomSheetModal';
import { KEYBOARD_ACCESSORY_ID } from './KeyboardDoneAccessory';
import { categoryPalette, colors, fonts, radii, MIN_TOUCH, fs } from '@/theme';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value);
}

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  recentColors: string[];
}

export default function ColorPicker({ value, onChange, recentColors }: ColorPickerProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [pendingHex, setPendingHex] = useState(value);
  const [hexDraft, setHexDraft] = useState(value);
  const [hexError, setHexError] = useState(false);
  const pickerRef = useRef<ColorPickerRef>(null);

  const openCustom = () => {
    setPendingHex(value);
    setHexDraft(value);
    setHexError(false);
    setCustomOpen(true);
  };

  const handlePickerChange = (result: ColorFormatsObject) => {
    setPendingHex(result.hex);
    setHexDraft(result.hex);
  };

  const commitHexDraft = () => {
    if (!isValidHex(hexDraft)) {
      setHexError(true);
      return;
    }
    setHexError(false);
    setPendingHex(hexDraft);
    pickerRef.current?.setColor(hexDraft);
  };

  const confirmCustom = () => {
    onChange(pendingHex);
    setCustomOpen(false);
  };

  // Pevně 2 řádky × 8 (zadání) - NE spoléhat na automatické zalomení
  // (flexWrap by na užším telefonu mohlo zalomit nerovnoměrně); každý
  // čtvereček je `flex: 1` s `maxWidth` stropem, takže se vždy vejde
  // přesně 8 na řádek, jen o trochu menší na úzkých displejích.
  const paletteRows = [categoryPalette.slice(0, 8), categoryPalette.slice(8, 16)];

  return (
    <View>
      {paletteRows.map((row, i) => (
        <View key={i} style={styles.paletteRow}>
          {row.map((c) => (
            <Swatch key={c} color={c} selected={value === c} onPress={() => onChange(c)} />
          ))}
        </View>
      ))}

      {recentColors.length > 0 && (
        <>
          <Text style={styles.subLabel}>NAPOSLEDY POUŽITÉ</Text>
          <View style={styles.paletteRow}>
            {recentColors.map((c) => (
              <Swatch key={c} color={c} selected={value === c} onPress={() => onChange(c)} />
            ))}
          </View>
        </>
      )}

      <TouchableOpacity style={styles.customButton} onPress={openCustom}>
        <View style={[styles.customButtonSwatch, { backgroundColor: value }]} />
        <Text style={styles.customButtonText}>VLASTNÍ ODSTÍN</Text>
      </TouchableOpacity>

      <BottomSheetModal
        visible={customOpen}
        onClose={() => setCustomOpen(false)}
        footer={
          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setCustomOpen(false)}>
              <Text style={styles.cancelButtonText}>Zrušit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.useButton} onPress={confirmCustom}>
              <Text style={styles.useButtonText}>POUŽÍT</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <Text style={styles.modalTitle}>VLASTNÍ ODSTÍN</Text>

        <ColorPickerLib
          ref={pickerRef}
          value={value}
          onCompleteJS={handlePickerChange}
          thumbSize={28}
          style={styles.pickerWrap}
        >
          <Panel1 style={styles.panel} />
          <HueSlider style={styles.hueSlider} />
          <Preview hideInitialColor style={styles.preview} />
        </ColorPickerLib>

        <Text style={styles.subLabel}>HEX (DOPLŇKOVĚ)</Text>
        <TextInput
          style={[styles.hexInput, hexError && styles.hexInputError]}
          value={hexDraft}
          onChangeText={(t) => {
            setHexDraft(t.length > 0 && !t.startsWith('#') ? `#${t}` : t);
            setHexError(false);
          }}
          onBlur={commitHexDraft}
          onSubmitEditing={commitHexDraft}
          placeholder="#RRGGBB"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
          inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
        />
        {hexError && <Text style={styles.errorText}>Zadej platný hex kód, např. #F2B705.</Text>}

      </BottomSheetModal>
    </View>
  );
}

function Swatch({ color, selected, onPress }: { color: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.swatch, { backgroundColor: color }, selected && styles.swatchSelected]}
      onPress={onPress}
    />
  );
}

const SWATCH_SIZE = 36;

const styles = StyleSheet.create({
  paletteRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  swatch: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: SWATCH_SIZE,
    borderRadius: radii.card,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: { borderColor: colors.accent },
  subLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemiBold,
    fontSize: fs(11),
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
  },
  customButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  customButtonSwatch: { width: 24, height: 24, borderRadius: radii.card },
  customButtonText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(13), letterSpacing: 0.5 },
  modalTitle: {
    color: colors.text,
    fontFamily: fonts.headingBold,
    fontSize: fs(17),
    letterSpacing: 1,
    marginBottom: 16,
  },
  pickerWrap: { gap: 16 },
  panel: { height: 180, borderRadius: radii.card },
  hueSlider: { height: 28, borderRadius: radii.card },
  preview: { height: 44, borderRadius: radii.card },
  hexInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fs(16),
    fontFamily: fonts.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  hexInputError: { borderColor: colors.danger },
  errorText: { color: colors.danger, fontFamily: fonts.body, fontSize: fs(12), marginTop: 6 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelButton: { flex: 1, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(15) },
  useButton: {
    flex: 1,
    height: MIN_TOUCH,
    borderRadius: radii.card,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useButtonText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1 },
});
