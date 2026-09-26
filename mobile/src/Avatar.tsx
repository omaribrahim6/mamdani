import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { portrait } from './portrait';

export function Avatar({ speaking = false, large = false }: { speaking?: boolean; large?: boolean }) {
  const tilt = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!speaking) { tilt.setValue(0); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(tilt, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(tilt, { toValue: -1, duration: 380, useNativeDriver: true }),
      Animated.timing(tilt, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]));
    animation.start();
    return () => { animation.stop(); tilt.setValue(0); };
  }, [speaking, tilt]);
  const size = large ? 260 : 82;
  return <Animated.View accessibilityLabel="Mamdani avatar" style={[styles.portrait, { width: size, height: size,
    borderRadius: large ? 48 : 28, transform: [{ rotate: tilt.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-3deg', '0deg', '3deg'] }) }] }]}>
    {portrait ? <Image source={portrait} style={styles.image} resizeMode="cover" /> : <View style={styles.placeholder}>
      <Text style={[styles.initial, { fontSize: large ? 132 : 42, lineHeight: large ? 150 : 50 }]}>M</Text>
      {large && <Text style={styles.note}>MAMDANI · PHOTO COMING SOON</Text>}
    </View>}
  </Animated.View>;
}
const styles = StyleSheet.create({
  portrait: { backgroundColor: '#d9d7d1', overflow: 'hidden', borderWidth: 2, borderColor: '#ff2e88' },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#26292c', fontWeight: '900' },
  note: { fontSize: 9, color: '#5b6166', letterSpacing: 1 },
});
