// Štítek stavu zakázky (etapa 5) - podle předlohy private/predloha-zakazky.html
// (.bd: 11 px, tučně, verzálky, 3/7 px, zaoblení 3).

import { StyleSheet, Text, View } from 'react-native';

import type { OrderStatus } from '@/lib/types';
import { colors, fonts, fs } from '@/theme';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  preparing: 'Připravuje se',
  running: 'Běží',
  done: 'Dokončeno – k fakturaci',
  invoiced: 'Vyfakturováno',
  paid: 'Zaplaceno',
};

const INVOICED_BLUE = '#7FA7C9';
const PAID_GREEN = '#4CAF78';

export default function OrderBadge({ status }: { status: OrderStatus }) {
  const style =
    status === 'running'
      ? styles.running
      : status === 'invoiced'
        ? styles.invoiced
        : status === 'paid'
          ? styles.paid
          : styles.neutral;
  const textStyle =
    status === 'running' ? styles.textDark : status === 'invoiced' ? styles.textBlue : status === 'paid' ? styles.textGreen : styles.textLight;
  return (
    <View style={[styles.badge, style]}>
      <Text style={[styles.text, textStyle]}>{ORDER_STATUS_LABEL[status].toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 7, borderRadius: 3 },
  running: { backgroundColor: colors.accent },
  neutral: { backgroundColor: colors.border },
  invoiced: { borderWidth: 1, borderColor: INVOICED_BLUE },
  paid: { borderWidth: 1, borderColor: PAID_GREEN },
  text: { fontFamily: fonts.bodySemiBold, fontSize: fs(11), letterSpacing: 0.66 },
  textDark: { color: colors.onAccent },
  textLight: { color: colors.text },
  textBlue: { color: INVOICED_BLUE },
  textGreen: { color: PAID_GREEN },
});

export { INVOICED_BLUE };
