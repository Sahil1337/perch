# Hunt & peck (`src/page/landing/keys/`)

The landing's first view on desktop (`lg`, 64rem, and up). A sculpture of giant porcelain keycaps
on the dark page. The porcelain bird types a real query on them, one hop per key, and the editor's
completion does the rest.

## Composition
Everything stays inside the page container (`max-w-316`), left-aligned with the copy:

- **Top left, the copy** (the shell's `LandingCopy`, placed by `placement.ts`): the H1 at the page's
  `display` size, the lede, and the CTA row, 60rem wide, so the install command reads in full from
  1024 up.
- **Under it, left, the keys.** They take the height left under the CTA row (less some room for the
  bird's head) and the width the query's column leaves. A short screen gets a smaller sculpture,
  never one under the CTA.
- **Beside the keys, the query's column:** the query in `text-2xl` mono, the scene's caption, and
  under it the rows it returns, as many paper slips as fit (four to eight), with the caption
  `33 rows · 2,168 birds`. The column stands right beside the sculpture, so the rows always land
  next to return.
- The keys and the column share a top edge, and the pair is centred in the room under the copy.

`layout.ts` computes these boxes from the section's size, the container's content box, the copy's
bottom and the sculpture's aspect; `sculpture/use-sculpture.ts` measures, lays out and redraws
on resize.

## Storyboard

### First 8 s (1440×900, production build)
- **0 s, first paint.** Nav, the copy, the query's first line and a blinking caret, and nine
  porcelain keycaps in three staggered rows, seen from above and a little to the right: `J O I N`
  at the back, `tab S P` in the middle, a long space bar in front, and the giant `return` standing
  at the end of the back two rows. Matte and faceted, legends in a thin warm glaze, one warm key
  light from the upper left, soft shadows. The sculpture is drawn before the first paint.
- **~0.9 s.** The bird appears on **J** (it starts on screen rather than flying in), gives a little
  hop, and J goes down: `j`.
- **0.9–2.2 s.** Quick hops along the back row, **O I N**: `join`. Then down to the space bar, a
  look along the middle row, **S** and **P**: `join sp` by 3.6 s. Each landing presses its key; the
  key the bird stands on holds a hair lower, with the bird's soft shadow on it.
- **3.7 s.** Perch's completion menu opens under the caret, in the app's own style: `▦ species`
  `table · ~51 rows` selected, `▨ species_totals` `view`. The bird glances at it.
- **~4.3 s.** It hops back onto the wide **tab** key: `species s` completes, the menu closes, and
  `on s.id = g.species_id` writes itself from the foreign key, in the info blue with a
  `◇ foreign key · sightings.species_id → species.id` note, then settles to ink.
- **~5.3–6.4 s (the crazy moment).** It looks at return, crouches, flutters, and makes one long
  jump across the sculpture onto the giant **return** key. The stomp drives return to the bottom, a
  ripple runs out through the other keys, and all 33 result rows burst out of return as paper
  slips. The kept ones fly to the stack under the query; the rest are thrown high, rock, and drift
  down behind the keys, fading.
- **7.7 s.** Settled; the caption has faded in. (The bird's chunk arriving earlier or later shifts
  everything by the same amount.)

### Idle loop
The bird stands on return, breathing; now and then it preens and turns its head toward the pointer.
Every 8–14 s it hops to a neighbouring key, which dips under its weight; nothing types. The
sculpture draws only while a key moves. Once settled, the visitor's own presses of J O I N S P,
tab, space or return send the bird to that key, and the key goes down. Nothing reacts while a text
field, a link or a button has focus, and default actions are never prevented.

### Scroll hand-over
As the landing scrolls away the keys tip and sink into their shadows, row by row, and fade. The
query and the rows hold still on screen, then glide down into the real window under "Your turn.":
the query onto the editor's own second line, shrinking to its size, the rows toward the results
pane, fading before they would leave the view. The bird leaves the keys for the window's top edge,
and the page's roaming route takes it from there. Scrolling back to the top brings it home. A jump
past the landing (an anchor under reduced motion, a reload part-way down) cuts the intro where it
is: the slips settle on the stack, and the route takes the bird to the section in view.

### Reduced motion
The settled frame: the whole query, the stack and the caption, the bird on return. No flight, no
burst, no page scroll.

### Remounts
Crossing the breakpoint unmounts the scene, which frees its WebGL context. A scene mounted more than
6 s after the page opened skips the intro and shows the settled frame.

## Files
```
keys/
  scene.tsx          the scene, composed from the hooks below
  placement.ts       where the copy goes (the only module in the page's main bundle)
  layout.ts          the scene's boxes for one size
  rig.ts             the refs the hooks share, and the stage the script plays on
  keymap.ts          the nine keys, their legends, the visitor's keys
  data.ts            the recorded rows and the query's text
  keys.css           the scene light and keyframes, imported by page.css
  sculpture/         the three.js sculpture
    use-sculpture.ts   lays the scene out and draws the sculpture, on mount and resize
    sculpture.ts       renderer, camera and draw loop; press, ripple, perch, fold
    build-sculpture.ts the scene: lights, floor, keycaps, contact and perch shadows
    key-motion.ts      each key's spring, and the hand-over's fold
    view.ts            the fixed view and the camera fit; the sculpture's aspect
    keycap.ts          the faceted keycap geometry
    textures.ts        legends and the soft contact shadow
    colors.ts          the materials and the scene light, resolved for three.js
  story/             what plays, and when
    script.ts          the intro and the hop
    run.ts             a cancellable run of the script
    use-story.ts       the intro once, the settled scene, the bird kept home
    use-idle.ts        the idle hops and the visitor's keys
    use-live.ts        on screen with the tab showing, or not
    use-hand-over.ts   the scroll hand-over to the try window
  overlay/           the DOM layers over and under the canvas
    query.tsx          the query and its completion menu
    slips.tsx          the rows, on the page's paper slips (materials/slip.tsx)
    slip-flights.ts    their burst: the kept rows' arcs, the thrown rows' flutter
```
