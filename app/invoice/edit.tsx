// Faktura (koncept / vystavená / zrušená) - podle předlohy predloha-faktura.html:
// odběratel, co se fakturuje, číslo faktury = VS, datum vystavení,
// splatnost (dny + 7/14/30), forma úhrady, příloha "výpis prací po dnech",
// náhled PDF, sdílení, uložení konceptu a vystavení.
//
// Sdílení konceptu nic nemění (PDF s nápisem KONCEPT). Teprve "Vystavit
// fakturu" fakturu zamkne, přidělí číslo z řady a odečte práci
// z Nevyfakturováno; při nižších hodinách se zeptá, co se zbytkem.
//
// Parametry: ?id= (uložená faktura), ?orderId= (nová ze zakázky - když už
// koncept ze zakázky existuje, otevře se ten), bez parametrů = bez zakázky.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import InvoiceItemsEditor, { itemToRow, rowToItem, type ItemRow } from '@/components/InvoiceItemsEditor';
import InvoicePreview from '@/components/InvoicePreview';
import SafeScreen from '@/components/SafeScreen';
import { KEYBOARD_ACCESSORY_ID } from '@/components/KeyboardDoneAccessory';
import ScreenHeader from '@/components/ScreenHeader';
import ToggleRow from '@/components/ToggleRow';
import { addDaysIso, czDate, formatDecimal, hoursMismatch, invoiceTotal, isValidInvoiceNumber, itemTotal, parseCzDate, parseDecimal } from '@/lib/invoiceCalc';
import { invoiceFontsCss } from '@/lib/invoiceFonts';
import { invoiceHtml, kcInvoice } from '@/lib/invoiceReport';
import {
  cancelInvoice,
  clientParty,
  deleteDraft,
  findDraftForOrder,
  getInvoice,
  invoiceNumberTaken,
  issueInvoice,
  newInvoice,
  prepareIssue,
  refreshDraft,
  saveInvoice,
  setInvoicePaid,
  suggestInvoiceNumber,
} from '@/lib/invoices';
import { listClients, saveClient } from '@/lib/orders';
import { A4_NO_MARGINS, sharePdfFromHtml } from '@/lib/shareFile';
import type { Client, Invoice, InvoiceParty, InvoicePayment, RemainderMode } from '@/lib/types';
import { colors, fonts, fs, MIN_TOUCH, radii } from '@/theme';

const DUE_CHOICES = [7, 14, 30];
const STATUS_LABEL = { draft: 'KONCEPT', issued: 'VYSTAVENO', paid: 'ZAPLACENO', cancelled: 'ZRUŠENÁ' } as const;

