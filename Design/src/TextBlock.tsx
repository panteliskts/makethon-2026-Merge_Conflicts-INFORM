import React from 'react';
import {Animated, StyleSheet, Text} from 'react-native';

type Props = {
  headline: string;
  subtext: string;
  /** Which side of the receipt the block sits / slides from. */
  side: 'left' | 'right';
  /** Shared scroll offset (in px) from the parent ScrollView. */
  scrollY: Animated.Value;
  /** Scroll offset (px) at which this block is fully centered. */
  centerOffset: number;
  /** Half-distance (px) over which the block fades + slides. */
  range: number;
  /** How far (px) the block slides in from its side. */
  travelX: number;
  /** Absolute `top` (px) of the card within the scroll content. */
  top: number;
};

/**
 * A headline + subtext card driven by the shared scroll offset.
 *
 * As the user scrolls it toward centre it fades + slides in from its
 * side, HOLDS in place for the middle of its range (so it stays
 * readable rather than flashing past), then fades + slides back out.
 */
function TextBlock({
  headline,
  subtext,
  side,
  scrollY,
  centerOffset,
  range,
  travelX,
  top,
}: Props) {
  // Four-point range: fade-in, hold start, hold end, fade-out.
  // The hold (between ±plateau) keeps the text still while readable.
  const plateau = range * 0.32;
  const inputRange = [
    centerOffset - range,
    centerOffset - plateau,
    centerOffset + plateau,
    centerOffset + range,
  ];

  const opacity = scrollY.interpolate({
    inputRange,
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });

  // Slides in from its own side and back out the same way.
  const offscreen = side === 'left' ? -travelX : travelX;
  const translateX = scrollY.interpolate({
    inputRange,
    outputRange: [offscreen, 0, 0, offscreen],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.card,
        side === 'left' ? styles.left : styles.right,
        {top, opacity, transform: [{translateX}]},
      ]}>
      <Text style={[styles.headline, side === 'right' && styles.alignRight]}>
        {headline}
      </Text>
      <Text style={[styles.subtext, side === 'right' && styles.alignRight]}>
        {subtext}
      </Text>
    </Animated.View>
  );
}

export default React.memo(TextBlock);

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: '62%',
    maxWidth: 520,
  },
  left: {
    left: 24,
    alignItems: 'flex-start',
  },
  right: {
    right: 24,
    alignItems: 'flex-end',
  },
  headline: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
    marginBottom: 10,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: {width: 0, height: 2},
    textShadowRadius: 8,
  },
  subtext: {
    color: '#d6d6dc',
    fontSize: 15,
    lineHeight: 21,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 6,
  },
  alignRight: {
    textAlign: 'right',
  },
});
