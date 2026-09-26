import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { CameraQueue, CaptureCancelled, captureReportPhoto, resizeForPhoto, type CaptureResult } from './photo';

export function CameraFeed({ active, capturing, frame, photo, error }: {
  active: boolean; capturing: boolean; frame: (data: string) => void;
  photo: (result: CaptureResult) => void; error: () => void;
}) {
  const camera = useRef<CameraView>(null);
  const queue = useRef(new CameraQueue());
  const busy = useRef(false);
  const [ready, setReady] = useState(false);

  async function snapshot(report: boolean, alive: () => boolean): Promise<CaptureResult> {
    const files: string[] = [];
    try {
      if (!alive() || !camera.current) throw new CaptureCancelled();
      const picture = await camera.current.takePictureAsync({ quality: report ? 1 : 0.5, shutterSound: false });
      if (!picture) throw new Error('No image');
      files.push(picture.uri);
      if (!alive()) throw new CaptureCancelled();
      const resized = await manipulateAsync(picture.uri, [
        { resize: report ? resizeForPhoto(picture.width, picture.height) : { width: 512 } },
      ], { compress: report ? 0.85 : 0.6, format: SaveFormat.JPEG, base64: true });
      files.push(resized.uri);
      if (!alive()) throw new CaptureCancelled();
      if (!resized.base64) throw new Error('No photo data');
      let thumbnail = '';
      if (report) {
        const small = await manipulateAsync(resized.uri, [{ resize: { width: 160 } }], {
          compress: 0.6, format: SaveFormat.JPEG, base64: true,
        });
        files.push(small.uri);
        thumbnail = `data:image/jpeg;base64,${small.base64}`;
      }
      return { data: resized.base64, thumbnail };
    } finally {
      for (const uri of files) { try { new File(uri).delete(); } catch {} }
    }
  }

  useEffect(() => {
    if (!active || capturing || !ready) return;
    let alive = true;
    async function capture() {
      if (busy.current) return;
      busy.current = true;
      try {
        const result = await queue.current.run(() => snapshot(false, () => alive));
        if (alive) frame(result.data);
      } catch { if (alive) error(); }
      finally { busy.current = false; }
    }
    void capture();
    const timer = setInterval(() => { void capture(); }, 1100);
    return () => { alive = false; clearInterval(timer); };
    // snapshot uses the stable camera ref; the callbacks are stable in App.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, capturing, ready, frame, error]);

  useEffect(() => {
    if (!capturing || !ready) return;
    let alive = true;
    void captureReportPhoto(() => alive,
      () => queue.current.run(() => snapshot(true, () => alive)))
      .then(result => { if (alive) photo(result); })
      .catch(failure => { if (alive && !(failure instanceof CaptureCancelled)) error(); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, ready, photo, error]);

  return <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" animateShutter={false}
    onCameraReady={() => setReady(true)} onMountError={error} />;
}
