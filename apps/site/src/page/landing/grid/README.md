# Grid bird

The landing's first view below `lg` (phones, tablets, landscape phones; `keys/` takes over from
64rem). A dim, full-bleed result grid of real `sightings` rows (joined to their species, site and
observer, as a query would return them), set in Geist Mono with hairline cell borders, sits on a fixed
layer under the copy. A bird is drawn out of that grid, flies through it, and lands on the headline,
where it turns into the porcelain 3D bird at the same pixels.

The copy (H1, lede, install command, download button) belongs to the landing shell and paints in the
first frame; `placement.ts` only says where it goes: centred in the height under the nav, so the
two bands the bird flies in, under the actions and over the headline, share every phone's height.

## The copy is never lit

Nothing in the grid brightens under the copy. `copy-zone.ts` measures it from the DOM (on mount,
resize, reflow and late fonts) and lays two masks onto the visible cells each frame, a quarter row at
a time:

- **Ink**: each headline word from its tallest letter to its lowest descender, each lede line, each
  control. Nothing lights here, the bird included.
- **The copy block**, padded: glints, ripples, scattered values, the wake, the pointer's light and
  the ghost keep out. Only the landing bird reaches in, as far as the top of the letter it stands on:
  that is the porcelain bird's perch.

The flights never cross the copy either: they keep to the bands above and below it
(`flight-room.ts`), and the masks catch any edge. A soft veil, cut from the copy's lines, dims the
resting rows behind the words.

## Storyboard (390×844, as built)

- **0 s:** nav, H1, lede and the two actions paint at once. The grid fades in over 0.5 s once Geist
  Mono is ready (about 0.3 s), at about 17% ink, its rows already drifting up one every 3.4 s, like a
  result set still arriving. A header row (`id  species  count  behaviour  seen_at …`) sits under the
  nav; on a phone `id`, `species` and `count` are in view and the rest clips at the edge.
- **0.3–2.7 s, the low pass:** a bird of cells crosses under the actions, left to right, as large as
  that band allows (up to 62% of a phone's width per bird unit, a third of a tablet's). Cells under
  its silhouette go semibold and bright on a faint porcelain fill at quarter-row precision. It flaps
  and glides in bursts; behind it a few of the values it crossed jump a few px its way, scramble
  briefly and fall back into their cells. It leaves by the right edge.
- **3.2–4.9 s, the approach:** it comes back round from the right in the room over the headline,
  smaller, as big as that room allows and never under 1.4× the porcelain bird. It glides down onto
  the last word of the headline's first line (the l of "place"; "SQL." when the headline is one
  line, landscape), flaring with its wings up, tail fanned and legs reaching.
- **4.9–5.7 s, the hatch:** standing there, it condenses with its feet fixed onto the porcelain
  bird's footprint, brightening, and the cells it leaves are drawn in toward its body.
- **5.7–7.3 s:** the porcelain bird `appear`s on the same anchor, facing left. A flash of cells a
  little wider than it fades around it, a ring of light spreads through the values from its feet,
  and it shakes the grid off with a `flutter`. Then the grid settles, and the window below may mount
  (`onSettled`; scrolling or 9 s does the same).

### The idle loop

- The rows drift; now and then a count or a minute changes in place with a brief glint.
- **Pointer:** with a mouse, cells within about 110 px (150 px on a tablet) light softly. A tap or
  click on the grid sends a small ring out from that point, and the bird looks at it.
- **Ghost:** 7–12 s after the intro, then every 14–22 s, a faint bird of cells crosses in the band
  above or below the copy, at about a third of the brightness, and the porcelain bird follows it with
  its head.

### The scroll hand-over (`hand-over.ts`)

- Scroll is never captured. The headline scrolls off the fixed grid, and "Your turn." passes over it.
- As the window comes up, the grid's table shrinks, at one scale and clipped to height, onto the real
  window's results pane; a hairline frame makes the shrinking table read as a pane, and its header row
  lands on the pane's header. Its rows slow to a stop on the way in.
- Until the demo has run its query, the grid stands in for the pane's rows: it docks on the pane's own
  surface, so the pane is never seen empty, and holds there; once the query has returned it fades and
  the real rows show. On a phone the window's camera takes the pane out of view to frame the editor
  while the query is typed; the grid fades with it, and the pane comes back with its rows.
- The loop stops once the grid is gone and starts again when you scroll back.
- The porcelain bird is guided between two perches: the headline, then the window's top edge. The
  page's route takes it from there (`bird` goes null) and gives it back when you scroll up.

### Reduced motion

The settled frame only: a still grid, no drift, ticks, flight or ghost. The porcelain bird is placed
on the headline with `appear`, and the hand-over is a plain fade as the page scrolls.

## Files

```
grid/
  scene.tsx            the component: a fixed layer and its canvas
  use-grid-scene.ts    runs the scene for the component's lifetime: fonts, events, observers, cleanup
  grid-scene.ts        composes the rest on one 2D canvas; the loop and the draw order
  timeline.ts          intro, wait for the porcelain bird, hatch, settled loop, ghosts
  hand-over.ts         the scroll hand-over into the results pane, held until the demo has run
  dock.ts              the hand-over's state as the scene draws it: outline and pane surface
  placement.ts         the copy's classes (the folder's only eager module)
  grid.css             the canvas's inks
  table/               grid-data (the fixture, joined), live-table (glyph ids, ticking values),
                       grid-layout, glyph-atlas, resting-grid (rows in a ring of slots, the header)
  bird/                frames (poses baked to coverage fields), cell-bird (a pose sampled into the
                       cells), intro-flight, ghost-flight, flight-room (the bands beside the copy),
                       spline, porcelain-bird (the page's bird while the landing holds it)
  effects/             cell-light (light gathered per cell, painted once), glints, pointer-light,
                       ripple, wake, scatter
  copy/                headline (its lines, ink and perch), copy-zone (the masks and the veil)
```

Subfolders never import the files at the top; the top composes them. Shared maths is the landing's
(`../math.ts`). A frame allocates nothing: every per-cell buffer is a typed array sized on resize.
