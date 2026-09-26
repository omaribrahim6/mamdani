import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import type { Analysis, SubmitResult } from '../../lib/types';
import { sendReport, type Media } from './api';
import { useWhere } from './location';
import { saveMine } from './mine';
import { MyReports } from './MyReports';
import { Performance } from './Performance';
import { Guides } from './Stage';
import { Button, GalleryIcon, PinIcon } from './ui';
import { C, F, T } from './theme';

type Phase =
  | { kind: 'camera' }
  | { kind: 'analyzing'; photo: Media }
  | { kind: 'result'; photo: Media; analysis: Analysis; result: SubmitResult | null }
  | { kind: 'error'; photo: Media | null; message: string };

const HOLD_MS = 280;
const MAX_REC_S = 10;
const MAX_VIDEO_BYTES = 3.6e6; // the API sits behind a 4.5 MB request limit

/** Photos go up at 1280 px on the long edge: plenty for Gemini, quick on a cell connection. */
async function shrink(uri: string, w: number, h: number): Promise<Media> {
  const long = Math.max(w, h);
  const ctx = ImageManipulator.manipulate(uri);
  if (long > 1280) ctx.resize(w >= h ? { width: 1280 } : { height: 1280 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: 0.72, format: SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height };
}

export function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const where = useWhere();
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const cam = useRef<CameraView>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [mode, setMode] = useState<'picture' | 'video'>('picture');
  const [recording, setRecording] = useState(false);
  const [showMine, setShowMine] = useState(false);

  // ── submit ──
  const submit = useCallback(
    async (photo: Media, video: { uri: string; mime: string } | null) => {
      setPhase({ kind: 'analyzing', photo });
      try {
        const { analysis, result } = await sendReport({ photo, video, lat: where.lat, lng: where.lng });
        if (result) {
          void saveMine({
            issueId: result.issue.id,
            title: result.issue.title,
            category: result.issue.category,
            address: result.issue.address,
            at: Date.now(),
            duplicate: result.duplicate,
          });
        }
        setPhase({ kind: 'result', photo, analysis, result });
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPhase({ kind: 'error', photo, message: e instanceof Error ? e.message : 'The report didn’t go through.' });
      }
    },
    [where.lat, where.lng],
  );

  const fromVideo = async (uri: string, mime: string, bytes?: number | null) => {
    const thumb = await VideoThumbnails.getThumbnailAsync(uri, { time: 600, quality: 0.8 });
    const photo = await shrink(thumb.uri, thumb.width, thumb.height);
    // a clip that's too heavy still gets its frame sent
    void submit(photo, bytes && bytes > MAX_VIDEO_BYTES ? null : { uri, mime });
  };

  // ── shutter: tap for a photo, hold to record and talk ──
  const rec = useRef<'idle' | 'starting' | 'recording' | 'finishing'>('idle');
  const pressing = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const readyWaiters = useRef<Array<() => void>>([]);
  const progress = useRef(new Animated.Value(0)).current;

  const waitForCamera = () =>
    new Promise<void>((res) => {
      readyWaiters.current.push(res);
      setTimeout(res, 1200);
    });
  const onCameraReady = () => readyWaiters.current.splice(0).forEach((f) => f());

  const takePhoto = async () => {
    if (!cam.current) return;
    rec.current = 'finishing';
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const shot = await cam.current.takePictureAsync({ quality: 0.8, shutterSound: false });
      if (!shot) throw new Error('no photo');
      void submit(await shrink(shot.uri, shot.width, shot.height), null);
    } catch {
      rec.current = 'idle';
      setPhase({ kind: 'error', photo: null, message: 'The camera didn’t take the photo. Try again.' });
    }
  };

  const startRecording = async () => {
    if (!micPerm?.granted) {
      // first long press asks for the mic; the next one records
      await requestMic();
      return;
    }
    rec.current = 'starting';
    setMode('video');
    await waitForCamera();
    if (!pressing.current || !cam.current) {
      // let go while the camera was switching: just take the photo
      setMode('picture');
      await waitForCamera();
      return takePhoto();
    }
    rec.current = 'recording';
    setRecording(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: MAX_REC_S * 1000, easing: Easing.linear, useNativeDriver: false }).start();
    try {
      const clip = await cam.current.recordAsync({ maxDuration: MAX_REC_S, ...(Platform.OS === 'ios' ? { codec: 'avc1' as const } : {}) });
      rec.current = 'finishing';
      setRecording(false);
      progress.stopAnimation();
      setMode('picture');
      if (!clip?.uri) throw new Error('no clip');
      const mime = clip.uri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
      await fromVideo(clip.uri, mime);
    } catch {
      rec.current = 'idle';
      setRecording(false);
      setMode('picture');
      setPhase({ kind: 'error', photo: null, message: 'The recording didn’t save. Tap for a photo instead.' });
    }
  };

  const onPressIn = () => {
    if (rec.current !== 'idle') return;
    pressing.current = true;
    holdTimer.current = setTimeout(() => void startRecording(), HOLD_MS);
  };
  const onPressOut = () => {
    pressing.current = false;
    clearTimeout(holdTimer.current);
    if (rec.current === 'idle') void takePhoto();
    else if (rec.current === 'recording') cam.current?.stopRecording();
  };

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
      videoMaxDuration: MAX_REC_S,
    });
    const a = r.assets?.[0];
    if (r.canceled || !a) return;
    if (a.type === 'video') await fromVideo(a.uri, a.mimeType || 'video/mp4', a.fileSize);
    else void submit(await shrink(a.uri, a.width, a.height), null);
  };

  const again = () => {
    rec.current = 'idle';
    setMode('picture');
    setPhase({ kind: 'camera' });
  };

  // dev on the web preview: play a result without a camera or the network
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'web') return;
    (globalThis as { __mamdani?: unknown }).__mamdani = {
      show: (p: Media, analysis: Analysis, result: SubmitResult | null) => setPhase({ kind: 'result', photo: p, analysis, result }),
    };
  }, []);

  // ── render ──
  const photo = phase.kind === 'camera' ? null : phase.photo;
  const camAllowed = camPerm?.granted;

  return (
    <View style={styles.phone}>
      {phase.kind === 'camera' && camAllowed && (
        <CameraView
          ref={cam}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode={mode}
          videoQuality={Platform.OS === 'ios' ? '4:3' : '480p'}
          videoBitrate={1_600_000}
          animateShutter={false}
          onCameraReady={onCameraReady}
        />
      )}

      {phase.kind === 'result' ? (
        <Performance key={phase.photo.uri} phase={phase} onAgain={again} onTrack={() => setShowMine(true)} />
      ) : (
        photo && <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Your photo of the problem" />
      )}

      {phase.kind === 'camera' && (
        <>
          <View style={[styles.top, { paddingTop: Math.max(14, insets.top) }]}>
            <Text style={styles.wordmark}>MAMDANI</Text>
            <Pressable style={styles.mineBtn} onPress={() => setShowMine(true)} accessibilityRole="button">
              <Text style={styles.mineText}>My reports</Text>
            </Pressable>
          </View>
          <View style={[styles.where, { top: Math.max(14, insets.top) + 52 }]} accessibilityLiveRegion="polite">
            <PinIcon />
            <Text style={styles.whereText} numberOfLines={1}>
              {where.denied
                ? 'Location off, using downtown Ottawa'
                : where.approximate
                  ? 'Finding where you are…'
                  : where.label
                    ? `Near ${where.label}`
                    : 'Location found'}
            </Text>
          </View>

          {!camPerm ? null : !camAllowed ? (
            <View style={[styles.card, { bottom: Math.max(20, insets.bottom + 8) }]}>
              <Text style={styles.cardTitle}>Mamdani needs to see the problem</Text>
              <Text style={styles.cardBody}>
                {camPerm.canAskAgain
                  ? 'Allow the camera so you can point it at what’s broken, or send a photo you already took.'
                  : 'Camera access is off for this app. Turn it on in Settings, or send a photo you already took.'}
              </Text>
              <View style={styles.cardActions}>
                <Button variant="primary" onPress={() => (camPerm.canAskAgain ? requestCam() : Linking.openSettings())}>
                  {camPerm.canAskAgain ? 'Allow the camera' : 'Open Settings'}
                </Button>
                <Button onPress={pick}>Choose a photo</Button>
              </View>
            </View>
          ) : (
            <>
              <Guides />
              <LinearGradient
                colors={['rgba(38,41,44,0)', 'rgba(38,41,44,0.92)']}
                locations={[0, 0.7]}
                style={[styles.bottom, { paddingBottom: Math.max(20, insets.bottom + 6) }]}
              >
                <Text style={styles.say}>{recording ? 'TELL MAMDANI WHAT’S WRONG' : 'MAMDANI, FIX THIS.'}</Text>
                <View style={styles.shutterRow}>
                  <Pressable style={styles.sideBtn} onPress={pick} accessibilityRole="button" accessibilityLabel="Send a photo or video you already took">
                    <GalleryIcon />
                  </Pressable>
                  <Shutter recording={recording} progress={progress} onPressIn={onPressIn} onPressOut={onPressOut} />
                  <View style={styles.sideSpacer} />
                </View>
                <Text style={styles.hint}>
                  {recording ? 'Let go to send.' : micPerm?.granted === false && !micPerm.canAskAgain ? 'Tap to take a photo.' : 'Tap for a photo. Hold to record and talk.'}
                </Text>
              </LinearGradient>
            </>
          )}
        </>
      )}

      {phase.kind === 'analyzing' && <Analyzing bottom={insets.bottom} />}

      {phase.kind === 'error' && (
        <View style={[styles.card, { bottom: Math.max(20, insets.bottom + 8) }]} accessibilityRole="alert">
          <Text style={styles.cardTitle}>Report not sent</Text>
          <Text style={styles.cardBody}>{phase.message}</Text>
          <View style={styles.cardActions}>
            {phase.photo && (
              <Button variant="primary" onPress={() => phase.photo && submit(phase.photo, null)}>
                Send it again
              </Button>
            )}
            <Button variant={phase.photo ? 'plain' : 'primary'} onPress={again}>
              Take a new photo
            </Button>
          </View>
        </View>
      )}

      <MyReports visible={showMine} onClose={() => setShowMine(false)} />
    </View>
  );
}

