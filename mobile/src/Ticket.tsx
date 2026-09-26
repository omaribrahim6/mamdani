import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { category } from '../../lib/categories';
import type { Analysis, SubmitResult } from '../../lib/types';
import { Button } from './ui';
import { C, F, T } from './theme';

const IMPACT: Record<Analysis['accessibility']['impact'], string> = {
  none: 'No barrier seen',
  low: 'Minor',
  moderate: 'Barrier',
  critical: 'Blocks the way',
};

const ordinal = (n: number) => {
  const v = n % 100;
  return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th');
};

function Meter({ value, color }: { value: number; color: string }) {
  const lit = Math.round(value / 10);
  return (
    <View style={styles.meter} accessible accessibilityLabel={`${value} out of 100`}>
      {Array.from({ length: 10 }, (_, i) => (
        <View key={i} style={[styles.cell, i < lit && { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.dt}>{label}</Text>
      <View style={styles.dd}>{children}</View>
    </View>
  );
}

/** The work order that slides up after the flag goes in: collapsed it's a receipt, open it's the full assessment. */
export function Ticket({
  analysis,
  result,
  open,
  stamped,
  onToggle,
  onAgain,
  onTrack,
}: {
  analysis: Analysis;
  result: SubmitResult;
  open: boolean;
  stamped: boolean;
  onToggle: () => void;
  onAgain: () => void;
  onTrack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { issue } = result;
  const cat = category(issue.category);
  const acc = analysis.accessibility;
  const rise = useRef(new Animated.Value(0)).current;
  const stamp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 550, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [rise]);

  useEffect(() => {
    if (!stamped) return;
    Animated.timing(stamp, { toValue: 1, duration: 280, easing: Easing.bezier(0.5, 0, 0.75, 0), useNativeDriver: true }).start(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    );
  }, [stamped, stamp]);

  return (
    <Animated.View
      style={[
        styles.ticket,
        { bottom: Math.max(10, insets.bottom), maxHeight: open ? '82%' : undefined },
        { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }] },
      ]}
      accessibilityLabel={`Work order ${issue.id}`}
    >
      <View style={styles.perf} pointerEvents="none">
        {Array.from({ length: 26 }, (_, i) => (
          <View key={i} style={styles.hole} />
        ))}
      </View>

      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.head}>
        <View style={styles.grab} />
        <Text style={styles.woNo}>Work order {issue.id}</Text>
        <Text style={styles.woTitle}>{analysis.title}</Text>
        <Text style={styles.woWhere} numberOfLines={1}>
          {issue.address}
        </Text>
        <View style={styles.chips}>
          <Text style={[styles.chip, { borderColor: cat.color, backgroundColor: cat.color + '29', color: C.asphalt }]}>{cat.label}</Text>
          {acc.barrier && <Text style={[styles.chip, styles.chipAccess]}>Accessibility barrier</Text>}
          {result.duplicate && <Text style={[styles.chip, styles.chipPlain]}>{issue.reports} reports</Text>}
        </View>

        <Animated.View
          style={[
            styles.stamp,
            {
              opacity: stamp.interpolate({ inputRange: [0, 1], outputRange: [0, 0.92] }),
              transform: [{ rotate: '-9deg' }, { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] }) }],
            },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.stampText}>{'SENT TO\nTHE CITY'}</Text>
        </Animated.View>
      </Pressable>

      {open && (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 4 }}>
          <Row label="Severity">
            <Meter value={analysis.severity} color={cat.color} />
            <Text style={styles.num}>{analysis.severity}</Text>
          </Row>
          <Row label="Safety risk">
            <Meter value={analysis.safetyRisk} color={C.hivis} />
            <Text style={styles.num}>{analysis.safetyRisk}</Text>
          </Row>
          <Row label="Accessibility">
            <View style={{ gap: 2, flex: 1 }}>
              <Text style={styles.num}>{IMPACT[acc.impact]}</Text>
              {acc.notes.map((n) => (
                <Text key={n} style={styles.ddText}>
                  {n}
                </Text>
              ))}
            </View>
          </Row>
          {analysis.hazards.length > 0 && (
            <Row label="Hazards">
              <Text style={styles.ddText}>{analysis.hazards.join(', ')}</Text>
            </Row>
          )}
          <Row label="Goes to">
            <Text style={styles.ddText}>{issue.department}</Text>
          </Row>
          <Row label="Reports">
            <Text style={styles.ddText}>
              {result.duplicate
                ? `You’re the ${ordinal(issue.reports)} person to report this. It moves up the queue with every report.`
                : 'You’re the first to report this.'}
            </Text>
          </Row>
          <Text style={styles.summaryLabel}>What the crew will read</Text>
          <Text style={styles.summary}>{analysis.summary}</Text>
          {analysis.engine === 'demo' && <Text style={styles.demo}>Demo analysis: the server has no Gemini key yet.</Text>}
        </ScrollView>
      )}

      <View style={styles.actions}>
        <Button variant="ghost" onPress={onTrack} style={{ flex: 1 }}>
          Track this report
        </Button>
        <Button variant="primary" onPress={onAgain} style={{ flex: 1 }}>
          Report another
        </Button>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ticket: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 5,
    backgroundColor: C.paper,
    borderRadius: 14,
    shadowColor: C.asphalt,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  perf: {
    position: 'absolute',
    top: -3,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    opacity: 0.18,
  },
  hole: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.asphalt },
  head: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.paperLine, marginBottom: 10 },
  woNo: { fontFamily: F.uiSemi, fontSize: T.sm, color: C.curb },
  woTitle: { fontFamily: F.uiBlack, fontSize: T.lg, lineHeight: 24, color: C.asphalt, paddingRight: 100, marginTop: 2 },
  woWhere: { fontFamily: F.ui, fontSize: T.sm, color: C.curb, paddingRight: 100, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: {
    fontFamily: F.uiBold,
    fontSize: T.xs,
    paddingHorizontal: 9,
    paddingTop: 4,
    paddingBottom: 3,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipAccess: { backgroundColor: C.access, color: '#fff' },
  chipPlain: { backgroundColor: C.concrete, color: C.asphalt },
  stamp: {
    position: 'absolute',
    top: 30,
    right: 14,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 3,
    borderWidth: 3,
    borderColor: C.stampRed,
    borderRadius: 6,
  },
  stampText: { fontFamily: F.stencilBlack, fontSize: 18, lineHeight: 17, color: C.stampRed, textAlign: 'center', letterSpacing: 0.5 },
  body: { paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: C.paperLine },
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: C.paperLine,
  },
  dt: { width: 104, fontFamily: F.uiSemi, fontSize: T.sm, color: C.curb, paddingTop: 1 },
  dd: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ddText: { flex: 1, fontFamily: F.ui, fontSize: T.sm, lineHeight: 20, color: C.asphalt },
  num: { fontFamily: F.uiBlack, fontSize: T.sm, color: C.asphalt },
  meter: { flexDirection: 'row', gap: 3 },
  cell: { width: 11, height: 14, borderRadius: 2, backgroundColor: C.paperLine, transform: [{ skewX: '-12deg' }] },
  summaryLabel: { fontFamily: F.uiSemi, fontSize: T.sm, color: C.curb, marginTop: 14 },
  summary: { fontFamily: F.ui, fontSize: T.sm, lineHeight: 21, color: C.asphalt, marginTop: 2, marginBottom: 14 },
  demo: { fontFamily: F.ui, fontSize: T.xs, color: C.curb, marginBottom: 12 },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: C.paperLine,
  },
});
