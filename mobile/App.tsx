import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AudioManager } from 'react-native-audio-api';
import { Avatar } from './src/Avatar';
import { CameraFeed } from './src/CameraFeed';
import { LiveAudio } from './src/audio';
import { LiveSession } from './src/session';
import { backendUrl } from './src/env';
import type { CaptureResult } from './src/photo';
import type { Phase } from './src/protocol';

type Screen = 'home' | 'preparing' | Phase;
type Caption = { role: 'user' | 'assistant'; text: string };
const labels: Record<Screen, string> = { home: '', preparing: 'Getting ready', connecting: 'Connecting',
  live: 'Listening · show the issue', capturing: 'Hold steady—taking a photo', submitting: 'Saving your report', success: 'Report saved', error: 'Session stopped', closed: '' };

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [speaking, setSpeaking] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [failure, setFailure] = useState('');
  const [photoThumbnail, setPhotoThumbnail] = useState('');
  const session = useRef<LiveSession | null>(null);
  const generation = useRef(0);
  const currentScreen = useRef<Screen>('home');
  currentScreen.current = screen;
  const cleanup = useRef<Promise<void>>(Promise.resolve());
  const scroll = useRef<ScrollView>(null);

  const cancel = useCallback(() => {
    generation.current++;
    const old = session.current; session.current = null;
    cleanup.current = old?.close() ?? cleanup.current;
    currentScreen.current = 'home';
    setSpeaking(false); setScreen('home');
  }, []);

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active' || currentScreen.current === 'home' || currentScreen.current === 'preparing') return;
      const unknown = currentScreen.current === 'submitting';
      cancel();
      if (unknown) {
        setFailure('Submission status unknown. Your report may have been saved. It has not been resubmitted.');
        setScreen('error');
      }
    });
    return () => { listener.remove(); generation.current++; void session.current?.close(); };
  }, [cancel]);

  async function begin() {
    if (currentScreen.current !== 'home') return;
    currentScreen.current = 'preparing';
    const id = ++generation.current;
    setScreen('preparing'); setFailure(''); setCaptions([]); setPhotoThumbnail('');
    try {
      await cleanup.current;
      const base = backendUrl(process.env.EXPO_PUBLIC_BACKEND_URL);
      const camera = await Camera.requestCameraPermissionsAsync();
      if (id !== generation.current) return;
      const microphone = await AudioManager.requestRecordingPermissions();
      if (id !== generation.current) return;
      const location = await Location.requestForegroundPermissionsAsync();
      if (id !== generation.current) return;
      if (!camera.granted || microphone !== 'Granted' || !location.granted) {
        Alert.alert('Permissions needed', 'Allow camera, microphone, and location to report an issue.', [
          { text: 'Close' }, { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
        ]);
        cancel(); return;
      }
      if (!await Location.hasServicesEnabledAsync()) throw new Error('Turn on location services to attach GPS to your report.');
      const gps = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Could not get GPS. Move outside and try again.')), 15000)),
      ]);
      if (id !== generation.current || AppState.currentState !== 'active') { cancel(); return; }
      setScreen('connecting');
      session.current = new LiveSession(base, { latitude: gps.coords.latitude, longitude: gps.coords.longitude }, {
        phase: value => { if (id === generation.current) { currentScreen.current = value; setScreen(value); } },
        speaking: value => { if (id === generation.current) setSpeaking(value); },
        error: message => { if (id === generation.current) setFailure(message); },
        transcript: (role, text) => {
          if (id !== generation.current) return;
          setCaptions(previous => {
            const last = previous[previous.length - 1];
            if (last?.role === role) return [...previous.slice(0, -1), { role, text: last.text + text }];
            return [...previous, { role, text }];
          });
        },
      }, (speaking, fail) => new LiveAudio(speaking, fail));
      await session.current.ready;
    } catch (error) {
      if (id !== generation.current) return;
      setFailure(error instanceof Error ? error.message : 'Could not start reporting.'); setScreen('error');
      cleanup.current = session.current?.close(false) ?? Promise.resolve(); session.current = null;
    }
  }

  const frame = useCallback((data: string) => session.current?.frame(data), []);
  const photo = useCallback((result: CaptureResult) => {
    if (session.current?.photo(result.data)) setPhotoThumbnail(result.thumbnail);
  }, []);
  const cameraError = useCallback(() => {
    generation.current++;
    const old = session.current; session.current = null;
    cleanup.current = old?.close() ?? Promise.resolve();
    setFailure('The camera stopped. Please start a new report.'); setScreen('error');
  }, []);
  const cameraVisible = screen === 'connecting' || screen === 'live' || screen === 'capturing';

  return <SafeAreaProvider><View style={styles.root}>
    <StatusBar style="light" />
    {cameraVisible && <CameraFeed active={screen === 'live'} capturing={screen === 'capturing'} frame={frame} photo={photo} error={cameraError} />}
    <SafeAreaView style={styles.safe}>
      {screen === 'home' ? <View style={styles.landing}>
        <Text style={styles.kicker}>YOUR BLOCK. YOUR VOICE.</Text>
        <Avatar large />
        <Text style={styles.title}>Let’s fix it.</Text>
        <Text style={styles.body}>Show us what needs attention.{"\n"}Mamdani will take it from here.</Text>
        <Pressable accessibilityRole="button" style={styles.primary} onPress={() => { void begin(); }}>
          <Text style={styles.primaryText}>Report issue  ↗</Text>
        </Pressable>
        <Text style={styles.disclosure}>Camera, voice, and location help describe your issue.{"\n"}Live media is shared with Google during reporting.</Text>
      </View> : <View style={styles.flow}>
        <View style={styles.top}>
          <Avatar speaking={speaking} />
          <View style={styles.topText}><Text style={styles.name}>MAMDANI</Text><Text style={styles.status}>{speaking ? 'Speaking' : labels[screen]}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel reporting" onPress={cancel} style={styles.cancel}><Text style={styles.cancelText}>×</Text></Pressable>
        </View>
        <View style={styles.space} />
        {screen === 'error' ? <View style={styles.panel}>
          <Text style={styles.panelTitle}>Session stopped</Text><Text style={styles.body}>{failure}</Text>
          <Pressable accessibilityRole="button" style={styles.primary} onPress={cancel}><Text style={styles.primaryText}>Back to home</Text></Pressable>
        </View> : <View style={styles.panel}>
          {screen === 'live' ? <>
            <View style={styles.liveLabel}><View style={styles.dot} /><Text style={styles.kicker}>LIVE REPORT</Text></View>
            <Text style={styles.hint}>Point your camera at the issue and tell me about it.</Text>
          </> : screen !== 'success' ? <View style={styles.loading}><ActivityIndicator color="#ff2e88" /><Text style={styles.hint}>{labels[screen]}…</Text></View> : null}
          {photoThumbnail && screen === 'submitting' ? <View style={styles.photoRow}>
            <Image accessibilityLabel="Captured report photo" source={{ uri: photoThumbnail }} style={styles.thumbnail} />
            <Text style={styles.hint}>Photo captured</Text>
          </View> : null}
          <ScrollView ref={scroll} style={styles.captions} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
            {captions.map((caption, i) => <View key={i} style={styles.caption}>
              <Text style={styles.speaker}>{caption.role === 'user' ? 'YOU' : 'MAMDANI'}</Text><Text style={styles.captionText}>{caption.text.trim()}</Text>
            </View>)}
          </ScrollView>
        </View>}
      </View>}
    </SafeAreaView>
    <Modal visible={screen === 'success'} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.backdrop}><View style={styles.success}>
        <Text style={styles.check}>✓</Text><Text style={styles.panelTitle}>Issue reported successfully.</Text>
        <Text style={styles.body}>Thanks for looking out for your neighborhood.</Text>
        <Pressable accessibilityRole="button" style={styles.primary} onPress={cancel}><Text style={styles.primaryText}>Done</Text></Pressable>
      </View></View>
    </Modal>
  </View></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#26292c' }, safe: { flex: 1 },
  landing: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 24 },
  kicker: { color: '#ff2e88', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  title: { color: '#f3f2ee', fontSize: 48, fontWeight: '900', letterSpacing: -2 },
  body: { color: '#cfccc5', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  primary: { backgroundColor: '#ff2e88', paddingHorizontal: 28, paddingVertical: 18, borderRadius: 16, alignSelf: 'stretch', alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  disclosure: { color: '#a6a6a2', fontSize: 11, lineHeight: 17, textAlign: 'center' },
  flow: { flex: 1, padding: 18 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#26292cee', padding: 12, borderRadius: 28 },
  topText: { flex: 1, gap: 8 }, name: { color: '#f3f2ee', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  status: { color: '#d9d7d1', fontSize: 12 }, cancel: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#f3f2ee', fontSize: 34 }, space: { flex: 1 },
  panel: { backgroundColor: '#26292cf5', borderRadius: 24, padding: 22, gap: 16 },
  panelTitle: { color: '#f3f2ee', fontSize: 25, fontWeight: '800', textAlign: 'center' },
  liveLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 }, dot: { width: 7, height: 7, backgroundColor: '#ff2e88', borderRadius: 4 },
  hint: { color: '#f3f2ee', fontSize: 16, lineHeight: 23 }, loading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnail: { width: 64, height: 64, borderRadius: 10 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  captions: { maxHeight: 185 }, caption: { paddingVertical: 10, gap: 6 },
  speaker: { color: '#a6a6a2', fontSize: 10, letterSpacing: 1.5, fontWeight: '800' }, captionText: { color: '#f3f2ee', fontSize: 15, lineHeight: 21 },
  backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: 28 },
  success: { backgroundColor: '#26292c', padding: 28, borderRadius: 28, gap: 24 },
  check: { color: '#12995a', fontSize: 64, textAlign: 'center' },
});
