import { GoogleGenAI } from '@google/genai';
import { accessToken, project, serviceAccount } from './google';

// Gemini Live is Mamdani's eyes, ears and conversation on the phone.
// On Vertex AI (service account): the phone gets a short-lived OAuth token for the Live socket.
// On the Gemini API (API key): a single-use ephemeral token locked to this model and persona.
// Either way no long-lived key reaches the app.

const CITY = process.env.NEXT_PUBLIC_CITY || 'Ottawa';

export const LIVE_MODEL = () => process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
const API_VERSION = () => process.env.GEMINI_LIVE_API_VERSION || 'v1alpha';

export const LIVE_PERSONA = `You are Mamdani, a tiny cartoon city inspector who lives in the corner of a ${CITY} resident's camera app.
You can see what their camera sees and hear what they say.

How you talk:
- Short. One or two sentences, like a friendly city worker on a walkie-talkie. Never lists.
- Warm, casual, a little funny. Never mocking. No politics, no opinions on politicians or parties.
- Describe what you actually see. If you can't tell, say so.

What you can and can't do:
- You do NOT file reports by talking. The resident files a report by tapping the big white shutter button.
  If they want something reported, tell them to frame it and tap the shutter.
- Never claim you've submitted, fixed, scheduled or escalated anything unless the app tells you a report was filed.
- When the app tells you a report was filed, you know its details (work order, issue, severity, department, how many
  neighbours reported it, status). Answer questions about it from those details only. Don't re-judge it from the camera.
- If they point at a new problem after a report, tell them to tap the shutter for a new report. Don't add it to the old one.
- Don't invent timelines. You can say what happens next: the department reviews it, assigns a crew, fixes it, and the
  resident can follow it in My reports. If the app gives you the city's official service standard for a filed report,
  you may quote that target and its due time exactly as given, and name where it comes from. Never any other number.`;

/** The Live session config. The phone sends the same setup; the token locks it. */
export function liveConfig() {
  return {
    responseModalities: ['AUDIO'],
    systemInstruction: { parts: [{ text: LIVE_PERSONA }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
  };
}

const LIVE_LOCATION = () => process.env.GCP_LIVE_LOCATION || 'us-central1';

export async function mintLiveToken() {
  if (serviceAccount()) {
    const token = await accessToken();
    const loc = LIVE_LOCATION();
    return {
      token: token!,
      model: `projects/${project()}/locations/${loc}/publishers/google/models/${LIVE_MODEL()}`,
      url: `wss://${loc}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`,
      config: liveConfig(),
    };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: API_VERSION() } });
  const now = Date.now();
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60e3).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60e3).toISOString(),
      liveConnectConstraints: { model: LIVE_MODEL(), config: liveConfig() as never },
      httpOptions: { apiVersion: API_VERSION() },
    },
  });
  const version = API_VERSION();
  return {
    token: token.name!,
    model: `models/${LIVE_MODEL()}`,
    url: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContentConstrained`,
    config: liveConfig(),
  };
}
