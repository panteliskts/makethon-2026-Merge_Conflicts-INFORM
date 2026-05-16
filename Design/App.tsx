/**
 * ReceiptScrollWeb — a scroll-scrubbed receipt animation for desktop web.
 *
 * The background is a 151-frame sequence of a paper receipt swirling
 * right-to-left. Scroll position maps directly onto the frame index, so
 * scrolling down plays the swirl forward and scrolling up reverses it.
 * Frames are pre-decoded and painted to a <canvas> (see ReceiptCanvas)
 * so scrubbing stays smooth. Marketing text blocks fade and slide in
 * beside the receipt as they reach the centre of the viewport.
 *
 * @format
 */

import React, {useCallback, useMemo, useRef} from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import ReceiptCanvas, {ReceiptCanvasHandle} from './src/ReceiptCanvas';
import TextBlock from './src/TextBlock';

// Total scroll canvas height, in viewport-heights. More pages = more
// scroll distance, so both the receipt scrub and the text feel slower.
const SCROLL_PAGES = 8;

// Approximate half-height of a text card — used to vertically centre it.
const CARD_HALF_H = 70;

// Marketing copy shown beside the swirling receipt. Edit freely —
// `at` is the fraction of the scroll (0..1) where the block is centred.
const BLOCKS: {
  headline: string;
  subtext: string;
  side: 'left' | 'right';
  at: number;
}[] = [
  {
    headline: 'Snap the receipt.',
    subtext: 'A single photo is all it takes — no typing, no sorting.',
    side: 'left',
    at: 0.15,
  },
  {
    headline: 'We read every line.',
    subtext: 'Merchant, date, tax and totals — extracted in seconds.',
    side: 'right',
    at: 0.38,
  },
  {
    headline: 'Expenses, organised.',
    subtext: 'Every purchase lands in the right category automatically.',
    side: 'left',
    at: 0.62,
  },
  {
    headline: 'Ready when you are.',
    subtext: 'Export a clean report whenever tax season calls.',
    side: 'right',
    at: 0.85,
  },
];

function App() {
  const {width: screenW, height: screenH} = useWindowDimensions();
  const contentH = screenH * SCROLL_PAGES;
  const scrollable = Math.max(contentH - screenH, 1); // px of travel

  // Drives the text-block fade/slide animations.
  const scrollY = useRef(new Animated.Value(0)).current;
  // Imperative handle to the canvas background.
  const canvasRef = useRef<ReceiptCanvasHandle>(null);

  // Map scroll offset onto the receipt animation. The canvas paints
  // synchronously, so this stays cheap even at every scroll tick.
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      canvasRef.current?.seek(y / scrollable);
    },
    [scrollable],
  );

  const onScroll = useMemo(
    () =>
      Animated.event([{nativeEvent: {contentOffset: {y: scrollY}}}], {
        // react-native-web has no native animation driver — keep it on JS.
        useNativeDriver: false,
        listener: handleScroll,
      }),
    [scrollY, handleScroll],
  );

  // Each text block animates over `range` px of scroll on each side of
  // its centre, and slides in `travelX` px from its edge of the screen.
  const range = screenH * 0.8;
  const travelX = screenW * 0.45;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Fixed background — the scroll-scrubbed receipt animation. */}
      <ReceiptCanvas ref={canvasRef} />
      <View style={styles.scrim} pointerEvents="none" />

      {/* Tall, transparent scroll surface layered over the background. */}
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={{height: contentH}}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}>
        <View style={[styles.intro, {height: screenH}]}>
          <Text style={styles.title}>Receipts, in motion.</Text>
          <Text style={styles.hint}>Scroll to follow the receipt ↓</Text>
        </View>

        {BLOCKS.map((b, i) => {
          const centerOffset = b.at * scrollable;
          return (
            <TextBlock
              key={i}
              headline={b.headline}
              subtext={b.subtext}
              side={b.side}
              scrollY={scrollY}
              centerOffset={centerOffset}
              range={range}
              travelX={travelX}
              // Sit mid-screen when the scroll reaches this block's offset.
              top={centerOffset + screenH / 2 - CARD_HALF_H}
            />
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

export default App;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0c0c0e',
  },
  // Subtle darkening so white text stays readable over the receipt.
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  intro: {
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: 64,
  },
  title: {
    color: '#ffffff',
    fontSize: 38,
    fontWeight: '900',
    marginBottom: 12,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: {width: 0, height: 2},
    textShadowRadius: 8,
  },
  hint: {
    color: '#bdbdc6',
    fontSize: 15,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 6,
  },
});
