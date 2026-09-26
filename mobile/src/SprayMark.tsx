import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { F } from './theme';

// Road-crew spray paint: a hand-sprayed loop around the problem and a stencilled word beside it.
// Native SVG has no turbulence filter, so the paint is built from a soft wide pass (the mist),
// a solid core, and a scatter of overspray dots.

const AnimatedPath = Animated.createAnimatedComponent(Path);

function seeded(seed: number) {
  let s = seed || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Wobbly radius, overshoots its start like a real flick of the can. */
function loop(cx: number, cy: number, rx: number, ry: number, seed: number) {
  const r = seeded(seed);
  const start = -Math.PI * 0.6 + r() * 0.4;
  const end = start + Math.PI * 2 + 0.35 + r() * 0.3;
  const n = 48;
  const pts: Array<[number, number]> = [];
  let wob = 0;
  for (let i = 0; i <= n; i++) {
    const t = start + ((end - start) * i) / n;
    wob += (r() - 0.5) * 0.05;
    wob *= 0.9;
    const grow = 1 + (i / n) * 0.07;
    pts.push([cx + Math.cos(t) * rx * (1 + wob) * grow, cy + Math.sin(t) * ry * (1 + wob) * grow]);
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  // overspray: little dots that land just outside the stroke
  const dots = pts
    .filter((_, i) => i % 2 === 0)
    .map(([x, y]) => {
      const a = r() * Math.PI * 2;
      const off = 5 + r() * 9;
      return { x: x + Math.cos(a) * off, y: y + Math.sin(a) * off, r: 0.8 + r() * 1.6 };
    });
  return { d, len, dots };
}

export interface SprayMarkProps {
  width: number;
  height: number;
  box: { x: number; y: number; w: number; h: number };
  color: string;
  word: string;
  number?: number;
  seed?: number;
}

export function SprayMark({ width, height, box, color, word, number, seed = 11 }: SprayMarkProps) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = Math.max(38, box.w * 0.62);
  const ry = Math.max(30, box.h * 0.62);
  const { d, len, dots } = useMemo(() => loop(cx, cy, rx, ry, seed), [cx, cy, rx, ry, seed]);
  const draw = useRef(new Animated.Value(0)).current;
  const label = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(draw, { toValue: 1, duration: 900, easing: Easing.bezier(0.5, 0.05, 0.3, 1), useNativeDriver: false }),
      Animated.timing(label, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [draw, label]);

  const offset = draw.interpolate({ inputRange: [0, 1], outputRange: [len, 0] });
  // the stencil goes where there's room: above the loop unless it's near the top, never off-screen
  const [labelW, setLabelW] = useState(0);
  const labelAbove = cy - ry > 110;
  const lx = Math.max(12, Math.min(width - labelW - 12, cx - rx * 0.3));
  const ly = labelAbove ? cy - ry - 60 : cy + ry + 8;

  return (
    <>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <G stroke={color} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <AnimatedPath d={d} strokeWidth={20} strokeOpacity={0.16} strokeDasharray={[len, len]} strokeDashoffset={offset} />
          <AnimatedPath d={d} strokeWidth={11} strokeOpacity={0.3} strokeDasharray={[len, len]} strokeDashoffset={offset} />
          <AnimatedPath d={d} strokeWidth={6.5} strokeDasharray={[len, len]} strokeDashoffset={offset} />
        </G>
        <G fill={color} opacity={0.7}>
          {dots.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={p.r} />
          ))}
        </G>
      </Svg>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.label,
          {
            left: lx,
            top: ly,
            opacity: label,
            transform: [{ rotate: '-5deg' }, { scale: label.interpolate({ inputRange: [0, 1], outputRange: [1.15, 1] }) }],
          },
        ]}
      >
        <View style={styles.row} onLayout={(e) => setLabelW(e.nativeEvent.layout.width)}>
          <Text style={[styles.word, { color, textShadowColor: color }]} numberOfLines={1}>
            {word}
          </Text>
          {number != null && (
            <Text style={[styles.word, styles.num, { color, textShadowColor: color }]} numberOfLines={1}>
              {number}
            </Text>
          )}
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute' },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  word: {
    fontFamily: F.stencilBlack,
    fontSize: 46,
    lineHeight: 50,
    letterSpacing: 1,
    textShadowRadius: 7,
    textShadowOffset: { width: 0, height: 0 },
  },
  num: { fontSize: 32, lineHeight: 36 },
});
