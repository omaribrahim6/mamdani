import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { MayorOutfit } from '../../components/mayor/build';
import { MayorStage, type PerformOpts } from '../../components/mayor/stage';

export interface MayorHandle {
  perform(outfit: MayorOutfit, o: PerformOpts): Promise<void>;
  speaking(on: boolean): void;
  clear(): void;
  headScreen(): { x: number; y: number } | null;
}

/**
 * The same three.js stage as the web app, drawn through expo-gl. The GL view is transparent,
 * so he stands on top of the resident's photo.
 */
export const MayorView = forwardRef<MayorHandle>(function MayorView(_, ref) {
  const stage = useRef<MayorStage | null>(null);
  const size = useRef({ w: 1, h: 1 });
  const waiting = useRef<Array<() => void>>([]);

  const ready = () =>
    stage.current ? Promise.resolve(stage.current) : new Promise<MayorStage>((res) => waiting.current.push(() => res(stage.current!)));

  useEffect(
    () => () => {
      stage.current?.dispose();
      stage.current = null;
    },
    [],
  );

  useImperativeHandle(ref, () => ({
    perform: async (outfit, o) => (await ready()).perform(outfit, o),
    speaking: (on) => stage.current?.speaking(on),
    clear: () => stage.current?.clear(),
    headScreen: () => stage.current?.headScreen() ?? null,
  }));

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

    stage.current = new MayorStage({
      canvas,
      context: gl as unknown as WebGL2RenderingContext,
      // expo-gl's buffer is in device pixels; three must match it exactly or it draws into a corner
      pixelRatio: size.current.w > 1 ? gl.drawingBufferWidth / size.current.w : PixelRatio.get(),
      size: () => size.current,
      present: () => gl.endFrameEXP(),
    });
    waiting.current.splice(0).forEach((f) => f());
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { w: width, h: height };
    stage.current?.resize();
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} msaaSamples={4} />
    </View>
  );
});
