// Kořen každé obrazovky - JEDINÉ místo, kde se řeší bezpečné okraje
// (stavový řádek / Dynamic Island nahoře, home indikátor dole), ať se
// tlačítka pod ně nedostanou.
// - obrazovka ve stacku: okraj nahoře i dole (pevná tlačítka dole i konec
//   posouvaného obsahu jsou nad home indikátorem)
// - záložka (`tab`): jen nahoře, dole je lišta záložek, která okraj řeší sama
// Celoobrazovkové modaly: components/ScreenModal.tsx (uvnitř Modal
// SafeAreaView okraje nedostane).

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface SafeScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tab?: boolean;
}

export default function SafeScreen({ children, style, tab = false }: SafeScreenProps) {
  return (
    <SafeAreaView style={style} edges={tab ? ['top'] : ['top', 'bottom']}>
      {children}
    </SafeAreaView>
  );
}