function Shutter({
  recording,
  progress,
  onPressIn,
  onPressOut,
}: {
  recording: boolean;
  progress: Animated.Value;
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const r = 46;
  const len = 2 * Math.PI * r;
  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Let go to stop recording and send' : 'Take a photo. Hold to record video with your voice.'}
      style={styles.shutter}
    >
      {({ pressed }) => (
        <>
          <Svg width={84} height={84} viewBox="0 0 100 100" style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}>
            <Circle cx={50} cy={50} r={r} stroke={C.paper} strokeWidth={6} fill="none" strokeOpacity={recording ? 0.35 : 1} />
            {recording && (
              <AnimatedCircle
                cx={50}
                cy={50}
                r={r}
                stroke={C.survey}
                strokeWidth={6}
                fill="none"
                strokeDasharray={[len, len]}
                strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [len, 0] })}
              />
            )}
          </Svg>
          <View
            style={[
              styles.shutterCore,
              pressed && !recording && { margin: 15 },
              recording && { margin: 27, borderRadius: 8, backgroundColor: C.survey },
            ]}
          />
        </>
      )}
    </Pressable>
  );
}
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function Analyzing({ bottom }: { bottom: number }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 2600);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['rgba(38,41,44,0.15)', 'rgba(38,41,44,0.85)']} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
      <Guides focusing />
      <View style={[styles.analyzing, { bottom: Math.max(36, bottom + 20) }]}>
        <ActivityIndicator color={C.survey} />
        <Text style={styles.analyzingText} accessibilityLiveRegion="polite">
          {late ? 'Checking whether your neighbours already reported it…' : 'Mamdani is taking a look…'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, backgroundColor: C.asphalt, overflow: 'hidden' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  wordmark: {
    fontFamily: F.stencil,
    fontSize: 34,
    lineHeight: 36,
    paddingTop: 4,
    color: C.paper,
    letterSpacing: 0.7,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 12,
  },
  mineBtn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(243,242,238,0.92)', justifyContent: 'center' },
  mineText: { fontFamily: F.uiBold, fontSize: T.sm, color: C.asphalt, paddingTop: 2 },
  where: {
    position: 'absolute',
    left: 16,
    maxWidth: '88%',
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(38,41,44,0.66)',
  },
  whereText: { fontFamily: F.uiSemi, fontSize: T.sm, color: C.paper, paddingTop: 2, flexShrink: 1 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, paddingTop: 72, paddingHorizontal: 20, alignItems: 'center' },
  say: { fontFamily: F.stencil, fontSize: 38, lineHeight: 40, paddingTop: 4, color: C.paper, marginBottom: 18, textAlign: 'center', letterSpacing: 0.8 },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 24 },
  sideBtn: { width: 52, height: 52, borderRadius: 14, backgroundColor: 'rgba(243,242,238,0.14)', alignItems: 'center', justifyContent: 'center' },
  sideSpacer: { width: 52 },
  shutter: { width: 84, height: 84 },
  shutterCore: { flex: 1, margin: 12, borderRadius: 999, backgroundColor: C.paper },
  hint: { fontFamily: F.ui, fontSize: T.sm, color: 'rgba(243,242,238,0.78)', marginTop: 12 },
  analyzing: { position: 'absolute', left: 20, right: 20, alignItems: 'center', gap: 12 },
  analyzingText: { fontFamily: F.uiBold, fontSize: T.xl, lineHeight: 30, color: C.paper, textAlign: 'center' },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 5,
    padding: 20,
    backgroundColor: C.paper,
    borderRadius: 14,
    shadowColor: C.asphalt,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  cardTitle: { fontFamily: F.uiBlack, fontSize: T.xl, lineHeight: 29, color: C.asphalt, marginBottom: 6 },
  cardBody: { fontFamily: F.ui, fontSize: T.md, lineHeight: 23, color: C.curb, marginBottom: 16 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
