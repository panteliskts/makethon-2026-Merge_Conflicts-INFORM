# ReceiptScrollWeb

A scroll-scrubbed receipt animation for **desktop web**, built with Expo
+ react-native-web.

The background is a 151-frame sequence of a paper receipt swirling
right-to-left. Scroll position maps directly onto the frame index, so
scrolling **down** plays the swirl forward and scrolling **up** reverses
it. Marketing text blocks fade and slide in beside the receipt as they
reach the centre of the viewport.

## Run it

```sh
npm install        # already done by the scaffold
npm run web        # opens the app in your browser
```

To produce a deployable static site:

```sh
npx expo export --platform web   # output in dist/
```

## How it works

| File | Responsibility |
|------|----------------|
| `App.tsx` | Tall transparent `ScrollView`; maps scroll offset → frame + drives text |
| `src/ReceiptCanvas.tsx` | Background renderer — preloads every frame, paints to a `<canvas>` |
| `src/TextBlock.tsx` | One headline/subtext card; fade + slide driven by scroll |
| `src/frames.ts` | Auto-generated static `require()` list of the 151 frames |
| `assets/frames/` | `frame_001.jpg` … `frame_151.jpg` (1280×720, ~5.6 MB total) |

**Why a canvas.** Swapping an `<Image>` source per frame forces the
browser to fetch + decode each JPEG, which scrubs like a 3 fps
slideshow. `ReceiptCanvas` instead decodes **all 151 frames once** up
front (a short "Loading receipt…" screen shows progress), then `seek()`
paints the chosen frame to a single `<canvas>` synchronously — no
per-frame decode, so scrubbing tracks the scroll smoothly.

**Scroll math.** The content is `SCROLL_PAGES` (8) viewports tall.
Progress is `scrollY / scrollableDistance`, clamped 0–1, rounded to a
frame. Text blocks animate over `range` px of scroll and hold still in
the middle of that range so they stay readable.

## Customising

- **Text copy** — edit the `BLOCKS` array in `App.tsx` (`headline`,
  `subtext`, `side`, and `at` = scroll fraction 0–1 where it centres).
- **Pacing** — `SCROLL_PAGES` in `App.tsx` (more = slower scrub); `range`
  and `travelX` control how slowly / how far text slides.
- **Replacing the frames** — drop a new `frame_NNN.jpg` sequence into
  `assets/frames/`, then regenerate `src/frames.ts` (its header explains
  the format; the bundler requires static literal paths).

## Notes

- **Memory:** 151 decoded 1280×720 frames hold ~550 MB in the browser.
  Fine for a desktop demo; if it's heavy, downscale the frames.
- Targets desktop web. It also boots natively (`npm run android` /
  `npm run ios`) but there `ReceiptCanvas` only shows a static frame —
  the canvas scrubbing is web-only.
