// Položky faktury (předloha: "Co se fakturuje") - název, popis, množství
// (desetinná čárka), jednotka, cena za jednotku, celkem; smazat, přidat.
// Množství a cena se drží jako text (rozepsané "6," nesmí zmizet), do
// faktury jdou jako čísla (neplatné = 0).

import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import { formatDecimal, itemTotal, parseDecimal } from '@/lib/invoiceCalc';
import { kcInvoice } from '@/lib/invoiceReport';
import { INVOICE_UNITS, type InvoiceItem } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

export interface ItemRow {
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export const itemToRow = (i: InvoiceItem): ItemRow => ({
  name: i.name,
  description: i.description,
  quantity: formatDecimal(i.quantity),
  unit: i.unit,
  unitPrice: formatDecimal(i.unitPriceKc),
});

export const rowToItem = (r: ItemRow): InvoiceItem => ({
  name: r.name,
  description: r.description,
  quantity: parseDecimal(r.quantity) ?? 0,
  unit: r.unit,
  unitPriceKc: parseDecimal(r.unitPrice) ?? 0,
});

const EMPTY_ROW: ItemRow = { name: '', description: '', quantity: '1', unit: 'ks', unitPrice: '0' };

interface Props {
  rows: ItemRow[];
  onChange: (rows: ItemRow[]) => void;
}

export default function InvoiceItemsEditor({ rows, onChange }: Props) {
  const set = (idx: number, patch: Partial<ItemRow>) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const units = (current: string) => (INVOICE_UNITS as readonly string[]).includes(current) ? [...INVOICE_UNITS] : [current, ...INVOICE_UNITS];

  return (
    <View>
      {rows.length === 0 && <Text style={styles.empty}>Zatím žádná položka.</Text>}
      {rows.map((r, idx) => {
        const qOk = parseDecimal(r.quantity) !== null;
        const pOk = parseDecimal(r.unitPrice) !== null;
        return (
          <View key={idx} style={[styles.item, idx > 0 && styles.itemBorder]}>
            <TextInput
              style={styles.input}
              value={r.name}
              onChangeText={(t) => set(idx, { name: t })}
              placeholder="Název položky"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Název položky"
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
            <TextInput
              style={styles.input}
              value={r.description}
              onChangeText={(t) => set(idx, { description: t })}
              placeholder="Popis (nepovinné)"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Popis položky"
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.qty, !qOk && styles.invalid]}
                value={r.quantity}
                onChangeText={(t) => set(idx, { quantity: t })}
                keyboardType="decimal-pad"
                accessibilityLabel="Množství"
                inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
              />
              <TextInput
                style={[styles.input, styles.price, !pOk && styles.invalid]}
                value={r.unitPrice}
                onChangeText={(t) => set(idx, { unitPrice: t })}
                keyboardType="decimal-pad"
                accessibilityLabel="Cena za jednotku v Kč"
                inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
              />
              <Text style={styles.priceUnit}>Kč/{r.unit || 'jedn.'}</Text>
              <TouchableOpacity
                style={styles.del}
                onPress={() => onChange(rows.filter((_, i) => i !== idx))}
                accessibilityLabel="Smazat položku"
                hitSlop={4}
              >
                <Text style={styles.delText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.units} keyboardShouldPersistTaps="handled">
              {units(r.unit).map((u) => {
                const on = r.unit === u;
                return (
                  <TouchableOpacity key={u} style={[styles.unit, on && styles.unitOn]} onPress={() => set(idx, { unit: u })} accessibilityLabel={`Jednotka ${u}`}>
                    <Text style={[styles.unitText, on && styles.unitTextOn]}>{u}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.tot}>
              <Text style={styles.totLabel}>množství · jednotka · Kč/jedn.</Text>
              <Text style={styles.totValue}>{kcInvoice(itemTotal(rowToItem(r)))}</Text>
            </View>
          </View>
        );
      })}
      <TouchableOpacity style={styles.add} onPress={() => onChange([...rows, { ...EMPTY_ROW }])}>
        <Text style={styles.addText}>+ Přidat položku</Text>
      </TouchableOpacity>
    </View>
  );
}

// Rozměry podle předlohy (.it, .row, .del, .add, .tot).
const styles = StyleSheet.create({
  empty: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), padding: 14 },
  item: { paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  itemBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: fs(15),
    minHeight: MIN_TOUCH,
    paddingHorizontal: 10,
  },
  invalid: { borderColor: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qty: { width: 72, textAlign: 'right' },
  price: { flex: 1, textAlign: 'right' },
  priceUnit: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), minWidth: 54 },
  del: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  delText: { color: colors.danger, fontSize: fs(16), fontFamily: fonts.bodySemiBold },
  units: { gap: 6 },
  unit: { minHeight: 36, minWidth: 44, paddingHorizontal: 10, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  unitOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  unitText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  unitTextOn: { color: colors.onAccent },
  tot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totLabel: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13) },
  totValue: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(18) },
  add: { minHeight: 50, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  addText: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(16) },
});
