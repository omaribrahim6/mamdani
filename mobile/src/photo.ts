// Keep report photos separate from Gemini's low-resolution preview frames.
export const MAX_PHOTO_BASE64 = 4 * Math.ceil((4 * 1024 * 1024) / 3);
export type CaptureResult = { data: string; thumbnail: string };
export class CaptureCancelled extends Error {}

export function resizeForPhoto(width: number, height: number): { width: number } | { height: number } {
  return width >= height ? { width: Math.min(width, 1600) } : { height: Math.min(height, 1600) };
}

// Serializes access to the camera even when React swaps preview/capture effects.
export class CameraQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => {});
    return result;
  }
}

export async function captureReportPhoto(
  alive: () => boolean,
  capture: () => Promise<CaptureResult>,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<CaptureResult> {
  await wait(1000);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!alive()) throw new CaptureCancelled();
    try {
      const result = await capture();
      if (!alive()) throw new CaptureCancelled();
      if (!result.data || result.data.length > MAX_PHOTO_BASE64) throw new Error('Photo is too large');
      return result;
    } catch (error) {
      if (error instanceof CaptureCancelled || !alive()) throw new CaptureCancelled();
      if (attempt === 1) throw error;
      await wait(500);
    }
  }
  throw new Error('Photo capture failed');
}
