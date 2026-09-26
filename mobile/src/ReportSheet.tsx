import { Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { category } from '../../lib/categories';
import type { AccessImpact, ReportDecision } from '../../lib/types';
import { STATUS_LABEL } from '../../lib/types';
import { Button } from './ui';
import { C, F, T } from './theme';

const IMPACT: Record<AccessImpact, string> = {
  none: 'No barrier seen',
  low: 'Minor',
  moderate: 'Barrier',
  critical: 'Blocks the way',
};

export const severityWord = (n: number) => (n >= 75 ? 'High severity' : n >= 45 ? 'Medium severity' : 'Low severity');

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

/** The filed report in full: what the city received. Opened from the "Reported" confirmation. */
export function ReportSheet({
  decision,
  photoUri,
  hazards,
  notes,
  visible,
  onClose,
}: {
  decision: ReportDecision;
  photoUri: string | null;
  hazards: string[];
  notes: string[];
  visible: boolean;
  onClose: () => void;
}) {
  const { issue } = decision;
  const cat = category(issue.type);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Text style={styles.woNo}>Work order {issue.id}</Text>
          <Button variant="ghost" onPress={onClose} style={{ minHeight: 40 }}>
            Done
          </Button>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.photo} accessibilityLabel="The photo you sent" />}
          <Text style={styles.title}>{issue.title}</Text>
          <Text style={styles.where}>{issue.address}</Text>
          <View style={styles.chips}>
            <Text style={[styles.chip, { borderColor: cat.color }]}>{cat.label}</Text>
            {issue.accessibilityImpact !== 'none' && issue.accessibilityImpact !== 'low' && (
              <Text style={[styles.chip, styles.chipAccess]}>Accessibility barrier</Text>
            )}
            <Text style={[styles.chip, styles.chipPlain]}>{STATUS_LABEL[issue.status]}</Text>
          </View>

          <Row label="Severity">
            <Meter value={issue.severity} color={cat.color} />
            <Text style={styles.num}>{issue.severity}</Text>
          </Row>
          <Row label="Safety risk">
            <Meter value={issue.safetyRisk} color={C.hivis} />
            <Text style={styles.num}>{issue.safetyRisk}</Text>
          </Row>
          <Row label="Accessibility">
            <View style={{ gap: 2, flex: 1 }}>
              <Text style={styles.num}>{IMPACT[issue.accessibilityImpact]}</Text>
              {notes.map((n) => (
                <Text key={n} style={styles.ddText}>
                  {n}
                </Text>
              ))}
            </View>
          </Row>
          {hazards.length > 0 && (
            <Row label="Hazards">
              <Text style={styles.ddText}>{hazards.join(', ')}</Text>
            </Row>
          )}
          <Row label="Goes to">
            <Text style={styles.ddText}>{issue.department}</Text>
          </Row>
          <Row label="Reports">
            <Text style={styles.ddText}>
              {issue.duplicate
                ? `${issue.duplicateCount} neighbours have reported this. It moves up the queue with every report.`
                : 'You’re the first to report this.'}
            </Text>
          </Row>
          <Text style={styles.summaryLabel}>What the crew will read</Text>
          <Text style={styles.summary}>{issue.summary}</Text>
          {decision.engine === 'demo' && <Text style={styles.demo}>Demo analysis: the server has no Gemini key yet.</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: C.paper },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  woNo: { fontFamily: F.uiSemi, fontSize: T.sm, color: C.curb, paddingTop: 2 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: C.concrete, marginBottom: 16 },
  title: { fontFamily: F.uiBlack, fontSize: T.xl, lineHeight: 30, color: C.asphalt },
  where: { fontFamily: F.ui, fontSize: T.md, color: C.curb, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 8 },
  chip: {
    fontFamily: F.uiBold,
    fontSize: T.xs,
    color: C.asphalt,
    paddingHorizontal: 10,
    paddingTop: 5,
    paddingBottom: 4,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipAccess: { backgroundColor: C.access, color: '#fff' },
  chipPlain: { backgroundColor: C.concrete },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.paperLine },
  dt: { width: 104, fontFamily: F.uiSemi, fontSize: T.sm, color: C.curb, paddingTop: 1 },
  dd: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ddText: { flex: 1, fontFamily: F.ui, fontSize: T.sm, lineHeight: 20, color: C.asphalt },
  num: { fontFamily: F.uiBlack, fontSize: T.sm, color: C.asphalt },
  meter: { flexDirection: 'row', gap: 3 },
  cell: { width: 11, height: 14, borderRadius: 2, backgroundColor: C.paperLine, transform: [{ skewX: '-12deg' }] },
  summaryLabel: { fontFamily: F.uiSemi, fontSize: T.sm, color: C.curb, marginTop: 16 },
  summary: { fontFamily: F.ui, fontSize: T.md, lineHeight: 23, color: C.asphalt, marginTop: 2 },
  demo: { fontFamily: F.ui, fontSize: T.xs, color: C.curb, marginTop: 14 },
});