export default function InvoiceEditScreen() {
  const params = useLocalSearchParams<{ id?: string; orderId?: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [issueText, setIssueText] = useState('');
  const [daysText, setDaysText] = useState('');
  const [takenNumbers, setTakenNumbers] = useState<Record<string, boolean>>({});
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  // Poznámky ke dnům ve výpisu prací - jen pro tohle sdílení, výchozí vypnuto
  // (faktura jde ven, nic se nepřidá samo).
  const [withNotes, setWithNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [newClient, setNewClient] = useState<InvoiceParty | null>(null);

  // Načte se jednou při otevření (ne při každém návratu na obrazovku -
  // přepsalo by to rozepsané úpravy).
  useEffect(() => {
    (async () => {
      setClients(await listClients());
      let loaded: Invoice | null = null;
      if (params.id) loaded = await getInvoice(Number(params.id));
      else if (params.orderId) {
        const draftId = await findDraftForOrder(Number(params.orderId));
        loaded = draftId !== null ? await getInvoice(draftId) : await newInvoice(Number(params.orderId));
      } else loaded = await newInvoice(null);
      if (!loaded) {
        Alert.alert('Faktura nenalezena');
        router.back();
        return;
      }
      if (loaded.id !== null) loaded = await refreshDraft(loaded);
      setInv(loaded);
      setRows(loaded.items.map(itemToRow));
      setIssueText(czDate(loaded.issueDate));
      setDaysText(String(loaded.dueDays));
    })();
  }, [params.id, params.orderId]);

  // Seznam odběratelů znovu po návratu ze "Spravovat odběratele".
  useFocusEffect(
    useCallback(() => {
      listClients().then(setClients);
    }, [])
  );

  // Duplicita ručně zadaného čísla - hlídá se průběžně (výsledek podle čísla).
  const checkNumber = inv && inv.status === 'draft' && inv.numberManual && isValidInvoiceNumber(inv.number) ? inv.number : null;
  const invId = inv?.id ?? null;
  useEffect(() => {
    if (checkNumber === null) return;
    let live = true;
    invoiceNumberTaken(checkNumber, invId).then((t) => live && setTakenNumbers((m) => ({ ...m, [checkNumber]: t })));
    return () => {
      live = false;
    };
  }, [checkNumber, invId]);

  const changeRows = (next: ItemRow[]) => {
    setRows(next);
    setInv((v) => (v ? { ...v, items: next.map(rowToItem) } : v));
  };

  const update = useCallback((patch: Partial<Invoice>) => setInv((v) => (v ? { ...v, ...patch } : v)), []);

  if (!inv) {
    return (
      <SafeScreen style={styles.container}>
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      </SafeScreen>
    );
  }

  const draft = inv.status === 'draft';
  const fromOrder = inv.orderId !== null;
  const total = invoiceTotal(inv.items);
  const numberOk = isValidInvoiceNumber(inv.number);
  const numberTaken = draft && inv.numberManual && numberOk && takenNumbers[inv.number] === true;
  const issueOk = parseCzDate(issueText) !== null;
  const dueDate = addDaysIso(inv.issueDate, inv.dueDays);
  const noAccount = inv.payment === 'transfer' && !inv.supplier.iban;
  const mismatch = fromOrder ? hoursMismatch(inv.items, inv.workLog, inv.carries) : null;
  const current = (): Invoice => ({ ...inv, dueDate, totalKc: total });

  // Nový odběratel z faktury se uloží do seznamu odběratelů.
  const withClient = async (): Promise<Invoice> => {
    if (!newClient || !newClient.name.trim()) return current();
    const party = { name: newClient.name.trim(), address: newClient.address.trim(), ico: newClient.ico.trim(), dic: newClient.dic.trim() };
    const clientId = await saveClient({ ...party, note: '' });
    setClients(await listClients());
    setNewClient(null);
    const next = { ...current(), clientId, client: party };
    setInv(next);
    return next;
  };

  const setIssue = (text: string) => {
    setIssueText(text);
    const iso = parseCzDate(text);
    if (iso) update({ issueDate: iso });
  };
  const setDays = (text: string) => {
    const t = text.replace(/\D/g, '').slice(0, 3);
    setDaysText(t);
    if (t !== '') update({ dueDays: Number(t) });
  };

  const validate = (forIssue: boolean): boolean => {
    if (!numberOk) {
      Alert.alert('Číslo faktury', 'Číslo faktury (variabilní symbol) smí mít jen číslice, nejvýš 10.');
      return false;
    }
    if (numberTaken) {
      Alert.alert('Číslo faktury', `Faktura č. ${inv.number} už byla vystavená (i zrušená čísla se znovu nepoužívají) - zvol jiné.`);
      return false;
    }
    if (rows.some((r) => parseDecimal(r.quantity) === null || parseDecimal(r.unitPrice) === null)) {
      Alert.alert('Položky', 'Množství a cena musí být číslo (desetinná čárka), např. 6,5.');
      return false;
    }
    if (!issueOk) {
      Alert.alert('Datum vystavení', 'Zadej datum ve tvaru d. m. rrrr, např. 28. 10. 2026.');
      return false;
    }
    if (forIssue && !(newClient?.name ?? inv.client?.name ?? '').trim()) {
      Alert.alert('Odběratel', 'Vyber odběratele faktury.');
      return false;
    }
    if (forIssue && inv.items.filter((i) => i.name.trim()).length === 0) {
      Alert.alert('Položky', 'Faktura nemá žádnou položku.');
      return false;
    }
    return true;
  };

  const saveDraft = async () => {
    if (!validate(false)) return;
    setBusy(true);
    try {
      const id = await saveInvoice(await withClient());
      update({ id });
      Alert.alert('Koncept uložen', 'Koncept faktury je uložený. Číslo se přidělí až při vystavení.');
    } finally {
      setBusy(false);
    }
  };

  const html = async (doc: Invoice, mode: 'print' | 'preview') => invoiceHtml(doc, { mode, fontsCss: await invoiceFontsCss(), withNotes });

  const openPreview = async () => {
    setBusy(true);
    try {
      const party = newClient && newClient.name.trim() ? newClient : inv.client;
      setPreviewHtml(await html({ ...current(), client: party }, 'preview'));
    } finally {
      setBusy(false);
    }
  };

  const sharePdf = async (doc: Invoice) => {
    await sharePdfFromHtml(await html(doc, 'print'), `Faktura-${doc.number}`, `Faktura č. ${doc.number}`, A4_NO_MARGINS);
  };

  // PDF konceptu (s nápisem KONCEPT) - nic se neukládá ani nemění.
  const shareCurrent = async () => {
    setPreviewHtml(null);
    setBusy(true);
    try {
      const party = newClient && newClient.name.trim() ? newClient : inv.client;
      await sharePdf(draft ? { ...current(), client: party } : inv);
    } catch (err) {
      Alert.alert('Sdílení se nepovedlo', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Vystavení: (zbytek hodin?) -> potvrzení -> vystavit -> nabídnout sdílení.
  const issue = async () => {
    if (!validate(true)) return;
    setPreviewHtml(null);
    const party = newClient && newClient.name.trim() ? newClient : inv.client;
    const { invoice: ready, remainder } = await prepareIssue({ ...current(), client: party });
    const amount = kcInvoice(invoiceTotal(ready.items));

    const go = async (mode: RemainderMode | null) => {
      setBusy(true);
      try {
        const base = await withClient();
        const issued = await issueInvoice({ ...base, items: ready.items }, mode);
        setInv(issued);
        Alert.alert(`Faktura č. ${issued.number} je vystavená`, 'Poslat PDF odběrateli?', [
          { text: 'Později', style: 'cancel' },
          {
            text: 'Sdílet PDF',
            onPress: () =>
              sharePdf(issued).catch((err) => Alert.alert('Sdílení se nepovedlo', err instanceof Error ? err.message : String(err))),
          },
        ]);
      } catch (err) {
        Alert.alert('Faktura se nevystavila', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    const confirm = (mode: RemainderMode | null) => {
      const extra = [
        fromOrder ? 'Práce ve výpisu se odečte z „Nevyfakturováno“.' : '',
        mode === 'carry' && remainder ? `Zbytek ${formatDecimal(remainder.hours)} h zůstane k fakturaci později.` : '',
        mode === 'writeoff' && remainder ? `Zbytek ${formatDecimal(remainder.hours)} h se odepíše (sleva).` : '',
        noAccount ? 'Chybí číslo účtu - faktura bude bez QR Platby.' : '',
      ].filter(Boolean);
      Alert.alert(`Vystavit fakturu č. ${ready.number} na ${amount}?`, ['Potom už nepůjde měnit.', ...extra].join('\n\n'), [
        { text: 'Zrušit', style: 'cancel' },
        { text: 'Vystavit', onPress: () => go(mode) },
      ]);
    };

    if (remainder) {
      const workHours = formatDecimal(remainder.hours + (hoursMismatch(ready.items, ready.workLog, ready.carries)?.itemHours ?? 0));
      const itemHours = formatDecimal(hoursMismatch(ready.items, ready.workLog, ready.carries)?.itemHours ?? 0);
      Alert.alert(`Odpracováno ${workHours} h, fakturuješ ${itemHours} h.`, `Co se zbytkem ${formatDecimal(remainder.hours)} h?`, [
        { text: 'Nechat k fakturaci později', onPress: () => confirm('carry') },
        { text: 'Odepsat (sleva)', onPress: () => confirm('writeoff') },
        { text: 'Zpět', style: 'cancel' },
      ]);
    } else confirm(null);
  };

  const resetNumber = async () => update({ numberManual: false, number: await suggestInvoiceNumber(inv.issueDate) });

  const remove = () => {
    if (draft) {
      Alert.alert('Smazat koncept?', undefined, [
        { text: 'Ne', style: 'cancel' },
        {
          text: 'Smazat',
          style: 'destructive',
          onPress: async () => {
            await deleteDraft(inv);
            router.back();
          },
        },
      ]);
      return;
    }
    Alert.alert(
      `Zrušit fakturu č. ${inv.number}?`,
      ['Faktura zůstane v seznamu jako zrušená, její číslo se už nepoužije.', fromOrder ? 'Práce ze zakázky bude zase nevyfakturovaná.' : ''].filter(Boolean).join('\n\n'),
      [
        { text: 'Ne', style: 'cancel' },
        {
          text: 'Zrušit fakturu',
          style: 'destructive',
          onPress: async () => {
            await cancelInvoice(inv);
            const fresh = inv.id !== null ? await getInvoice(inv.id) : null;
            if (fresh) setInv(fresh);
          },
        },
      ]
    );
  };

  const togglePaid = async () => {
    await setInvoicePaid(inv, inv.status !== 'paid');
    const fresh = inv.id !== null ? await getInvoice(inv.id) : null;
    if (fresh) setInv(fresh);
  };

  const pickClient = (c: Client) => {
    setNewClient(null);
    update({ clientId: c.id, client: clientParty(c) });
  };

  return (
    <SafeScreen style={styles.container}>
      <ScreenHeader
        title="FAKTURA"
        subtitle={fromOrder ? `Ze zakázky ${inv.orderName ?? ''}` : 'Bez zakázky'}
        right={<Text style={[styles.status, inv.status === 'paid' && styles.statusPaid, inv.status === 'cancelled' && styles.statusCancelled]}>{STATUS_LABEL[inv.status]}</Text>}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {inv.status === 'cancelled' && <Text style={styles.cancelled}>Faktura je zrušená - její číslo se už nepoužije. PDF jde sdílet s nápisem ZRUŠENO.</Text>}
        {(inv.status === 'issued' || inv.status === 'paid') && <Text style={styles.hint}>Vystavená faktura se už nemění - PDF jde kdykoli sdílet znovu stejné.</Text>}
        {inv.remainder && (
          <Text style={styles.hint}>
            Zbytek {formatDecimal(inv.remainder.hours)} h: {inv.remainder.mode === 'carry' ? 'ponechán k fakturaci později' : 'odepsán (sleva)'}.
          </Text>
        )}

        <Text style={styles.section}>ODBĚRATEL</Text>
        <View style={styles.group}>
          {draft ? (
            <View style={styles.chips}>
              {clients.map((c) => {
                const on = inv.clientId === c.id;
                return (
                  <TouchableOpacity key={c.id} style={[styles.chip, on && styles.chipOn]} onPress={() => pickClient(c)}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.name}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.chip, newClient !== null && styles.chipOn]}
                onPress={() => setNewClient((c) => c ?? { name: '', address: '', ico: '', dic: '' })}
              >
                <Text style={[styles.chipText, newClient !== null && styles.chipTextOn]}>+ Nový odběratel</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {draft && newClient && (
            <View style={styles.newClient}>
              {(['name', 'address', 'ico', 'dic'] as const).map((field) => (
                <TextInput
                  key={field}
                  style={styles.clientInput}
                  value={newClient[field]}
                  onChangeText={(t) => setNewClient((c) => (c ? { ...c, [field]: t } : c))}
                  placeholder={{ name: 'Jméno / firma', address: 'Adresa', ico: 'IČO', dic: 'DIČ (nepovinné)' }[field]}
                  placeholderTextColor={colors.textMuted}
                  keyboardType={field === 'ico' ? 'number-pad' : 'default'}
                  multiline={field === 'address'}
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                />
              ))}
              <Text style={styles.hintInline}>Uloží se do seznamu odběratelů s fakturou.</Text>
            </View>
          )}
          {inv.client && !newClient && (
            <Text style={styles.party}>
              {[inv.client.name, inv.client.address, inv.client.ico ? `IČO ${inv.client.ico}` : '', inv.client.dic ? `DIČ ${inv.client.dic}` : ''].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        {draft && (
          <TouchableOpacity onPress={() => router.push('/invoice/clients')} hitSlop={6}>
            <Text style={styles.link}>Spravovat odběratele ›</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.section}>CO SE FAKTURUJE</Text>
        <View style={styles.group}>
          {draft && <InvoiceItemsEditor rows={rows} onChange={changeRows} />}
          {!draft && inv.items.map((i, idx) => (
            <View key={idx} style={[styles.itemRow, idx > 0 && styles.itemBorder]}>
              <View style={styles.itemText}>
                <Text style={styles.itemName}>{i.name || '—'}</Text>
                <Text style={styles.itemSub}>
                  {formatDecimal(i.quantity)} {i.unit} × {kcInvoice(i.unitPriceKc)}
                  {i.description ? ` · ${i.description}` : ''}
                </Text>
              </View>
              <Text style={styles.itemTotal}>{kcInvoice(itemTotal(i))}</Text>
            </View>
          ))}
          {mismatch && (
            <Text style={styles.warn}>
              Ve zakázce je odpracováno {formatDecimal(mismatch.workHours)} h, na faktuře {formatDecimal(mismatch.itemHours)} h. Výpis prací ukazuje skutečné hodiny.
            </Text>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Celkem</Text>
            <Text style={styles.totalValue}>{kcInvoice(total)}</Text>
          </View>
        </View>

        <Text style={styles.section}>ÚDAJE FAKTURY</Text>
        <View style={styles.group}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Číslo faktury / VS</Text>
            <TextInput
              style={styles.fieldInput}
              value={inv.number}
              onChangeText={(t) => update({ number: t.trim(), numberManual: true })}
              keyboardType="number-pad"
              maxLength={10}
              editable={draft}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          </View>
          {!numberOk && <Text style={styles.error}>Jen číslice, nejvýš 10.</Text>}
          {draft && !inv.numberManual && <Text style={styles.hint}>Přidělí se při vystavení - další volné číslo z řady.</Text>}
          {draft && inv.numberManual && (
            <TouchableOpacity onPress={resetNumber} hitSlop={6}>
              <Text style={[styles.hint, styles.linkText]}>Vlastní číslo · vrátit automatické z řady ›</Text>
            </TouchableOpacity>
          )}
          {numberOk && numberTaken && <Text style={styles.error}>Faktura s tímto číslem už existuje.</Text>}
          <View style={[styles.field, styles.fieldBorder]}>
            <Text style={styles.fieldLabel}>Datum vystavení</Text>
            <TextInput
              style={styles.fieldInput}
              value={issueText}
              onChangeText={setIssue}
              placeholder="d. m. rrrr"
              placeholderTextColor={colors.textMuted}
              keyboardType="numbers-and-punctuation"
              editable={draft}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          </View>
          {!issueOk && <Text style={styles.error}>Datum ve tvaru d. m. rrrr.</Text>}
        </View>

        <Text style={styles.section}>SPLATNOST</Text>
        <View style={styles.group}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Počet dní</Text>
            <TextInput
              style={[styles.fieldInput, styles.daysInput]}
              value={daysText}
              onChangeText={setDays}
              onBlur={() => daysText === '' && setDays(String(inv.dueDays))}
              keyboardType="number-pad"
              editable={draft}
              inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
            />
          </View>
          {draft && (
            <View style={[styles.chips, styles.fieldBorder]}>
              {DUE_CHOICES.map((d) => {
                const on = inv.dueDays === d;
                return (
                  <TouchableOpacity key={d} style={[styles.chip, on && styles.chipOn]} onPress={() => setDays(String(d))}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{d} dní</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <Text style={styles.hint}>
            Splatnost: <Text style={styles.hintStrong}>{czDate(dueDate)}</Text>
          </Text>
        </View>

        <Text style={styles.section}>FORMA ÚHRADY</Text>
        <View style={styles.group}>
          <View style={styles.chips}>
            {(['transfer', 'cash'] as InvoicePayment[]).map((p) => {
              const on = inv.payment === p;
              return (
                <TouchableOpacity key={p} style={[styles.chip, on && styles.chipOn]} disabled={!draft} onPress={() => update({ payment: p })}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{p === 'transfer' ? 'Převodem' : 'Hotově'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {noAccount ? (
            <TouchableOpacity onPress={() => router.push('/settings/odberatele')} disabled={!draft}>
              <Text style={styles.warn}>Doplň číslo účtu v Nastavení › Moje údaje - bez něj faktura nebude mít QR Platbu.</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.hint}>{inv.payment === 'transfer' ? 'Na faktuře bude číslo účtu a QR Platba.' : 'Bez čísla účtu a QR kódu.'}</Text>
          )}
        </View>

        {fromOrder && (
          <>
            <Text style={styles.section}>PŘÍLOHA</Text>
            <ToggleRow
              label="Výpis prací po dnech"
              description={inv.workLog && inv.workLog.length > 0 ? 'Přidá 2. stranu s rozpisem' : 'Zakázka nemá nevyfakturovanou práci'}
              value={inv.withWorkLog}
              disabled={!draft}
              onValueChange={(v) => update({ withWorkLog: v })}
            />
            {inv.withWorkLog && (inv.workNotes?.length ?? 0) > 0 && (
              <ToggleRow
                label="Zahrnout poznámky ke dnům"
                description="Do výpisu prací pod řádek dne. Výchozí vypnuto - faktura jde ven"
                value={withNotes}
                onValueChange={setWithNotes}
              />
            )}
          </>
        )}

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.secondary} onPress={openPreview} disabled={busy}>
            <Text style={styles.secondaryText}>NÁHLED PDF</Text>
          </TouchableOpacity>
          {draft && (
            <>
              <TouchableOpacity style={styles.secondary} onPress={shareCurrent} disabled={busy}>
                <Text style={styles.secondaryText}>SDÍLET KONCEPT (PDF)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={saveDraft} disabled={busy}>
                <Text style={styles.secondaryText}>ULOŽIT KONCEPT</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primary} onPress={issue} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryText}>VYSTAVIT FAKTURU</Text>}
              </TouchableOpacity>
            </>
          )}
          {!draft && (
            <TouchableOpacity style={styles.primary} onPress={shareCurrent} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryText}>SDÍLET (PDF)</Text>}
            </TouchableOpacity>
          )}
          {(inv.status === 'issued' || inv.status === 'paid') && (
            <TouchableOpacity style={styles.secondary} onPress={togglePaid} disabled={busy}>
              <Text style={styles.secondaryText}>{inv.status === 'paid' ? 'OZNAČIT NEZAPLACENO' : 'OZNAČIT ZAPLACENO'}</Text>
            </TouchableOpacity>
          )}
          {inv.id !== null && inv.status !== 'cancelled' && (
            <TouchableOpacity style={styles.danger} onPress={remove} disabled={busy}>
              <Text style={styles.dangerText}>{draft ? 'Smazat koncept' : 'Zrušit fakturu'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <InvoicePreview
        html={previewHtml}
        title={draft ? 'KONCEPT FAKTURY' : `FAKTURA ${inv.number}`}
        actions={
          draft
            ? [
                { label: 'Sdílet koncept', onPress: shareCurrent },
                { label: 'VYSTAVIT', onPress: issue, primary: true },
              ]
            : [{ label: 'SDÍLET', onPress: shareCurrent, primary: true }]
        }
        onClose={() => setPreviewHtml(null)}
      />
    </SafeScreen>
  );
}

// Rozměry podle předlohy (.grp, .fld, .chip, .btn, .warn, .gtot).
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { marginTop: 40 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  status: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(13), letterSpacing: 1 },
  statusPaid: { color: '#4CAF78' },
  statusCancelled: { color: colors.danger },
  cancelled: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(13), marginTop: 6 },
  linkText: { color: colors.accent },
  section: { color: colors.textMuted, fontFamily: fonts.headingBold, fontSize: fs(15), letterSpacing: 1.2, marginTop: 10 },
  group: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(14) },
  chipTextOn: { color: colors.onAccent },
  newClient: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  clientInput: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, color: colors.text, fontFamily: fonts.body, fontSize: fs(15), minHeight: MIN_TOUCH, paddingHorizontal: 10 },
  hintInline: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(12) },
  link: { color: colors.accent, fontFamily: fonts.bodySemiBold, fontSize: fs(13), paddingVertical: 4 },
  party: { color: colors.text, fontFamily: fonts.body, fontSize: fs(14), paddingHorizontal: 14, paddingBottom: 12 },
  hint: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2 },
  hintStrong: { color: colors.text, fontFamily: fonts.bodySemiBold },
  warn: { color: colors.accent, fontFamily: fonts.body, fontSize: fs(13), paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  error: { color: colors.danger, fontFamily: fonts.body, fontSize: fs(13), paddingHorizontal: 14, paddingBottom: 10 },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 54, paddingHorizontal: 14, paddingVertical: 4 },
  fieldBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  fieldLabel: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  fieldInput: { minWidth: 150, minHeight: MIN_TOUCH, textAlign: 'right', color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(17) },
  daysInput: { minWidth: 90 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  itemBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  itemText: { flex: 1 },
  itemName: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  itemSub: { color: colors.textMuted, fontFamily: fonts.body, fontSize: fs(13), marginTop: 2 },
  itemTotal: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(18) },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  totalLabel: { color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
  totalValue: { color: colors.accent, fontFamily: fonts.headingBold, fontSize: fs(26) },
  buttons: { gap: 8, marginTop: 12 },
  primary: { height: 52, borderRadius: radii.card, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.onAccent, fontFamily: fonts.headingBold, fontSize: fs(19), letterSpacing: 0.95 },
  secondary: { height: 52, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontFamily: fonts.headingBold, fontSize: fs(19), letterSpacing: 0.95 },
  danger: { minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: colors.danger, fontFamily: fonts.bodySemiBold, fontSize: fs(15) },
});
