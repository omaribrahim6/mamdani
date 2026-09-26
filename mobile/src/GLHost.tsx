import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useEffect, useRef } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { StageSurface } from '../../components/mayor/engine';

/**
 * Hosts one of the shared three.js stages (the photo scene or the portrait window) in an expo-gl
 * view. The GL view is transparent, so whatever is behind it shows through.
 */
export function GLHost<T extends { resize(): void; dispose(): void }>({
  create,
  onReady,
  style,
}: {
  create: (surface: StageSurface) => T;
  onReady: (stage: T | null) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const stage = useRef<T | null>(null);
  const size = useRef({ w: 1, h: 1 });

  useEffect(
    () => () => {
      stage.current?.dispose();
      stage.current = null;
      onReady(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onContextCreate = (gl: ExpoWebGLRenderingContext) => {
    // three.js asks the context a few questions expo-gl answers differently
    const attrs = gl.getContextAttributes?.bind(gl);
    (gl as unknown as { getContextAttributes: () => WebGLContextAttributes }).getContextAttributes = () =>
      attrs?.() ?? { alpha: true, antialias: true, depth: true, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false };
    const pixelStorei = gl.pixelStorei.bind(gl);
    gl.pixelStorei = (p: number, v: number | boolean) => {
      if (p === gl.UNPACK_FLIP_Y_WEBGL || p === gl.UNPACK_ALIGNMENT || p === gl.PACK_ALIGNMENT) pixelStorei(p, v as number);
    };
    const canvas = {
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      clientWidth: size.current.w,
      clientHeight: size.current.h,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      getContext: () => gl,
    } as unknown as HTMLCanvasElement;

    stage.current = create({
      canvas,
      context: gl as unknown as WebGL2RenderingContext,
      // expo-gl's buffer is in device pixels; three must match it exactly or it draws into a corner
      pixelRatio: size.current.w > 1 ? gl.drawingBufferWidth / size.current.w : PixelRatio.get(),
      size: () => size.current,
      present: () => gl.endFrameEXP(),
    });
    onReady(stage.current);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { w: width, h: height };
    stage.current?.resize();
  };

  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none" onLayout={onLayout}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} msaaSamples={4} />
    </View>
  );
}
