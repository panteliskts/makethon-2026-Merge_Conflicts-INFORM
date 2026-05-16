import { useEffect, useRef, useState } from "react";
import {
  FRAME_COUNT,
  FrameView,
  SeqId,
  framePath,
  coverRect,
} from "./cinematic";

type FrameStore = Record<SeqId, HTMLImageElement[]>;

function loadSeq(
  seq: SeqId,
  onOne: () => void,
): Promise<HTMLImageElement[]> {
  const imgs: HTMLImageElement[] = new Array(FRAME_COUNT);
  const tasks = Array.from({ length: FRAME_COUNT }, (_, i) => {
    const img = new Image();
    img.src = framePath(seq, i + 1);
    return new Promise<void>((resolve) => {
      const finish = () => {
        imgs[i] = img;
        onOne();
        resolve();
      };
      if (img.decode) img.decode().then(finish, finish);
      else {
        img.onload = finish;
        img.onerror = finish;
      }
    });
  });
  return Promise.all(tasks).then(() => imgs);
}

export function useFrameSequence() {
  const storeRef = useRef<FrameStore>({ seq1: [], seq2: [] });
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false); // seq1 fully decoded

  useEffect(() => {
    let cancelled = false;
    let done = 0;
    const total = FRAME_COUNT * 2;
    const onOne = () => {
      done++;
      if (!cancelled) setProgress(done / total);
    };

    loadSeq("seq1", onOne).then((imgs) => {
      if (cancelled) return;
      storeRef.current.seq1 = imgs;
      setReady(true);
    });
    loadSeq("seq2", onOne).then((imgs) => {
      if (!cancelled) storeRef.current.seq2 = imgs;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function draw(
    canvas: HTMLCanvasElement,
    seq: SeqId,
    index0: number,
    view?: FrameView,
  ) {
    const img = storeRef.current[seq][index0];
    if (!img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cw = canvas.width;
    const ch = canvas.height;
    if (cw === 0 || ch === 0) return;
    const { dx, dy, dw, dh } = coverRect(
      cw,
      ch,
      img.naturalWidth,
      img.naturalHeight,
      view,
    );
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  return { progress, ready, draw };
}
