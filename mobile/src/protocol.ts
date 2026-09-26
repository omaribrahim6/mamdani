export type ServerEvent =
  | { type: 'capture_photo' | 'ready' | 'interrupted' | 'turn_complete' | 'submitting' | 'success' }
  | { type: 'audio'; data: string; sampleRate: number }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string }
  | { type: 'error'; message: string; unknown: boolean };

export type Phase = 'connecting' | 'live' | 'capturing' | 'submitting' | 'success' | 'error' | 'closed';
export function disconnectedMessage(phase: Phase): string {
  return phase === 'submitting'
    ? 'Submission status unknown. Your report may have been saved. It has not been resubmitted.'
    : 'The connection stopped. Please start a new report.';
}
export function websocketURL(base: string): string {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS backend URL.');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/live`;
  url.search = ''; url.hash = '';
  return url.toString();
}
