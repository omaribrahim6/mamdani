import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C, F, T } from './theme';

/** Four spray-painted corner marks: "put the problem here". They breathe while Mamdani looks. */
export function Guides({ focusing = false }: { focusing?: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!focusing) return;
    const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: ease, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: ease, useNativeDriver: true }),
      ]),
    );
    breathe.start();
    return () => breathe.stop();
  }, [focusing, pulse]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const { w, h } = size;
  const k = 0.14; // arm length as a share of the frame
  const ax = w * k;
  const ay = Math.min(h * k * 1.4, ax * 1.2);
  const i = 4;
  const paths = w
    ? [
        `M${i},${i + ay} L${i},${i} L${i + ax},${i}`,
        `M${w - i - ax},${i} L${w - i},${i} L${w - i},${i + ay}`,
        `M${w - i},${h - i - ay} L${w - i},${h - i} L${w - i - ax},${h - i}`,
        `M${i + ax},${h - i} L${i},${h - i} L${i},${h - i - ay}`,
      ]
    : [];

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={onLayout}
      style={[styles.guides, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) }] }]}
    >
      <Svg width={w} height={h}>
        {paths.map((d) => (
          <Path key={d} d={d} stroke={C.survey} strokeOpacity={0.35} strokeWidth={12} strokeLinecap="round" fill="none" />
        ))}
        {paths.map((d) => (
          <Path key={d + 'c'} d={d} stroke={C.survey} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ))}
      </Svg>
    </Animated.View>
  );
}

/** Speech bubble above his head, kept on screen, tail still pointing at him. */
export function Bubble({ at, w, h, text }: { at: { x: number; y: number }; w: number; h: number; text: string }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 9 }).start();
  }, [pop]);
  const bw = Math.min(280, w * 0.74);
  const headX = at.x * w;
  const left = Math.max(12, Math.min(w - 12 - bw, headX - bw / 2));
  const tail = Math.max(22, Math.min(bw - 22, headX - left));
  const headY = Math.max(110, at.y * h);
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.bubble,
        {
          left,
          width: bw,
          bottom: h - headY + 14,
          opacity: pop,
          transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }, { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        },
      ]}
    >
      <Text style={styles.bubbleText}>{text}</Text>
      <View style={[styles.tail, { left: tail - 9 }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  guides: { position: 'absolute', top: '18%', left: '10%', width: '80%', height: '52%' },
  bubble: {
    position: 'absolute',
    zIndex: 4,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 9,
    backgroundColor: C.paper,
    borderColor: C.asphalt,
    borderWidth: 2.5,
    borderRadius: 16,
  },
  bubbleText: { fontFamily: F.uiBold, fontSize: T.md, lineHeight: 21, color: C.asphalt },
  tail: {
    position: 'absolute',
    bottom: -9.5,
    width: 16,
    height: 16,
    backgroundColor: C.paper,
    borderRightWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: C.asphalt,
    transform: [{ rotate: '45deg' }],
  },
});
