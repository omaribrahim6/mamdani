import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Animated, Easing, Image, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import type { MayorOutfit } from '../../components/mayor/build';
import { PortraitStage } from '../../components/mayor/portrait';
import { MayorStage } from '../../components/mayor/stage';
import { category } from '../../lib/categories';
import type { CharacterDecision, CharacterOutfit, Mood, ReportDecision } from '../../lib/types';
import { newSessionId, submitReport, type Media } from './api';
import { flow, framesOpen, initialFlow, liveMaySpeak, mamdaniMode, micOpen, showsSnapshot, type FlowState } from './flow/machine';
import { GLHost } from './GLHost';
import { LiveClient } from './live/client';
import { useMic } from './live/useMic';
import { useWhere } from './location';
import { loadMine, saveMine } from './mine';
import { MyReports } from './MyReports';
import { ReportSheet, severityWord } from './ReportSheet';
import { Button, PinIcon } from './ui';
import { hush, prepareAudio, say } from './voice';
import { C, F, T } from './theme';

const OUTFIT: Record<CharacterOutfit, MayorOutfit> = {
  DEFAULT: 'suit',
  CONSTRUCTION: 'construction',
  INSPECTOR: 'inspector',
  SANITATION: 'sanitation',
};
const MOOD: Record<CharacterDecision['emotion'], Mood> = {
  CONCERNED: 'dismayed',
  DETERMINED: 'determined',
  IMPRESSED: 'impressed',
  CONFUSED: 'confused',
  CHEERFUL: 'impressed',
};
const PROCESSING_LINES = ['Looking at it…', 'Understanding the issue…', 'Checking nearby reports…'];
const WINDOW = 84; // Mamdani's round window
const ACCENT = C.hardhat;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Evidence photos go up at 1600 px on the long edge: clear for a crew, quick on a cell connection. */
async function shrink(uri: string, w: number, h: number, long: number, compress: number, base64 = false) {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(w, h) > long) ctx.resize(w >= h ? { width: long } : { height: long });
  const img = await ctx.renderAsync();
  return img.saveAsync({ compress, format: SaveFormat.JPEG, base64 });
}

