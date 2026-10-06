// Nová / upravit zakázku (etapa 5): název, odběratel (vybrat nebo nový -
// název, IČO, DIČ, adresa), přiřazená místa, období, stav, cena podle
// ceníku / pevná / rozpočet, poznámka. Po uložení se zápisy a přejezdy
// na místech zakázky v jejím období přiřadí automaticky.

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import { ORDER_STATUS_LABEL } from '@/components/OrderBadge';
import ScreenHeader from '@/components/ScreenHeader';
import { toIsoDate } from '@/lib/format';
import { deleteOrder, earlierWorkOnPlaces, getOrder, listClients, resolveEarlierWork, saveClient, saveOrder, workPlaces } from '@/lib/orders';
import type { Client, OrderPriceMode, OrderStatus, Place } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

const STATUSES: OrderStatus[] = ['preparing', 'running', 'done', 'invoiced', 'paid'];
const PRICE_MODES: { key: OrderPriceMode; label: string }[] = [
  { key: 'rates', label: 'Podle ceníku' },
  { key: 'fixed', label: 'Pevná cena' },
  { key: 'budget', label: 'Rozpočet' },
];

const toCz = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}` : '');
function fromCz(text: string): string | null | undefined {
  if (!text.trim()) return null;
  const m = /^\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s*$/.exec(text);
  return m ? toIsoDate(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : undefined;
}
const parseKc = (text: string): number | null => {
  const v = Number(text.replace(/\s/g, '').replace(',', '.'));
  return text.trim() && Number.isFinite(v) && v >= 0 ? v : null;
};

export default function OrderEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const orderId = id ? Number(id) : null;
  const [loaded, setLoaded] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState<number | null>(null);
  const [newClient, setNewClient] = useState<Omit<Client, 'id'> | null>(null);
  const [status, setStatus] = useState<OrderStatus>('running');
  const [priceMode, setPriceMode] = useState<OrderPriceMode>('rates');
  const [amount, setAmount] = useState('');
  const [dateFrom, setDateFrom] = useState(toCz(toIsoDate(new Date())));
  const [dateTo, setDateTo] = useState('');
  const [placeIds, setPlaceIds] = useState<number[]>([]);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([listClients(), workPlaces()]);
    setClients(c);
    setPlaces(p);
    if (orderId && !loaded) {
      const o = await getOrder(orderId);
      if (o) {
        setName(o.name);
        setClientId(o.clientId);
        setStatus(o.status);
        setPriceMode(o.priceMode);
        setAmount(String((o.priceMode === 'fixed' ? o.fixedPriceKc : o.budgetKc) ?? ''));
        setDateFrom(toCz(o.dateFrom));
        setDateTo(toCz(o.dateTo));
        setPlaceIds(o.placeIds);
        setNote(o.note);
      }
    }
    setLoaded(true);
  }, [orderId, loaded]);

  // useCallback je NUTNÝ - bez něj se `load` spustí po každém překreslení (oprava 2).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Chybí název', 'Zadej název zakázky.');
      return;
    }
    const from = fromCz(dateFrom);
    const to = fromCz(dateTo);
    if (from === undefined || to === undefined || (from && to && to < from)) {
      Alert.alert('Neplatné období', 'Zadej datum ve tvaru 1. 9. 2026 (konec může zůstat prázdný = dosud).');
      return;
    }
    const kc = parseKc(amount);
    if (priceMode !== 'rates' && kc === null) {
      Alert.alert('Chybí částka', priceMode === 'fixed' ? 'Zadej pevnou cenu.' : 'Zadej rozpočet.');
      return;
    }
    let finalClientId = clientId;
    if (newClient && newClient.name.trim()) finalClientId = await saveClient({ ...newClient, name: newClient.name.trim() });
    const original = orderId ? ((await getOrder(orderId))?.placeIds ?? []) : [];
    const savedId = await saveOrder(orderId, {
      name: name.trim(),
      clientId: finalClientId,
      status,
      priceMode,
      fixedPriceKc: priceMode === 'fixed' ? kc : null,
      budgetKc: priceMode === 'budget' ? kc : null,
      dateFrom: from,
      dateTo: to,
      note: note.trim(),
      placeIds,
    });
    const leave = () => (orderId ? router.back() : router.replace(`/order/${savedId}`));
    // Nově přidané místo -> nabídnout dřívější práci na něm (nic samo).
    const added = placeIds.filter((p) => !original.includes(p));
    const earlier = await earlierWorkOnPlaces(savedId, added);
    const count = earlier.recordIds.length + earlier.tripIds.length;
    if (count === 0) {
      leave();
      return;
    }
    const parts = [
      earlier.recordIds.length ? `${earlier.recordIds.length} položek` : null,
      earlier.tripIds.length ? `${earlier.tripIds.length} přejezdů` : null,
    ].filter(Boolean);
    Alert.alert(
      'Dřívější práce na místě',
      `Přiřadit i dřívější práci na ${added.length > 1 ? 'těchto místech' : 'tomto místě'} (${parts.join(', ')})?${
        earlier.invoicedElsewhere ? `\n\n${earlier.invoicedElsewhere} položek je vyfakturovaných jinde - ty se nepřeřadí.` : ''
      }\n\nPoložky s ruční volbou jiné zakázky se nemění.`,
      [
        {
          text: 'Ne, nechat bez zakázky',
          style: 'cancel',
          onPress: async () => {
            await resolveEarlierWork(savedId, earlier, false);
            leave();
          },
        },
        {
          text: 'Přiřadit',
          onPress: async () => {
            await resolveEarlierWork(savedId, earlier, true);
            leave();
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    if (!orderId) return;
    Alert.alert('Smazat zakázku', 'Zápisy zůstanou, jen přestanou patřit k zakázce (vyfakturované zůstanou označené).', [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: async () => {
          await deleteOrder(orderId);
          router.navigate('/zakazky');
        },
      },
    ]);
  };

  if (!loaded) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={orderId ? 'UPRAVIT ZAKÁZKU' : 'NOVÁ ZAKÁZKA'} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>NÁZEV</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="např. Stavba Horní" placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />

        <Text style={styles.label}>ODBĚRATEL</Text>
        <View style={styles.chips}>
          <Chip label="Bez odběratele" on={clientId === null && !newClient} onPress={() => { setClientId(null); setNewClient(null); }} />
          {clients.map((c) => (
            <Chip key={c.id} label={c.name} on={clientId === c.id && !newClient} onPress={() => { setClientId(c.id); setNewClient(null); }} />
          ))}
          <Chip label="+ Nový" on={!!newClient} onPress={() => setNewClient({ name: '', ico: '', dic: '', address: '', note: '' })} />
        </View>
        {newClient && (
          <View style={styles.box}>
            {(['name', 'ico', 'dic', 'address'] as const).map((field) => (
              <TextInput
                key={field}
                style={styles.input}
                value={newClient[field]}
                onChangeText={(t) => setNewClient((c) => (c ? { ...c, [field]: t } : c))}
                placeholder={{ name: 'Název odběratele', ico: 'IČO', dic: 'DIČ', address: 'Adresa' }[field]}
                placeholderTextColor={colors.textMuted}
                keyboardType={field === 'ico' ? 'number-pad' : 'default'}
                inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
              />
            ))}
          </View>
        )}

        <Text style={styles.label}>MÍSTA ZAKÁZKY</Text>
        <Text style={styles.hint}>Zápisy, pobyty a přejezdy na těchto místech v období zakázky se přiřadí automaticky.</Text>
        <View style={styles.chips}>
          {places.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              on={placeIds.includes(p.id)}
              onPress={() => setPlaceIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]))}
            />
          ))}
          {places.length === 0 && <Text style={styles.hint}>Žádná pracovní místa - přidej je v Nastavení → Poloha a trasy.</Text>}
        </View>

        <Text style={styles.label}>OBDOBÍ</Text>
        <View style={styles.dates}>
          <TextInput style={[styles.input, styles.dateInput]} value={dateFrom} onChangeText={setDateFrom} placeholder="od 1. 9. 2026" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
          <Text style={styles.dash}>–</Text>
          <TextInput style={[styles.input, styles.dateInput]} value={dateTo} onChangeText={setDateTo} placeholder="dosud" placeholderTextColor={colors.textMuted} keyboardType="numbers-and-punctuation" inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />
        </View>

        <Text style={styles.label}>STAV</Text>
        <View style={styles.chips}>
          {STATUSES.map((s) => (
            <Chip key={s} label={ORDER_STATUS_LABEL[s]} on={status === s} onPress={() => setStatus(s)} />
          ))}
        </View>

        <Text style={styles.label}>CENA</Text>
        <View style={styles.chips}>
          {PRICE_MODES.map((m) => (
            <Chip key={m.key} label={m.label} on={priceMode === m.key} onPress={() => setPriceMode(m.key)} />
          ))}
        </View>
        {priceMode !== 'rates' && (
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder={priceMode === 'fixed' ? 'Pevná cena Kč' : 'Rozpočet Kč'}
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
          />
        )}
        <Text style={styles.hint}>
          {priceMode === 'rates'
            ? 'K fakturaci podle sazeb uložených u zápisů a km.'
            : priceMode === 'fixed'
              ? 'K fakturaci pevná cena; rozpis podle ceníku jen pro kontrolu.'
              : 'K fakturaci podle ceníku, ukazatel čerpání rozpočtu a upozornění při 90 %.'}
        </Text>

        <Text style={styles.label}>POZNÁMKA</Text>
        <TextInput style={[styles.input, styles.multiline]} value={note} onChangeText={setNote} multiline placeholderTextColor={colors.textMuted} inputAccessoryViewID={KEYBOARD_ACCESSORY_ID} />

        <TouchableOpacity style={styles.save} onPress={handleSave}>
          <Text style={styles.saveText}>ULOŽIT</Text>
        </TouchableOpacity>
        {orderId && (
          <TouchableOpacity style={styles.delete} onPress={handleDelete}>
            <Text style={styles.deleteText}>Smazat zakázku</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 8 },
  label: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(12), letterSpacing: 1, marginTop: 10 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, paddingHorizontal: 12, minHeight: 48, color: colors.text, fontFamily: fonts.body, fontSize: fs(16), backgroundColor: colors.card },
  multiline: { minHeight: 72, textAlignVertical: 'top', paddingTop: 10 },
  box: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: MIN_TOUCH, paddingHorizontal: 12, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  chipTextOn: { color: colors.onAccent },
  dates: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateInput: { flex: 1, textAlign: 'center' },
  dash: { color: colors.textMuted, fontSize: fs(18) },
  save: { height: 54, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  saveText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(18), letterSpacing: 1 },
  delete: { minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
});
