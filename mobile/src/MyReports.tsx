import { useEffect, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { category } from '../../lib/categories';
import type { Issue, Status } from '../../lib/types';
import { getIssue } from './api';
import { CategoryGlyph } from './categoryIcons';
import { loadMine, type MyReport } from './mine';
import { D, F } from './theme';

// Styled like Mamdani Command (the dashboard): sage canvas, white cards, the category icon tile,
// and the issue drawer's four-step stepper (done in ink, the current step in hi-vis orange).

const STEPS: Array<{ status: Status; label: string }> = [
  { status: 'new', label: 'Reported' },
  { status: 'assigned', label: 'Crew assigned' },
  { status: 'in_progress', label: 'Being fixed' },
  { status: 'resolved', label: 'Fixed' },
];

/** A colour mixed toward white: the dashboard's `color-mix(in srgb, var(--c) 12%, var(--panel))`. */
function tint(hex: string, amount = 0.12) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(255 + (c - 255) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

/** Everything this phone reported, following the city's status live. */
export function MyReports({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [mine, setMine] = useState<MyReport[]>([]);
  const [live, setLive] = useState<Record<number, Issue>>({});
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async (list: MyReport[]) => {
    const found = await Promise.all(list.map((m) => getIssue(m.issueId)));
    const next: Record<number, Issue> = {};
    found.forEach((f) => f && (next[f.id] = f));
    setLive(next);
  };

  useEffect(() => {
    if (!visible) return;
    let stop = false;
    let list: MyReport[] = [];
    void loadMine().then((m) => {
      if (stop) return;
      list = m;
      setMine(m);
      void refresh(m);
    });
    const t = setInterval(() => !stop && refresh(list), 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            Your reports
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [styles.close, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <FlatList
          data={mine}
          keyExtractor={(m) => String(m.issueId)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={D.ink3}
              onRefresh={async () => {
                setRefreshing(true);
                await refresh(mine);
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.card}>
              <Text style={styles.empty}>Nothing yet. Point your camera at something broken and say “Mamdani, fix this.”</Text>
            </View>
          }
          renderItem={({ item: m }) => {
            const issue = live[m.issueId];
            const status = issue?.status ?? 'new';
            const reached = STEPS.findIndex((x) => x.status === status);
            const cat = category(m.category);
            return (
              <View style={styles.card} accessible accessibilityLabel={`${issue?.title ?? m.title}. ${STEPS[reached].label}.`}>
                <View style={styles.row}>
                  <View style={[styles.catIco, { backgroundColor: tint(cat.color) }]}>
                    <CategoryGlyph id={m.category} size={20} color={cat.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{issue?.title ?? m.title}</Text>
                    <Text style={styles.meta}>
                      {m.address}. Work order {m.issueId}
                      {issue && issue.reports > 1 ? `, ${issue.reports} reports` : ''}
                    </Text>
                  </View>
                </View>
                <View style={styles.stepper}>
                  {STEPS.map((st, i) => {
                    const done = i < reached;
                    const now = i === reached;
                    return (
                      <View key={st.status} style={styles.step}>
                        <View style={[styles.bar, done && styles.barDone, now && styles.barNow]} />
                        <Text style={[styles.stepText, now && styles.stepTextNow]} numberOfLines={2}>
                          {st.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: D.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
  // the dashboard's page heading: large, light, tightly set
  title: { fontFamily: F.ui, fontSize: 34, lineHeight: 38, letterSpacing: -1.2, color: D.ink, paddingTop: 4 },
  // .btn.soft
  close: { height: 38, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: D.line, backgroundColor: D.panel, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: F.uiSemi, fontSize: 13, color: D.ink, paddingTop: 2 },
  // .card
  card: {
    backgroundColor: D.panel,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: D.line,
    padding: 16,
    gap: 16,
    ...Platform.select({
      ios: { shadowColor: D.ink, shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  empty: { fontFamily: F.ui, fontSize: 15, lineHeight: 22, color: D.ink2 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  // .cat-ico
  catIco: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontFamily: F.uiSemi, fontSize: 16, lineHeight: 21, color: D.ink },
  meta: { fontFamily: F.ui, fontSize: 13, lineHeight: 18, color: D.ink2, marginTop: 2 },
  // .stepper
  stepper: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, gap: 8 },
  bar: { height: 6, borderRadius: 3, backgroundColor: D.panel2, borderWidth: 1, borderColor: D.line },
  barDone: { backgroundColor: D.ink, borderColor: D.ink },
  barNow: { backgroundColor: D.accent, borderColor: D.accent },
  stepText: { fontFamily: F.ui, fontSize: 11.5, lineHeight: 15, color: D.ink3 },
  stepTextNow: { fontFamily: F.uiSemi, color: D.ink },
});
