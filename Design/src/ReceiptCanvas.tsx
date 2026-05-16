import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {Image as RNImage, Platform, StyleSheet, Text, View} from 'react-native';
import {Asset} from 'expo-asset';
import {FRAMES, FRAME_COUNT} from './frames';

/** Imperative API: jump the background to a scroll progress (0..1). */
export type ReceiptCanvasHandle = {seek: (progress: number) => void};

// DOM globals, untyped — this component is web-only by design.
const G = globalThis as any;

/**
 * Web background renderer.
 *
 * Why a canvas instead of swapping an <Image> source: changing an
 * <img> src forces the browser to fetch + decode that JPEG, so
 * scrubbing through 151 frames stutters like a slideshow. Here every
 * frame is decoded ONCE up front, then `seek()` paints the chosen
 * frame to a single <canvas> synchronously — no per-frame decode.
 */
function ReceiptCanvasWeb(
  _props: {},
  ref: React.Ref<ReceiptCanvasHandle>,
) {
  const canvasRef = useRef<any>(null);
  const imagesRef = useRef<any[]>([]);
  const lastIndexRef = useRef<number>(-1);
  const readyRef = useRef(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [ready, setReady] = useState(false);

  // Paint one frame, scaled to cover the canvas (centre-cropped).
  const drawFrame = (index: number) => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[index];
    if (!canvas || !img) {
      return;
    }
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;
    if (!ctx || cw === 0 || ch === 0) {
      return;
    }
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    lastIndexRef.current = index;
  };

  // Match the canvas bitmap to its on-screen size, then repaint.
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = G.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    drawFrame(lastIndexRef.current < 0 ? 0 : lastIndexRef.current);
  };

  useImperativeHandle(
    ref,
    () => ({
      seek: (progress: number) => {
        if (!readyRef.current) {
          return;
        }
        const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
        const index = Math.round(p * (FRAME_COUNT - 1));
        if (index !== lastIndexRef.current) {
          drawFrame(index);
        }
      },
    }),
    [],
  );

  // Preload + decode every frame once, reporting progress as it goes.
  useEffect(() => {
    let cancelled = false;
    // expo-asset resolves a required image module to a served URL —
    // works on web where RNW has no `resolveAssetSource`.
    const urls = FRAMES.map(f => Asset.fromModule(f).uri);
    const imgs: any[] = new Array(FRAME_COUNT);
    let done = 0;

    const loadOne = (url: string, i: number) => {
      const img = new G.Image();
      img.decoding = 'async';
      img.src = url;
      const finish = () => {
        imgs[i] = img;
        done += 1;
        if (!cancelled) {
          setLoadProgress(done / FRAME_COUNT);
        }
      };
      const decoded = img.decode ? img.decode() : Promise.resolve();
      return decoded.then(finish, finish);
    };

    Promise.all(urls.map(loadOne)).then(() => {
      if (cancelled) {
        return;
      }
      imagesRef.current = imgs;
      readyRef.current = true;
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Once frames are ready: size the canvas, draw frame 0, track resizes.
  useEffect(() => {
    if (!ready) {
      return;
    }
    resizeCanvas();
    const onResize = () => resizeCanvas();
    G.addEventListener('resize', onResize);
    return () => G.removeEventListener('resize', onResize);
  }, [ready]);

  return (
    <View style={styles.container} pointerEvents="none">
      {React.createElement('canvas', {
        ref: canvasRef,
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        },
      })}
      {!ready && (
        <View style={styles.loader}>
          <Text style={styles.loaderText}>
            Loading receipt… {Math.round(loadProgress * 100)}%
          </Text>
        </View>
      )}
    </View>
  );
}

/** Native fallback — static first frame; this project targets web. */
function ReceiptCanvasNative(
  _props: {},
  ref: React.Ref<ReceiptCanvasHandle>,
) {
  useImperativeHandle(ref, () => ({seek: () => {}}), []);
  return (
    <View style={styles.container} pointerEvents="none">
      <RNImage
        source={FRAMES[0]}
        style={styles.nativeImage}
        resizeMode="cover"
      />
    </View>
  );
}

const ReceiptCanvas = forwardRef<ReceiptCanvasHandle, {}>(
  Platform.OS === 'web' ? ReceiptCanvasWeb : ReceiptCanvasNative,
);

export default ReceiptCanvas;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0c0c0e',
  },
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    color: '#bdbdc6',
    fontSize: 16,
  },
  nativeImage: {
    width: '100%',
    height: '100%',
  },
});