export function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const viewH = Math.round(Math.min(H * 0.74, H - 196 - insets.bottom));
  const where = useWhere();
  const [camPerm, requestCam] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const camReady = useRef(false);
  const camBusy = useRef(false);

  const [f, dispatch] = useReducer(flow, initialFlow);
  const state = f.state;
  const stateRef = useRef<FlowState>(state);
  stateRef.current = state;

  // one Mamdani, two framings: his window (portrait) and the photo (scene)
  const portrait = useRef<PortraitStage | null>(null);
  const scene = useRef<MayorStage | null>(null);

  // Gemini Live: his eyes, ears and conversation
  const live = useRef(new LiveClient()).current;
  const [liveStatus, setLiveStatus] = useState(live.status);
  const [talking, setTalking] = useState(false);
  const talkingRef = useRef(false);
  const mic = useMic(micOpen(state) && !talking && liveStatus === 'live', (b64) => live.sendAudio(b64));

  const [line, setLine] = useState<string | null>(null); // the one line of text under the camera
  const [sheet, setSheet] = useState(false);
  const [mineOpen, setMineOpen] = useState(false);
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  const devDecision = useRef<ReportDecision | null>(null);
  const details = useRef<{ hazards: string[]; notes: string[] }>({ hazards: [], notes: [] });

  // motion
  const win = useRef({ sx: new Animated.Value(1), sy: new Animated.Value(1) }).current;
  const flash = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const brackets = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void loadMine().then((m) => setLastPhoto(m.find((x) => x.photoUri)?.photoUri ?? null));
    void prepareAudio();
  }, []);

  // ── Mamdani speaks (one voice for everything) ──
  const speak = useCallback(async (text: string, who: 'portrait' | 'scene', pcm?: Uint8Array[]) => {
    const stage = who === 'scene' ? scene.current : portrait.current;
    talkingRef.current = true;
    setTalking(true);
    setLine(text);
    if (who === 'portrait') portrait.current?.act('talk');
    await say(text, { onStart: () => stage?.speaking(true), onLevel: (v) => stage?.mouthLevel(v) }, pcm);
    stage?.speaking(false);
    talkingRef.current = false;
    setTalking(false);
    if (who === 'portrait' && stateRef.current === 'LIVE_IDLE') portrait.current?.act('watch');
  }, []);

  // ── Live session ──
  useEffect(() => {
    live.onStatus = setLiveStatus;
    live.onReply = (r) => {
      const s = stateRef.current;
      // connected ≠ allowed to talk: outside these states the orchestrator owns Mamdani
      if (!liveMaySpeak(s) || talkingRef.current || !r.text) return;
      void speak(r.text, mamdaniMode(s) === 'SCENE' ? 'scene' : 'portrait', r.audio);
    };
    void live.start();
    return () => live.stop();
  }, [live, speak]);

  // he listens while you talk
  const hearing = mic.level > 0.06;
  useEffect(() => {
    if (state !== 'LIVE_IDLE' || talking) return;
    if (hearing) {
      portrait.current?.act('listen');
      return;
    }
    const t = setTimeout(() => stateRef.current === 'LIVE_IDLE' && !talkingRef.current && portrait.current?.act('watch'), 900);
    return () => clearTimeout(t);
  }, [hearing, state, talking]);

  // what the camera sees, for Live — only while the camera is live (never after the shutter)
  useEffect(() => {
    if (!framesOpen(state) || liveStatus !== 'live' || !camPerm?.granted) return;
    const t = setInterval(async () => {
      if (!cam.current || !camReady.current || camBusy.current || !framesOpen(stateRef.current)) return;
      camBusy.current = true;
      try {
        const shot = await cam.current.takePictureAsync({ quality: 0.3, skipProcessing: true, shutterSound: false });
        if (shot && framesOpen(stateRef.current)) {
          const small = await shrink(shot.uri, shot.width, shot.height, 512, 0.5, true);
          if (small.base64) live.sendFrame(small.base64);
        }
      } catch {
        /* skip this frame */
      } finally {
        camBusy.current = false;
      }
    }, 2000);
    return () => clearInterval(t);
  }, [state, liveStatus, camPerm?.granted, live]);

  // ── the shutter: "report this" ──
  const capture = async () => {
    if (stateRef.current !== 'LIVE_IDLE' || !cam.current || !camReady.current) return;
    // wait out an in-flight Live frame so the evidence capture never collides with it
    for (let i = 0; camBusy.current && i < 20; i++) await wait(50);
    camBusy.current = true;
    hush();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
    try {
      const shot = await cam.current.takePictureAsync({ quality: 0.9, shutterSound: false });
      if (!shot) throw new Error('no photo');
      const img = await shrink(shot.uri, shot.width, shot.height, 1600, 0.82);
      dispatch({
        type: 'SHUTTER',
        snapshot: {
          sessionId: newSessionId(),
          photo: { uri: img.uri, width: img.width, height: img.height },
          lat: where.lat,
          lng: where.lng,
          capturedAt: Date.now(),
          context: live.recentConversation(),
        },
      });
    } catch {
      setLine('The camera didn’t take the photo. Try again.');
    } finally {
      camBusy.current = false;
    }
  };

  // ── the orchestrator: side effects per state ──
  const attempt = useRef(0);
  const heard = useRef('');
  useEffect(() => {
    let alive = true;
    const p = portrait.current;
    const snap = f.snapshot;
    const d = f.decision;

    switch (state) {
      case 'LIVE_IDLE': {
        p?.act('watch');
        setLine(null);
        if (f.notice) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          void speak(f.notice, 'portrait');
          const t = setTimeout(() => dispatch({ type: 'DISMISS_NOTICE' }), 6000);
          return () => clearTimeout(t);
        }
        break;
      }

      case 'CAPTURED':
        p?.look('feed');
        dispatch({ type: 'PROCESSING' });
        break;

      case 'REPORT_PROCESSING': {
        p?.act('think');
        const n = ++attempt.current;
        setLine(PROCESSING_LINES[0]);
        const timers = [setTimeout(() => setLine(PROCESSING_LINES[1]), 1300), setTimeout(() => setLine(PROCESSING_LINES[2]), 2800)];
        shimmer.setValue(0);
        const sweep = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
        sweep.start();
        (async () => {
          if (!snap) return;
          try {
            if (devDecision.current) {
              await wait(3200);
              if (alive && n === attempt.current) dispatch({ type: 'DECIDED', decision: devDecision.current });
              return;
            }
            const res = await submitReport({ ...snap, answer: f.answer, final: !!f.answer });
            if (!alive || n !== attempt.current) return;
            if (res.status === 'clarify') dispatch({ type: 'CLARIFY', question: res.question, options: res.options });
            else if (res.status === 'rejected') dispatch({ type: 'FAILED', message: res.message });
            else {
              details.current = { hazards: res.analysis.hazards, notes: res.analysis.accessibility.notes };
              void saveMine({
                issueId: res.decision.issue.id,
                title: res.decision.issue.title,
                category: res.decision.issue.type,
                address: res.decision.issue.address,
                at: Date.now(),
                duplicate: res.decision.issue.duplicate,
                photoUri: snap.photo.uri,
              });
              setLastPhoto(snap.photo.uri);
              dispatch({ type: 'DECIDED', decision: res.decision });
            }
          } catch (e) {
            if (alive) dispatch({ type: 'FAILED', message: e instanceof Error ? e.message : 'I couldn’t file that one. Try again.' });
          }
        })();
        return () => {
          alive = false;
          timers.forEach(clearTimeout);
          sweep.stop();
        };
      }

      case 'REPORT_CLARIFYING': {
        const q = f.clarify!;
        heard.current = '';
        let debounce: ReturnType<typeof setTimeout> | undefined;
        (async () => {
          await speak(q.question, 'portrait');
          if (!alive) return;
          setLine(q.question);
          p?.act('listen');
          // his question is out; whatever the resident says next is the answer
          live.onHeard = (chunk) => {
            heard.current += chunk;
            clearTimeout(debounce);
            debounce = setTimeout(() => {
              const answer = heard.current.trim();
              if (alive && answer) dispatch({ type: 'ANSWERED', answer });
            }, 1500);
          };
        })();
        return () => {
          alive = false;
          clearTimeout(debounce);
          live.onHeard = undefined;
        };
      }

      case 'REPORT_READY': {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLine('Got it.');
        brackets.setValue(0);
        Animated.timing(brackets, { toValue: 1, duration: 650, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: false }).start();
        (async () => {
          p?.look('you');
          await wait(450);
          // he changes into what the job needs, in his window, before heading out
          await p?.suitUp(OUTFIT[d!.character.outfit]);
          await wait(250);
          if (alive) dispatch({ type: 'EXIT' });
        })();
        return () => {
          alive = false;
        };
      }

      case 'CHARACTER_EXITING': {
        setLine(null);
        (async () => {
          await p?.exitLeft();
          // the empty window closes: ◯ → () → | → gone
          await new Promise<void>((done) =>
            Animated.sequence([
              Animated.delay(120),
              Animated.timing(win.sx, { toValue: 0.55, duration: 90, useNativeDriver: true }),
              Animated.parallel([
                Animated.timing(win.sx, { toValue: 0.06, duration: 110, useNativeDriver: true }),
                Animated.timing(win.sy, { toValue: 1.12, duration: 110, useNativeDriver: true }),
              ]),
              Animated.timing(win.sy, { toValue: 0, duration: 90, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            ]).start(() => done()),
          );
          await wait(180);
          if (alive) dispatch({ type: 'ENTER' });
        })();
        return () => {
          alive = false;
        };
      }

      case 'CHARACTER_ENTERING': {
        const c = d!.character;
        void scene.current
          ?.perform(OUTFIT[c.outfit], {
            target: targetFor(d!, snap!.photo, W, viewH),
            mood: MOOD[c.emotion],
            action: c.animation,
            prop: c.prop,
            onArrive: () => dispatch({ type: 'ACT' }),
            onThunk: () => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              Animated.sequence([
                Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
                Animated.timing(shake, { toValue: -1, duration: 70, useNativeDriver: true }),
                Animated.timing(shake, { toValue: 0, duration: 90, useNativeDriver: true }),
              ]).start();
            },
          })
          .then(() => dispatch({ type: 'SPEAK' }));
        break;
      }

      case 'CHARACTER_ACTION':
        Animated.timing(brackets, { toValue: 2, duration: 400, useNativeDriver: false }).start();
        break;

      case 'CHARACTER_SPEAKING':
        // the animation timeline owns WHEN he speaks; the decision owns WHAT he says
        void speak(d!.character.response, 'scene').then(() => alive && dispatch({ type: 'SPOKEN' }));
        return () => {
          alive = false;
        };

      case 'REPORT_COMPLETE': {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // from here Live talks about the filed report, not a fresh read of the camera
        const i = d!.issue;
        live.tell(
          `[App] The resident just filed a report. Work order ${i.id} (${d!.reportId}). Issue: ${category(i.type).label}, "${i.title}". ` +
            `Summary: ${i.summary} Severity ${i.severity}/100, safety risk ${i.safetyRisk}/100, accessibility impact ${i.accessibilityImpact}. ` +
            `Location: ${i.address}. Sent to ${i.department}. Status: ${i.status}. ${i.duplicateCount} resident report(s) of this problem so far. ` +
            `You told them: "${d!.character.response}". Answer their questions about this report from these facts only. It is filed; there is nothing more to submit.`,
        );
        const t = setTimeout(() => dispatch({ type: 'CONVERSE' }), 1400);
        return () => clearTimeout(t);
      }

      case 'LIVE_CONVERSATION':
        if (!talkingRef.current) setLine(liveStatus === 'live' ? 'Ask Mamdani about this report.' : null);
        break;

      case 'CHARACTER_RETURNING': {
        hush();
        setLine(null);
        (async () => {
          await scene.current?.exitLeft();
          scene.current?.clear();
          brackets.setValue(0);
          // his window pops back open and he walks back into it
          win.sx.setValue(0);
          win.sy.setValue(0);
          Animated.parallel([
            Animated.spring(win.sx, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }),
            Animated.spring(win.sy, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }),
          ]).start();
          await portrait.current?.enterFromLeft('suit');
          live.tell('[App] The resident is starting a new report. You are back in your window watching the camera.');
          if (alive) dispatch({ type: 'RETURNED' });
        })();
        return () => {
          alive = false;
        };
      }
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // dev on the web preview: run a decision through the whole flow without the camera or the network
  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'web') return;
    (globalThis as { __mamdani?: unknown }).__mamdani = {
      run: (photo: Media, decision: ReportDecision) => {
        devDecision.current = decision;
        dispatch({
          type: 'SHUTTER',
          snapshot: { sessionId: newSessionId(), photo, lat: where.lat, lng: where.lng, capturedAt: Date.now(), context: '' },
        });
      },
      next: () => dispatch({ type: 'NEW_REPORT' }),
      state: () => stateRef.current,
    };
  }, [where.lat, where.lng]);

  // ── layout ──
  const mode = mamdaniMode(state);
  const snap = f.snapshot;
  const d = f.decision;
  const box = d && snap ? boxOnScreen(d, snap.photo, W, viewH) : null;
  const filed = state === 'REPORT_COMPLETE' || state === 'LIVE_CONVERSATION';
  const camAllowed = !!camPerm?.granted;
  const hint = state === 'LIVE_IDLE' ? 'Show Mamdani the problem, then tap to report it.' : '';

  return (
    <View style={styles.root}>
      {/* ── the world ── */}
      <Animated.View
        style={[
          styles.viewport,
          { height: viewH },
          { transform: [{ translateY: shake.interpolate({ inputRange: [-1, 0, 1], outputRange: [-2, 0, 3] }) }] },
        ]}
      >
        {camAllowed ? (
          <CameraView
            ref={cam}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="picture"
            animateShutter={false}
            onCameraReady={() => (camReady.current = true)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noCamera]}>
            {camPerm && (
              <View style={{ gap: 14, alignItems: 'center', paddingHorizontal: 32 }}>
                <Text style={styles.noCameraTitle}>Mamdani needs to see the problem</Text>
                <Text style={styles.noCameraBody}>
                  {camPerm.canAskAgain ? 'Allow the camera to point it at what’s broken.' : 'Camera access is off. Turn it on in Settings.'}
                </Text>
                <Button onPress={() => (camPerm.canAskAgain ? requestCam() : Linking.openSettings())}>
                  {camPerm.canAskAgain ? 'Allow the camera' : 'Open Settings'}
                </Button>
              </View>
            )}
          </View>
        )}

        {snap && showsSnapshot(state) && (
          <Image source={{ uri: snap.photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="The photo you're reporting" />
        )}

        {(state === 'REPORT_PROCESSING' || state === 'CAPTURED' || state === 'REPORT_CLARIFYING') && <Shimmer progress={shimmer} width={W} />}
        {box && <Brackets box={box} progress={brackets} width={W} height={viewH} />}

        <GLHost create={(s) => new MayorStage(s)} onReady={(s) => (scene.current = s)} />

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }) }]}
        />

        {state === 'LIVE_IDLE' && (
          <View style={[styles.where, { top: insets.top + 10 }]} accessibilityLiveRegion="polite">
            <PinIcon size={13} />
            <Text style={styles.whereText} numberOfLines={1}>
              {where.denied ? 'Location off' : where.approximate ? 'Finding you…' : (where.label ?? 'Located')}
            </Text>
          </View>
        )}
      </Animated.View>

      {/* ── the control surface ── */}
      <View style={[styles.controls, { paddingBottom: Math.max(16, insets.bottom) }]}>
        <View style={styles.lineWrap}>
          <Text style={[styles.line, !f.notice && !line && styles.hint]} numberOfLines={2} accessibilityLiveRegion="polite">
            {f.notice ?? line ?? hint}
          </Text>
          {state === 'REPORT_CLARIFYING' && f.clarify && (
            <View style={styles.options}>
              {f.clarify.options.map((o) => (
                <Pressable key={o} style={styles.option} onPress={() => dispatch({ type: 'ANSWERED', answer: o })} accessibilityRole="button">
                  <Text style={styles.optionText}>{o}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.row}>
          <View style={styles.side}>
            {filed && d ? (
              <Pressable onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel={`Reported. ${d.issue.title}. Open the report.`}>
                <Confirmation decision={d} />
              </Pressable>
            ) : (
              <PortraitWindow
                sx={win.sx}
                sy={win.sy}
                hidden={mode === 'SCENE'}
                listening={micOpen(state) && hearing && !talking}
                live={liveStatus === 'live'}
                onStage={(s) => {
                  portrait.current = s;
                  s?.show('suit');
                }}
              />
            )}
          </View>

          {filed ? (
            <Pressable style={styles.newReport} onPress={() => dispatch({ type: 'NEW_REPORT' })} accessibilityRole="button" accessibilityLabel="New report">
              <CameraGlyph />
            </Pressable>
          ) : (
            <Shutter
              disabled={state !== 'LIVE_IDLE' || !camAllowed}
              onPressIn={() => {
                portrait.current?.look('shutter', 650);
                void Haptics.selectionAsync();
              }}
              onPress={capture}
            />
          )}

          <View style={[styles.side, { alignItems: 'flex-end' }]}>
            <Pressable style={styles.thumb} onPress={() => setMineOpen(true)} accessibilityRole="button" accessibilityLabel="Your reports">
              {lastPhoto ? <Image source={{ uri: lastPhoto }} style={StyleSheet.absoluteFill} /> : <ListGlyph />}
            </Pressable>
          </View>
        </View>
      </View>

      {d && (
        <ReportSheet
          decision={d}
          photoUri={snap?.photo.uri ?? null}
          hazards={details.current.hazards}
          notes={details.current.notes}
          visible={sheet}
          onClose={() => setSheet(false)}
        />
      )}
      <MyReports visible={mineOpen} onClose={() => setMineOpen(false)} />
    </View>
  );
}

// ── geometry: the AI's box in the photo → the viewport (photo drawn "cover") ──

function boxOnScreen(d: ReportDecision, photo: Media, w: number, h: number) {
  const k = Math.max(w / photo.width, h / photo.height);
  const dw = photo.width * k;
  const dh = photo.height * k;
  const ox = (w - dw) / 2;
  const oy = (h - dh) / 2;
  const [y0, x0, y1, x1] = d.issue.box ?? [420, 330, 700, 670];
  return { x: ox + (x0 / 1000) * dw, y: oy + (y0 / 1000) * dh, w: ((x1 - x0) / 1000) * dw, h: ((y1 - y0) / 1000) * dh };
}

function targetFor(d: ReportDecision, photo: Media, w: number, h: number) {
  const b = boxOnScreen(d, photo, w, h);
  const x = Math.max(0.25, Math.min(0.85, (b.x + b.w / 2) / w));
  // overhead problems (a dead streetlight): he stands on the ground below and looks up
  if (d.character.animation === 'LOOK_UP') return { x, y: 0.8 };
  return { x, y: Math.max(0.45, Math.min(0.9, (b.y + b.h * 0.85) / h)) };
}

// ── pieces ──

function PortraitWindow({
  sx,
  sy,
  hidden,
  listening,
  live,
  onStage,
}: {
  sx: Animated.Value;
  sy: Animated.Value;
  hidden: boolean;
  listening: boolean;
  live: boolean;
  onStage: (s: PortraitStage | null) => void;
}) {
  return (
    <Animated.View
      style={[styles.window, listening && styles.windowListening, { opacity: hidden ? 0 : 1, transform: [{ scaleX: sx }, { scaleY: sy }] }]}
      accessible
      accessibilityLabel={listening ? 'Mamdani is listening' : 'Mamdani'}
    >
      <View style={styles.windowInner}>
        <LinearGradient colors={['#f1eee7', '#d8d4ca']} style={StyleSheet.absoluteFill} />
        <GLHost create={(s) => new PortraitStage(s)} onReady={onStage} />
      </View>
      {live && <View style={styles.liveDot} />}
    </Animated.View>
  );
}

function Shutter({ disabled, onPressIn, onPress }: { disabled: boolean; onPressIn: () => void; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        onPressIn();
        Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
      }}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 12 }).start()}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Report this"
      accessibilityState={{ disabled }}
      style={styles.shutter}
    >
      <View style={[styles.shutterRing, disabled && { opacity: 0.35 }]} />
      <Animated.View style={[styles.shutterCore, disabled && { opacity: 0.35 }, { transform: [{ scale }] }]} />
    </Pressable>
  );
}

