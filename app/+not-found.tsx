import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Stránka nenalezena', headerShown: true }} />
      <View style={styles.container}>
        <Text style={styles.title}>Tahle obrazovka neexistuje.</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Zpět na kalendář</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.bodySemiBold,
    color: colors.text,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
    fontFamily: fonts.body,
    color: colors.accent,
  },
});
