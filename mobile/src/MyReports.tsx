import { useEffect, useState } from 'react';
import { FlatList, Modal, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { category } from '../../lib/categories';
import type { Issue, Status } from '../../lib/types';
import { getIssue } from './api';
import { FixedClip } from './FixedClip';
import { loadMine, type MyReport } from './mine';
import { Button } from './ui';
import { C, F, T } from './theme';

const STEPS: Array<{ status: Status; label: string }> = [
  { status: 'new', label: 'Reported' },
  { status: 'assigned', label: 'Crew assigned' },
  { status: 'in_progress', label: 'Being fixed' },
  { status: 'resolved', label: 'Fixed' },
];

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
          <Button variant="ghost" onPress={onClose} style={{ minHeight: 40 }}>
            Close
          </Button>
        </View>
        <FlatList
          data={mine}
          keyExtractor={(m) => String(m.issueId)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refresh(mine);
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>Nothing yet. Point your camera at something broken and say “Mamdani, fix this.”</Text>
          }
          renderItem={({ item: m }) => {
            const issue = live[m.issueId];
            const status = issue?.status ?? 'new';
            const reached = STEPS.findIndex((x) => x.status === status);
            const cat = category(m.category);
            return (
              <View style={styles.item} accessible accessibilityLabel={`${issue?.title ?? m.title}. ${STEPS[reached].label}.`}>
                <View style={[styles.catBar, { backgroundColor: cat.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{issue?.title ?? m.title}</Text>
                  <Text style={styles.meta}>
                    {m.address}. Work order {m.issueId}
                    {issue && issue.reports > 1 ? `, ${issue.reports} reports` : ''}
                  </Text>
                  <View style={styles.steps}>
                    {STEPS.map((st, i) => (
                      <View
                        key={st.status}
                        style={[styles.step, i <= reached && styles.stepDone, i === reached && { borderTopColor: C.ok }]}
                      >
                        <Text style={[styles.stepText, i <= reached && { color: C.asphalt }]}>{st.label}</Text>
                      </View>
                    ))}
                  </View>
                  {status === 'resolved' && <FixedClip issueId={m.issueId} />}
                </View>
              </View>
            );
          }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: C.paper },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: F.stencil, fontSize: 36, lineHeight: 38, color: C.asphalt, textTransform: 'uppercase', paddingTop: 4 },
  empty: { fontFamily: F.ui, fontSize: T.lg, lineHeight: 28, color: C.curb, marginTop: 8 },
  item: { flexDirection: 'row', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.paperLine },
  catBar: { width: 6, borderRadius: 3 },
  itemTitle: { fontFamily: F.uiBlack, fontSize: T.lg, lineHeight: 24, color: C.asphalt },
  meta: { fontFamily: F.ui, fontSize: T.sm, color: C.curb, marginTop: 2, marginBottom: 12 },
  steps: { flexDirection: 'row', gap: 4 },
  step: { flex: 1, paddingTop: 8, borderTopWidth: 4, borderTopColor: C.paperLine },
  stepDone: { borderTopColor: C.asphalt },
  stepText: { fontFamily: F.uiSemi, fontSize: T.xs, color: C.curb },
});
