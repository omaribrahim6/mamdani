import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Animated, Easing, Image, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import type { MayorOutfit } from '../../components/mayor/build';
import { PortraitStage, type SpeechCue } from '../../components/mayor/portrait';
import { MayorStage } from '../../components/mayor/stage';
import { category } from '../../lib/categories';
import type { CharacterDecision, CharacterOutfit, Mood, ReportDecision } from '../../lib/types';
import { newSessionId, submitReport, verifyAnswer, type Media } from './api';
import { flow, framesOpen, initialFlow, liveMaySpeak, mamdaniMode, micOpen, showsSnapshot, type FlowState } from './flow/machine';
import { GLHost } from './GLHost';
import { LiveAudio } from './live/audio';
import { LiveClient, type ToolCall } from './live/client';
import { useWhere } from './location';
import { loadMine, saveMine } from './mine';
import { MyReports } from './MyReports';
import { ReportSheet, severityWord } from './ReportSheet';
import { Button, PinIcon } from './ui';
import { hush, sayOnDevice } from './voice';
import { C, F, T } from './theme';

// The resident opens the app; Mamdani, in his round window, asks what the problem is. They talk it
// through while he watches the camera (Gemini Live). When he's heard and seen enough he says
// "hold steady" and takes the evidence photo himself (the report_issue tool). One Gemini decision
// comes back; he suits up, walks out of his window and into the photo, does what the job needs,
// and tells them — in his own voice — that it's reported. Then they can keep talking about it.

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
const PROCESSING_LINES = ['Mamdani’s getting ready…', 'Looking over your photo…', 'Checking nearby reports…'];
const WINDOW = 156; // Mamdani's round window
const CONTROLS_PAD = 14; // above and below the row with his window
const ACCENT = C.hardhat;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── demo branch: one scripted take for the video ──
// Say "fix this pothole" (or tap the camera view): he answers with a pre-recorded Orus line, starts
// walking out on "I'll send it over!", steps into the photo in his construction gear and plants the flag.
// No network in the loop except Live's ears; nothing is filed.
const DEMO = true;
const DEMO_LINE = 'Worry not, young citizen! My finest engineers will fix this ASAP. I’ll send it over!';
const DEMO_EXIT_AT = 3500; // into the 5.1 s line, on "ASAP": he's on his way as he says "I'll send it over!"
// His body language for the demo line, timed to its stressed syllables (measured from demo-line.wav:
// WOR 0.12 · NOT 0.46 · CIT 0.97 · MY 1.62 · FIN 1.92 · NEERS 2.58 · FIX 3.21 · A-SAP 3.47).
// Each stroke starts ~0.1–0.3 s early so it lands on the syllable, the way animators lead a word.
const DEMO_CUES: SpeechCue[] = [
  { at: 0, gesture: 'reassure', look: 'you', expr: 'CHEERFUL' }, // "Worry not…" — I've got this
  { at: 0.36, shake: true }, // "…NOT"
  { at: 0.86, nod: 0.09 }, // "young CITizen!"
  { at: 1.3, gesture: 'proud', nod: -0.07 }, // "MY finest…": hand to chest, chin up
  { at: 1.84, nod: 0.07 }, // "FINest"
  { at: 2.48, nod: 0.05 }, // "engiNEERS"
  { at: 2.72, gesture: 'pointFeed', look: 'feed', expr: 'DETERMINED' }, // "will FIX this": at the problem
  { at: 3.1, nod: 0.11 }, // "FIX"
  { at: 3.38, nod: 0.07 }, // "A-SAP", and out of the window on DEMO_EXIT_AT
];
const DEMO_TRIGGER = /fix (this|it)\b/i;
const demoDecision = (address: string): ReportDecision => ({
  reportId: 'report_1849',
  sessionId: 'demo',
  issue: {
    id: 1849,
    type: 'pothole',
    title: 'Deep pothole in the lane',
    summary: 'A deep pothole in the driving lane.',
    severity: 82,
    safetyRisk: 74,
    accessibilityImpact: 'moderate',
    department: 'Roads Services',
    address,
    status: 'new',
    duplicateCount: 1,
    duplicate: false,
    box: [470, 300, 760, 700], // centre-bottom of the frame: point the phone at the pothole
  },
  character: { outfit: 'CONSTRUCTION', animation: 'PLACE_FLAG', prop: 'WARNING_FLAG', emotion: 'DETERMINED', response: DEMO_LINE },
  confidence: 0.94,
  engine: 'demo',
});

