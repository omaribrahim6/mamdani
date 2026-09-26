import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { say } from './voice';
import { C, F, T } from './theme';

// One pre-made Veo clip of Mamdani planting a FIXED flag, shared by every resolved report.
// It ships in the app bundle; nothing is generated per ticket or at runtime.
const CLIP = require('../assets/media/mayor-fixed.mp4');
const PLAYS = 2;
const LINE = 'Your report is fixed. Thanks for looking out for the neighbourhood!';

// said once per report per app session, however often the list refreshes or reopens
const thanked = new Set<number>();

export function FixedClip({ issueId }: { issueId: number }) {
  const plays = useRef(1);
  const player = useVideoPlayer(CLIP, (p) => {
    p.muted = true;
    p.loop = false;
    p.play();
  });

  useEventListener(player, 'playToEnd', () => {
    if (plays.current >= PLAYS) return;
    plays.current += 1;
    player.currentTime = 0;
    player.play();
  });

  useEffect(() => {
    if (thanked.has(issueId)) return;
    thanked.add(issueId);
    void say(LINE);
  }, [issueId]);

  return (
    <View style={styles.wrap}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
        accessible
        accessibilityLabel="Animation: Mamdani plants a green Fixed flag on the repaired street"
      />
      <Text style={styles.caption}>AI animation · not a repair photo</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, alignSelf: 'flex-start' },
  video: { width: 162, height: 288, borderRadius: 10, backgroundColor: C.concrete, overflow: 'hidden' },
  caption: { fontFamily: F.ui, fontSize: T.xs, color: C.curb, marginTop: 4 },
});