function Confirmation({ decision }: { decision: ReportDecision }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 8 }).start();
  }, [pop]);
  const i = decision.issue;
  return (
    <Animated.View style={{ opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Svg width={16} height={16} viewBox="0 0 16 16">
          <Circle cx={8} cy={8} r={8} fill={ACCENT} />
          <Path d="M4.5 8.3l2.2 2.2 4.8-5" stroke={C.asphalt} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        <Text style={styles.confTitle}>Reported</Text>
      </View>
      <Text style={styles.confBody} numberOfLines={1}>
        {category(i.type).label}, {severityWord(i.severity).toLowerCase()}
      </Text>
      <Text style={styles.confMeta}>Report #{i.id}</Text>
    </Animated.View>
  );
}

/** A slow band of light across the frozen photo while Mamdani looks at it. */
function Shimmer({ progress, width }: { progress: Animated.Value; width: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.18)' }]} />
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { width: width * 0.6, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.6, width] }) }] },
        ]}
      >
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/** Focus brackets close in on the problem when the decision lands, then step aside for Mamdani. */
function Brackets({ box, progress, width, height }: { box: { x: number; y: number; w: number; h: number }; progress: Animated.Value; width: number; height: number }) {
  const pad = 10;
  const to = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  const from = { x: 24, y: 60, w: width - 48, h: height - 120 };
  const range = { inputRange: [0, 1, 2], extrapolate: 'clamp' as const };
  const L = 22;
  const corner = (dx: 0 | 1, dy: 0 | 1) => ({
    position: 'absolute' as const,
    width: L,
    height: L,
    borderColor: '#fff',
    ...(dx ? { right: 0, borderRightWidth: 3 } : { left: 0, borderLeftWidth: 3 }),
    ...(dy ? { bottom: 0, borderBottomWidth: 3 } : { top: 0, borderTopWidth: 3 }),
    ...(dx && dy ? { borderBottomRightRadius: 8 } : dx ? { borderTopRightRadius: 8 } : dy ? { borderBottomLeftRadius: 8 } : { borderTopLeftRadius: 8 }),
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: progress.interpolate({ ...range, outputRange: [from.x, to.x, to.x] }),
        top: progress.interpolate({ ...range, outputRange: [from.y, to.y, to.y] }),
        width: progress.interpolate({ ...range, outputRange: [from.w, to.w, to.w] }),
        height: progress.interpolate({ ...range, outputRange: [from.h, to.h, to.h] }),
        opacity: progress.interpolate({ inputRange: [0, 0.15, 1, 2], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
      }}
    >
      {([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(([dx, dy]) => (
        <View key={`${dx}${dy}`} style={corner(dx, dy)} />
      ))}
    </Animated.View>
  );
}

function CameraGlyph() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={C.asphalt} strokeWidth={2} strokeLinejoin="round">
      <Path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
      <Circle cx={12} cy={13} r={3.4} />
    </Svg>
  );
}

function ListGlyph() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={2} strokeLinecap="round">
      <Path d="M8 6h12M8 12h12M8 18h12" />
      <Circle cx={4} cy={6} r={1} fill="rgba(255,255,255,0.8)" />
      <Circle cx={4} cy={12} r={1} fill="rgba(255,255,255,0.8)" />
      <Circle cx={4} cy={18} r={1} fill="rgba(255,255,255,0.8)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  viewport: { overflow: 'hidden', borderBottomLeftRadius: 28, borderBottomRightRadius: 28, backgroundColor: '#111' },
  noCamera: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#15171a' },
  noCameraTitle: { fontFamily: F.uiBlack, fontSize: T.xl, lineHeight: 30, color: '#fff', textAlign: 'center' },
  noCameraBody: { fontFamily: F.ui, fontSize: T.md, lineHeight: 23, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  where: {
    position: 'absolute',
    left: 14,
    maxWidth: '70%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  whereText: { fontFamily: F.uiSemi, fontSize: 13, color: '#fff', paddingTop: 2, flexShrink: 1 },
  controls: { flex: 1, justifyContent: 'space-between', paddingTop: 14 },
  lineWrap: { minHeight: 44, paddingHorizontal: 28, alignItems: 'center' },
  line: { fontFamily: F.uiSemi, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.9)', textAlign: 'center' },
  hint: { color: 'rgba(255,255,255,0.5)' },
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 10 },
  option: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  optionText: { fontFamily: F.uiBold, fontSize: T.sm, color: '#fff', paddingTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22 },
  side: { flex: 1, justifyContent: 'center' },
  window: { width: WINDOW, height: WINDOW, borderRadius: WINDOW / 2, padding: 3, backgroundColor: 'rgba(255,255,255,0.14)' },
  windowListening: { backgroundColor: ACCENT },
  windowInner: { flex: 1, borderRadius: WINDOW / 2, overflow: 'hidden' },
  liveDot: { position: 'absolute', right: 5, top: 5, width: 11, height: 11, borderRadius: 6, backgroundColor: ACCENT, borderWidth: 2, borderColor: '#000' },
  shutter: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  shutterRing: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#fff' },
  shutterCore: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  newReport: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  thumb: {
    width: 46,
    height: 46,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  confTitle: { fontFamily: F.uiBlack, fontSize: T.md, color: '#fff', paddingTop: 2 },
  confBody: { fontFamily: F.uiSemi, fontSize: T.sm, color: 'rgba(255,255,255,0.8)', marginTop: 3 },
  confMeta: { fontFamily: F.ui, fontSize: T.xs, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
});