/** Shrink a camera shot: 1600 px for evidence, 512 px for what Live sees. */
async function shrink(uri: string, w: number, h: number, long: number, compress: number, base64 = false) {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(w, h) > long) ctx.resize(w >= h ? { width: long } : { height: long });
  const img = await ctx.renderAsync();
  return img.saveAsync({ compress, format: SaveFormat.JPEG, base64 });
}

/** The filed report as facts Mamdani can talk about afterwards. */
function factsOf(d: ReportDecision) {
  const i = d.issue;
  return (
    `Work order ${i.id}: ${category(i.type).label}, "${i.title}". ${i.summary} Severity ${i.severity}/100 (${severityWord(i.severity).toLowerCase()}), ` +
    `safety risk ${i.safetyRisk}/100, accessibility impact ${i.accessibilityImpact}. At ${i.address}. Sent to ${i.department}. ` +
    `Status: ${i.status}. ${i.duplicateCount} resident report(s) of this problem so far.`
  );
}

export function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  // the camera gets everything above the one row of controls
  const viewH = Math.round(H - (WINDOW + 8) - CONTROLS_PAD - Math.max(CONTROLS_PAD, insets.bottom));
  const where = useWhere();
  const [camPerm, requestCam] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const camReady = useRef(false);
  const camBusy = useRef(false);
  // capture at 1080p, not the full sensor: every frame for Live is a capture, and full-size ones stall the preview
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const [f, dispatch] = useReducer(flow, initialFlow);
  const state = f.state;
  const stateRef = useRef<FlowState>(state);
  stateRef.current = state;
  const decisionRef = useRef(f.decision);
  decisionRef.current = f.decision;
  const mode = mamdaniMode(state);

  // one Mamdani, two framings: his window (portrait) and the photo (scene)
  const portrait = useRef<PortraitStage | null>(null);
  const scene = useRef<MayorStage | null>(null);

  // Gemini Live (his mind) and the phone's audio (his ears and voice)
  // created once (useRef(new X()) would build, and throw away, a new one every render)
  const [live] = useState(() => new LiveClient());
  const [audio] = useState(() => new LiveAudio());
  const [liveStatus, setLiveStatus] = useState(live.status);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [said, setSaid] = useState(''); // what he's saying, as a caption
  const freshTurn = useRef(true);

  const pendingCall = useRef<ToolCall | null>(null); // his report_issue call, answered when the pipeline decides
  const visual = useRef(''); // what he said he saw
  const held = useRef<string[] | null>(null); // a post-report answer, held until it's checked
  const correcting = useRef(false);
  const lineSpoken = useRef<(() => void) | null>(null);

  const [line, setLine] = useState<string | null>(null); // status under the camera
  const [sheet, setSheet] = useState(false);
  const [mineOpen, setMineOpen] = useState(false);
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  const devDecision = useRef<ReportDecision | null>(null);
  // demo branch
  const heardRef = useRef('');
  const demoClip = useRef<Awaited<ReturnType<LiveAudio['loadClip']>>>(null);
  const demoRunning = useRef(false);
  const runDemoRef = useRef<(photo?: Media) => Promise<void>>(async () => {});
  const details = useRef<{ hazards: string[]; notes: string[] }>({ hazards: [], notes: [] });

  // motion
  const win = useRef({ sx: new Animated.Value(1), sy: new Animated.Value(1) }).current;
  const flash = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const brackets = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void loadMine().then((m) => setLastPhoto(m.find((x) => x.photoUri)?.photoUri ?? null));
  }, []);

  /** Answer his pending report_issue call. False if there isn't one. */
  const answer = useCallback(
    (response: Record<string, unknown>) => {
      const call = pendingCall.current;
      if (!call) return false;
      pendingCall.current = null;
      live.respond(call, response);
      return true;
    },
    [live],
  );

  /** Have him tell the resident something (Live's voice, or the phone's if Live is down). */
  const tell = useCallback(
    (text: string) => {
      if (live.status === 'live') live.prompt(`Tell the resident, briefly and kindly: "${text}"`);
      else void sayOnDevice(text);
    },
    [live],
  );

  // ── Live + audio wiring ──
  useEffect(() => {
    live.onStatus = setLiveStatus;
    if (DEMO) {
      // Live is only his ears here: no tools, no greeting, and whatever it says is never played
      live.adjustSetup = ({ tools: _tools, ...setup }) => ({
        ...setup,
        systemInstruction: { parts: [{ text: 'Listen quietly. Reply with a single short "Mm." to anything.' }] },
      });
      // "…pothole" goes at once; "fix this" waits a beat so he doesn't talk over the rest of the sentence
      let beat: ReturnType<typeof setTimeout> | undefined;
      live.onHeard = (chunk) => {
        heardRef.current = (heardRef.current + chunk).slice(-200);
        clearTimeout(beat);
        if (/pot ?holes?/i.test(heardRef.current)) void runDemoRef.current();
        else if (DEMO_TRIGGER.test(heardRef.current)) beat = setTimeout(() => void runDemoRef.current(), 700);
      };
      void live.start();
      return () => {
        clearTimeout(beat);
        live.stop();
        void audio.dispose();
      };
    }
    live.onFirstReady = () => live.prompt('Begin the conversation with your greeting.');
    live.onAudio = (pcm) => {
      const s = stateRef.current;
      if (!liveMaySpeak(s)) return;
      // about a filed report, the city's record is the truth: hold the answer until it's checked
      if (s === 'LIVE_CONVERSATION' && decisionRef.current && !correcting.current) {
        (held.current ??= []).push(pcm);
        return;
      }
      audio.play(pcm);
    };
    live.onSaid = (chunk) => {
      const s = stateRef.current;
      if (!liveMaySpeak(s) || (s === 'LIVE_CONVERSATION' && !correcting.current)) return;
      setSaid((p) => (freshTurn.current ? chunk : p + chunk));
      freshTurn.current = false;
    };
    live.onInterrupted = () => {
      audio.interrupt();
      held.current = null;
    };
    live.onTurn = async (text, heard) => {
      freshTurn.current = true;
      const s = stateRef.current;
      if (s === 'CHARACTER_SPEAKING' && lineSpoken.current) {
        await audio.drain();
        lineSpoken.current?.();
        lineSpoken.current = null;
        return;
      }
      if (s !== 'LIVE_CONVERSATION') return;
      if (correcting.current) {
        correcting.current = false;
        return;
      }
      const chunks = held.current;
      held.current = null;
      const d = decisionRef.current;
      if (!chunks?.length || !d || !text) return;
      const v = await verifyAnswer(d.issue.id, text, heard);
      if (stateRef.current !== 'LIVE_CONVERSATION') return;
      if (v.grounded) {
        setSaid(text);
        for (const c of chunks) audio.play(c);
      } else {
        correcting.current = true;
        live.prompt(`Your last answer went beyond the city's record of this report. Say exactly this instead: "${v.answer}"`);
      }
    };
    live.onToolCall = (call) => {
      if (call.name !== 'report_issue') return live.respond(call, { status: 'error' });
      const s = stateRef.current;
      if (s === 'REPORT_CLARIFYING') {
        pendingCall.current = call;
        dispatch({ type: 'ANSWERED', answer: call.args.clarification || call.args.visual_description || '' });
        return;
      }
      if (s !== 'LIVE_IDLE') return live.respond(call, { status: 'busy' });
      pendingCall.current = call;
      visual.current = call.args.visual_description ?? '';
      dispatch({ type: 'CAPTURE' });
    };
    void live.start();
    return () => {
      live.stop();
      void audio.dispose();
    };
  }, [live, audio]);

  // the mic: permission, then stream to Live whenever the state lets him listen
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await LiveAudio.permission().catch(() => false);
      if (!alive) return;
      setMicOk(ok);
      if (!ok) return;
      audio.onSpeaking = setSpeaking;
      audio.onError = (m) => console.warn('audio', m);
      await audio.start((pcm) => micOpen(stateRef.current) && live.sendAudio(pcm)).catch((e) => {
        console.warn('mic failed', e);
        setMicOk(false);
      });
      // Lyria-made "on his way" music for the wait while he gets ready
      if (DEMO) demoClip.current = await audio.loadClip(require('../assets/audio/demo-line.wav'));
      else void audio.loadMusic(require('../assets/audio/wait-loop.wav'));
    })();
    return () => {
      alive = false;
    };
  }, [audio, live]);

  useEffect(() => {
    audio.muted = muted;
  }, [audio, muted]);

  // his mouth follows his voice; his face shows he's listening
  useEffect(() => {
    const t = setInterval(() => {
      const v = audio.shapeNow();
      const m = mamdaniMode(stateRef.current);
      (m === 'SCENE' ? scene.current : portrait.current)?.mouthShape(v);
      const h = audio.micLevel > 0.06;
      setHearing((p) => (p === h ? p : h));
    }, 33);
    return () => clearInterval(t);
  }, [audio]);

  useEffect(() => {
    const talking = speaking && liveMaySpeak(state);
    if (mode === 'SCENE') {
      scene.current?.speaking(talking);
      return;
    }
    const p = portrait.current;
    if (!p) return;
    p.speaking(talking);
    if (state === 'LIVE_IDLE' || state === 'REPORT_CLARIFYING') p.act(talking ? 'talk' : hearing ? 'listen' : 'watch');
  }, [speaking, hearing, state, mode]);

  // what the camera sees, for Live — only while he's looking (never after the photo). Each frame is a
  // capture, so they're paced: quicker while you're talking to him, slower when it's quiet.
  const hearingRef = useRef(false);
  hearingRef.current = hearing;
  useEffect(() => {
    if (DEMO || !framesOpen(state) || liveStatus !== 'live' || !camPerm?.granted) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!alive) return;
      if (cam.current && camReady.current && !camBusy.current && framesOpen(stateRef.current)) {
        camBusy.current = true;
        try {
          const shot = await cam.current.takePictureAsync({ quality: 0.2, skipProcessing: true, shutterSound: false });
          if (shot && alive && framesOpen(stateRef.current)) {
            const small = await shrink(shot.uri, shot.width, shot.height, 512, 0.5, true);
            if (small.base64) live.sendFrame(small.base64);
          }
        } catch {
          /* skip this frame */
        } finally {
          camBusy.current = false;
        }
      }
      if (alive) timer = setTimeout(tick, hearingRef.current ? 1200 : 3000);
    };
    timer = setTimeout(tick, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [state, liveStatus, camPerm?.granted, live]);

  /** The evidence photo. */
  const takeEvidence = async (): Promise<Media> => {
    for (let i = 0; camBusy.current && i < 40; i++) await wait(50);
    if (!cam.current || !camReady.current) throw new Error('camera not ready');
    camBusy.current = true;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start();
      const shot = await cam.current.takePictureAsync({ quality: 0.9, shutterSound: false });
      if (!shot) throw new Error('no photo');
      const img = await shrink(shot.uri, shot.width, shot.height, 1600, 0.82);
      return { uri: img.uri, width: img.width, height: img.height };
    } finally {
      camBusy.current = false;
    }
  };

  const snapshotOf = (photo: Media) => ({
    sessionId: newSessionId(),
    photo,
    lat: where.lat,
    lng: where.lng,
    capturedAt: Date.now(),
    context: [live.recentConversation(), visual.current && `What Mamdani saw on camera: ${visual.current}`].filter(Boolean).join('\n'),
  });

  /** The demo take: his line in his window (photo taken meanwhile), out on the last words, then the
   *  usual flow with a hard-coded decision: into the photo in construction gear, flag down. */
  const runDemo = async (photoOverride?: Media) => {
    if (demoRunning.current || stateRef.current !== 'LIVE_IDLE') return;
    demoRunning.current = true;
    heardRef.current = '';
    const t0 = Date.now();
    setSaid(DEMO_LINE);
    const shot = photoOverride ? Promise.resolve(photoOverride) : takeEvidence();
    const clip = demoClip.current;
    if (!(clip && audio.playClip(clip))) void sayOnDevice(DEMO_LINE);
    portrait.current?.speak(DEMO_CUES);
    let photo: Media;
    try {
      photo = await shot;
    } catch {
      audio.interrupt();
      hush();
      setSaid('');
      setLine('The camera didn’t take the photo. Try again.');
      demoRunning.current = false;
      return;
    }
    await wait(DEMO_EXIT_AT - (Date.now() - t0));
    devDecision.current = demoDecision(where.label ?? 'Bank St at Gladstone Ave');
    dispatch({ type: 'SHUTTER', snapshot: { sessionId: 'demo', photo, lat: where.lat, lng: where.lng, capturedAt: Date.now(), context: '' } });
  };
  runDemoRef.current = runDemo;

  /** Manual report, for when Live can't be reached. */
  const manualCapture = async () => {
    if (DEMO) return void runDemo();
    if (stateRef.current !== 'LIVE_IDLE') return;
    visual.current = '';
    try {
      dispatch({ type: 'SHUTTER', snapshot: snapshotOf(await takeEvidence()) });
    } catch {
      setLine('The camera didn’t take the photo. Try again.');
    }
  };

  // ── analysis: starts the moment the snapshot is frozen, while he's already walking out ──
  const runRef = useRef(0);
  useEffect(() => {
    if (state !== 'CAPTURED' || !f.snapshot) return;
    const run = f.run;
    runRef.current = run;
    const snap = f.snapshot;
    const answerText = f.answer;
    (async () => {
      try {
        if (devDecision.current) {
          await wait(DEMO ? 0 : 3200);
          if (runRef.current === run) dispatch({ type: 'DECIDED', decision: devDecision.current });
          return;
        }
        const res = await submitReport({ ...snap, answer: answerText, final: !!answerText });
        if (runRef.current !== run) return;
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
        if (runRef.current === run) dispatch({ type: 'FAILED', message: e instanceof Error ? e.message : 'I couldn’t file that one. Try again.' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, f.run]);

  /** The window pops open again and he walks back into it. */
  const backToWindow = async () => {
    win.sx.setValue(0);
    win.sy.setValue(0);
    Animated.parallel([
      Animated.spring(win.sx, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }),
      Animated.spring(win.sy, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }),
    ]).start();
    await portrait.current?.enterFromLeft('suit');
  };

  // ── the orchestrator: side effects per state ──
  useEffect(() => {
    let alive = true;
    const p = portrait.current;
    const snap = f.snapshot;
    const d = f.decision;

    switch (state) {
      case 'LIVE_IDLE': {
        setLine(null);
        demoRunning.current = false;
        heardRef.current = '';
        if (f.notice) {
          setLine(f.notice);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          const t = setTimeout(() => dispatch({ type: 'DISMISS_NOTICE' }), 6000);
          return () => clearTimeout(t);
        }
        break;
      }

      case 'CAPTURING': {
        // let him finish "hold steady", then the cue, then the photo
        (async () => {
          p?.look('feed');
          await audio.drain(6000);
          if (!alive) return;
          setLine('Hold steady…');
          brackets.setValue(0);
          Animated.timing(brackets, { toValue: 1, duration: 500, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: false }).start();
          void Haptics.selectionAsync();
          await wait(900);
          if (!alive) return;
          try {
            dispatch({ type: 'SHUTTER', snapshot: snapshotOf(await takeEvidence()) });
          } catch {
            answer({ status: 'error' });
            dispatch({ type: 'FAILED', message: 'The camera didn’t take the photo. Try again.' });
          }
        })();
        return () => {
          alive = false;
        };
      }

      case 'CAPTURED': {
        // photo's in: he heads out straight away (the analysis effect above is already running)
        brackets.setValue(0);
        if (!DEMO) setLine('Got it.');
        const t = setTimeout(() => dispatch({ type: 'EXIT' }), DEMO ? 0 : 350);
        return () => clearTimeout(t);
      }

      case 'CHARACTER_EXITING': {
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
          if (!DEMO) await wait(150);
          if (alive) dispatch({ type: 'EXITED' });
        })();
        return () => {
          alive = false;
        };
      }

      case 'REPORT_PROCESSING': {
        // he's off getting ready: the waiting music, and the photo being looked over
        audio.startMusic();
        setLine(PROCESSING_LINES[0]);
        const timers = [setTimeout(() => setLine(PROCESSING_LINES[1]), 1600), setTimeout(() => setLine(PROCESSING_LINES[2]), 3400)];
        shimmer.setValue(0);
        const sweep = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
        sweep.start();
        return () => {
          timers.forEach(clearTimeout);
          sweep.stop();
        };
      }

      case 'CHARACTER_RECALLED': {
        // Gemini needs to ask something, or turned the photo down: he comes back to his window to say so
        audio.stopMusic(0.5);
        setLine(null);
        const outcome = f.outcome;
        (async () => {
          await backToWindow();
          if (!alive || !outcome) return;
          dispatch({ type: 'RECALLED' });
          if (outcome.kind === 'clarify') {
            if (!answer({ status: 'needs_clarification', question: outcome.question, options: outcome.options })) tell(outcome.question);
          } else if (!answer({ status: 'rejected', reason: outcome.message })) tell(outcome.message);
        })();
        return () => {
          alive = false;
        };
      }

      case 'REPORT_CLARIFYING':
        setLine(f.clarify?.question ?? null);
        p?.act('listen');
        break;

      case 'CHARACTER_ENTERING': {
        // the decision is in: the music fades as he steps into the photo, dressed for the job
        audio.stopMusic(0.9);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLine(null);
        setSaid('');
        brackets.setValue(0);
        Animated.timing(brackets, { toValue: 1, duration: 650, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: false }).start();
        const c = d!.character;
        void scene.current
          ?.perform(OUTFIT[c.outfit], {
            target: targetFor(d!, snap!.photo, W, viewH),
            mood: MOOD[c.emotion],
            emotion: c.emotion,
            action: c.animation,
            prop: c.prop,
            walk: DEMO ? 1.3 : undefined,
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

      case 'CHARACTER_SPEAKING': {
        // the animation timeline owns WHEN he speaks; the decision owns WHAT he says; Live is the voice
        const text = d!.character.response;
        if (DEMO) {
          dispatch({ type: 'SPOKEN' }); // he said it on his way out
          break;
        }
        (async () => {
          if (live.status === 'live') {
            const spoken = new Promise<void>((res) => (lineSpoken.current = res));
            const facts = factsOf(d!);
            if (!answer({ status: 'filed', work_order: d!.issue.id, say: text, report: facts }))
              live.prompt(`The report was filed. ${facts} Say exactly this to the resident: "${text}"`);
            await Promise.race([spoken, wait(14000)]);
            lineSpoken.current = null;
          } else {
            setSaid(text);
            await sayOnDevice(text, () => scene.current?.speaking(true));
            scene.current?.speaking(false);
          }
          if (alive) dispatch({ type: 'SPOKEN' });
        })();
        return () => {
          alive = false;
        };
      }

      case 'REPORT_COMPLETE': {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const t = setTimeout(() => dispatch({ type: 'CONVERSE' }), 1400);
        return () => clearTimeout(t);
      }

      case 'LIVE_CONVERSATION':
        setLine(null);
        break;

      case 'CHARACTER_RETURNING': {
        audio.interrupt();
        hush();
        setLine(null);
        setSaid('');
        (async () => {
          await scene.current?.exitLeft();
          scene.current?.clear();
          brackets.setValue(0);
          await backToWindow();
          if (!alive) return;
          dispatch({ type: 'RETURNED' });
          visual.current = '';
          live.prompt('The resident is starting a new report and you are back in your window. Ask them, in a few words, what else needs fixing.');
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
        dispatch({ type: 'SHUTTER', snapshot: { sessionId: newSessionId(), photo, lat: where.lat, lng: where.lng, capturedAt: Date.now(), context: '' } });
      },
      next: () => dispatch({ type: 'NEW_REPORT' }),
      demo: (photo: Media) => runDemoRef.current(photo),
      state: () => stateRef.current,
      stages: () => ({ portrait: portrait.current, scene: scene.current }),
    };
  }, [where.lat, where.lng]);

  // ── layout ──
  const snap = f.snapshot;
  const d = f.decision;
  const box = d && snap ? boxOnScreen(d, snap.photo, W, viewH) : state === 'CAPTURING' ? { x: W * 0.16, y: viewH * 0.22, w: W * 0.68, h: viewH * 0.5 } : null;
  const filed = state === 'REPORT_COMPLETE' || state === 'LIVE_CONVERSATION';
  const camAllowed = !!camPerm?.granted;
  const liveDown = liveStatus === 'unavailable' || micOk === false;

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
            pictureSize={pictureSize}
            onCameraReady={async () => {
              camReady.current = true;
              if (pictureSize) return;
              const sizes = await cam.current?.getAvailablePictureSizesAsync().catch(() => [] as string[]);
              const pick = ['1920x1080', 'High', '1280x720', 'Medium'].find((x) => sizes?.includes(x));
              if (pick) setPictureSize(pick);
            }}
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

        {(state === 'REPORT_PROCESSING' || state === 'CHARACTER_EXITING' || state === 'CAPTURED' || state === 'REPORT_CLARIFYING') && <Shimmer progress={shimmer} width={W} />}
        {box && <Brackets box={box} progress={brackets} width={W} height={viewH} />}

        <GLHost create={(s) => new MayorStage(s)} onReady={(s) => (scene.current = s)} />
        {/* demo: tapping the camera is the backup trigger if the voice one misses */}
        {DEMO && state === 'LIVE_IDLE' && <Pressable style={StyleSheet.absoluteFill} onPress={() => void runDemo()} accessibilityLabel="Fix this" />}

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }) }]}
        />

        {/* once it's filed, tapping the photo brings him back for the next report */}
        {filed && (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => dispatch({ type: 'NEW_REPORT' })} accessibilityRole="button" accessibilityLabel="New report" />
        )}

        {/* no text over the camera: his voice says it. Only the answers to "which one?" to tap */}
        {state === 'REPORT_CLARIFYING' && !!f.clarify?.options.length && (
          <View style={styles.lineWrap} pointerEvents="box-none">
            <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']} style={StyleSheet.absoluteFill} />
            <View style={styles.options}>
              {f.clarify.options.map((o) => (
                <Pressable key={o} style={styles.option} onPress={() => dispatch({ type: 'ANSWERED', answer: o })} accessibilityRole="button">
                  <Text style={styles.optionText}>{o}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {(state === 'LIVE_IDLE' || state === 'CAPTURING') && (
          <View style={[styles.where, { top: insets.top + 10 }]} accessibilityLiveRegion="polite">
            <PinIcon size={13} />
            <Text style={styles.whereText} numberOfLines={1}>
              {where.denied ? 'Location off' : where.approximate ? 'Finding you…' : (where.label ?? 'Located')}
            </Text>
          </View>
        )}
      </Animated.View>

      {/* ── the control surface ── */}
      <View style={[styles.controls, { paddingBottom: Math.max(CONTROLS_PAD, insets.bottom) }]}>
        <View style={styles.row}>
          <View style={styles.side}>
            {filed && d ? (
              <Pressable onPress={() => setSheet(true)} accessibilityRole="button" accessibilityLabel={`Reported. ${d.issue.title}. Open the report.`}>
                <Confirmation decision={d} />
              </Pressable>
            ) : (
              micOk !== false && (
                <Pressable
                  style={[styles.round, muted && styles.roundOn]}
                  onPress={() => setMuted((m) => !m)}
                  accessibilityRole="button"
                  accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                >
                  <MicGlyph off={muted} />
                </Pressable>
              )
            )}
          </View>

          <View style={styles.center}>
            <PortraitWindow
              sx={win.sx}
              sy={win.sy}
              hidden={mode === 'SCENE'}
              listening={micOpen(state) && hearing && !speaking && !muted}
              live={liveStatus === 'live'}
              onStage={(s) => {
                portrait.current = s;
                s?.show('suit');
              }}
            />
          </View>

          <View style={[styles.side, { alignItems: 'flex-end' }]}>
            {!DEMO && liveDown && state === 'LIVE_IDLE' ? (
              <Pressable style={styles.newReport} onPress={manualCapture} accessibilityRole="button" accessibilityLabel="Take the photo">
                <CameraGlyph />
              </Pressable>
            ) : (
              <Pressable style={styles.thumb} onPress={() => setMineOpen(true)} accessibilityRole="button" accessibilityLabel="Your reports">
                {lastPhoto ? <Image source={{ uri: lastPhoto }} style={StyleSheet.absoluteFill} /> : <ListGlyph />}
              </Pressable>
            )}
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
  return { x, y: Math.max(0.45, Math.min(0.84, (b.y + b.h * 0.85) / h)) };
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
        {category(i.type).label}
      </Text>
      <Text style={styles.confMeta} numberOfLines={1}>
        {severityWord(i.severity)}, #{i.id}
      </Text>
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

/** Focus brackets close in on the problem (or the frame, while he says "hold steady"). */
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

function MicGlyph({ off }: { off: boolean }) {
  const c = off ? C.asphalt : '#fff';
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round">
      <Rect x={9} y={3} width={6} height={11} rx={3} />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      {off && <Line x1={4} y1={4} x2={20} y2={20} />}
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
  controls: { flex: 1, justifyContent: 'flex-start', paddingTop: CONTROLS_PAD },
  lineWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 40, paddingBottom: 18, paddingHorizontal: 24, alignItems: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  option: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  optionText: { fontFamily: F.uiBold, fontSize: T.sm, color: '#fff', paddingTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  side: { flex: 1, justifyContent: 'center' },
  center: { width: WINDOW + 8, alignItems: 'center', justifyContent: 'center' },
  window: { width: WINDOW, height: WINDOW, borderRadius: WINDOW / 2, padding: 3, backgroundColor: 'rgba(255,255,255,0.14)' },
  windowListening: { backgroundColor: ACCENT },
  windowInner: { flex: 1, borderRadius: WINDOW / 2, overflow: 'hidden' },
  liveDot: { position: 'absolute', right: 15, top: 15, width: 12, height: 12, borderRadius: 6, backgroundColor: ACCENT, borderWidth: 2, borderColor: '#000' },
  round: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  roundOn: { backgroundColor: '#fff' },
  newReport: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
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
