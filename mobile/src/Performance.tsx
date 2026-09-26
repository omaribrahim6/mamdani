import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { category } from '../../lib/categories';
import type { Analysis, SubmitResult } from '../../lib/types';
import type { Media } from './api';
import { MayorView, type MayorHandle } from './MayorView';
import { SprayMark } from './SprayMark';
import { Bubble } from './Stage';
import { Ticket } from './Ticket';
import { Button } from './ui';
import { hush, speak } from './voice';
import { C, F, T } from './theme';

const TICKET_H = 212;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The payoff: spray mark, tiny mayor, the flag, his line, the work order. */
export function Performance({
  phase,
  onAgain,
  onTrack,
}: {
  phase: { photo: Media; analysis: Analysis; result: SubmitResult | null };
  onAgain: () => void;
  onTrack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { photo, analysis, result } = phase;
  const cat = category(analysis.category);
  const mayor = useRef<MayorHandle>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const [ticketIn, setTicketIn] = useState(false);
  const [stamped, setStamped] = useState(false);
  const [open, setOpen] = useState(false);
  const lift = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  // where the AI's box lands on screen, with the photo drawn "cover"
  const box = (() => {
    if (!size.w) return null;
    const k = Math.max(size.w / photo.width, size.h / photo.height);
    const dw = photo.width * k;
    const dh = photo.height * k;
    const ox = (size.w - dw) / 2;
    const oy = (size.h - dh) / 2;
    const [y0, x0, y1, x1] = analysis.box ?? [420, 330, 700, 670];
    return { x: ox + (x0 / 1000) * dw, y: oy + (y0 / 1000) * dh, w: ((x1 - x0) / 1000) * dw, h: ((y1 - y0) / 1000) * dh };
  })();

  useEffect(() => {
    if (!box) return;
    let alive = true;
    const run = async () => {
      await wait(analysis.isCivicIssue ? 1100 : 300); // let the spray loop finish first
      const target = { x: (box.x + box.w / 2) / size.w, y: Math.min(0.92, (box.y + box.h * 0.85) / size.h) };
      await mayor.current?.perform(analysis.isCivicIssue ? cat.outfit : 'inspector', {
        target,
        mood: analysis.isCivicIssue ? analysis.mood : 'confused',
        onThunk: () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          Animated.sequence([
            Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
            Animated.timing(shake, { toValue: -1, duration: 70, useNativeDriver: true }),
            Animated.timing(shake, { toValue: 0, duration: 90, useNativeDriver: true }),
          ]).start();
          if (result) {
            // slide the photo up so the ticket never covers the problem
            const bottom = box.y + box.h;
            const px = Math.max(0, Math.min(size.h * 0.3, bottom - (size.h - TICKET_H - insets.bottom - 24)));
            Animated.timing(lift, { toValue: -px, duration: 600, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
            setTicketIn(true);
            setTimeout(() => alive && setStamped(true), 700);
          }
        },
      });
      if (!alive) return;
      setBubble(mayor.current?.headScreen() ?? { x: 0.5, y: 0.4 });
      speak(
        analysis.mayorLine,
        () => mayor.current?.speaking(true),
        () => mayor.current?.speaking(false),
      );
    };
    void run();
    return () => {
      alive = false;
      hush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size.w) setSize({ w: width, h: height });
  };

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ translateY: Animated.add(lift, shake.interpolate({ inputRange: [-1, 0, 1], outputRange: [-2, 0, 4] })) }] },
        ]}
      >
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Your photo of the problem" />
        {box && analysis.isCivicIssue && (
          <SprayMark width={size.w} height={size.h} box={box} color={cat.color} word={cat.stencil} number={analysis.severity} seed={result?.issue.id ?? 7} />
        )}
        <MayorView ref={mayor} />
        {bubble && <Bubble at={bubble} w={size.w} h={size.h} text={analysis.mayorLine} />}
      </Animated.View>

      {result ? (
        ticketIn && (
          <Ticket
            analysis={analysis}
            result={result}
            open={open}
            stamped={stamped}
            onToggle={() => setOpen((o) => !o)}
            onAgain={onAgain}
            onTrack={onTrack}
          />
        )
      ) : (
        <View style={[styles.card, { bottom: Math.max(20, insets.bottom + 8) }]}>
          <Text style={styles.cardTitle}>Nothing to fix here?</Text>
          <Text style={styles.cardBody}>
            Mamdani couldn’t spot a city problem in that photo. Get closer and keep the problem in the middle of the frame.
          </Text>
          <Button variant="primary" onPress={onAgain}>
            Try again
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 5,
    padding: 20,
    backgroundColor: C.paper,
    borderRadius: 14,
    elevation: 12,
    shadowColor: C.asphalt,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  cardTitle: { fontFamily: F.uiBlack, fontSize: T.xl, lineHeight: 29, color: C.asphalt, marginBottom: 6 },
  cardBody: { fontFamily: F.ui, fontSize: T.md, lineHeight: 23, color: C.curb, marginBottom: 16 },
});
