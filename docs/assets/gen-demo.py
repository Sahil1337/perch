"""Generate docs/assets/demo.svg — a looping, motion-designed reenactment of a Perch run.

Self-contained SVG with CSS keyframes and no script, because GitHub serves README images through
a proxy that strips JS but keeps declarative animation. Generated rather than hand-written so the
per-row stagger can be emitted as exact keyframe percentages instead of negative delays, which
would desynchronise the reset at the end of the loop.
"""
from pathlib import Path

# ----------------------------------------------------------------- the content
SQL = "select * from instructor where salary > 10000;"
KEYWORDS = {"select", "from", "where"}
ROWS = [
    ("10101", "Srinivasan", "Comp. Sci.", "65000.00"),
    ("12121", "Wu",         "Finance",    "90000.00"),
    ("15151", "Mozart",     "Music",      "40000.00"),
    ("22222", "Einstein",   "Physics",    "95000.00"),
    ("32343", "El Said",    "History",    "60000.00"),
    ("33456", "Gold",       "Physics",    "87000.00"),
    ("45565", "Katz",       "Comp. Sci.", "75000.00"),
    ("58583", "Califieri",  "History",    "62000.00"),
]
COLS = [("id", 64), ("name", 250), ("dept_name", 470), ("salary", 880)]

# ------------------------------------------------------------------- the clock
CYCLE = 9.0          # seconds, one full loop
T_TYPE_START = 0.35
T_TYPE_END   = 2.45
T_PRESS      = 2.65  # Run lights up
T_SKELETON   = 2.85
T_ROW_FIRST  = 3.30
T_ROW_STEP   = 0.09  # stagger between rows
T_BADGE      = 3.30 + len(ROWS) * 0.09 + 0.15
T_HOLD_END   = 8.30  # everything clears after this

pct = lambda t: round(t / CYCLE * 100, 3)

# Monospace metrics are pinned with textLength + lengthAdjust, so the typewriter clip lands on a
# character boundary whatever font the viewer actually resolves.
CH = 8.1
TEXT_W = len(SQL) * CH

# ------------------------------------------------------------------ the styles
css = [
    "text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;"
    "font-size:13px;dominant-baseline:middle}",
    ".ui{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
    ".kw{fill:#5a9cf8}.num{fill:#e0a35e}.id{fill:#fafafa}.mut{fill:#8b8b8b}",
    # typewriter: a clip that widens one character at a time
    f"#typeclip rect{{animation:type {CYCLE}s steps({len(SQL)},end) infinite}}",
    f"@keyframes type{{0%,{pct(T_TYPE_START)}%{{width:0}}"
    f"{pct(T_TYPE_END)}%,{pct(T_HOLD_END)}%{{width:{TEXT_W:.1f}px}}"
    f"{pct(T_HOLD_END + 0.15)}%,100%{{width:0}}}}",
    # the caret rides the same steps so it never drifts off the last glyph
    f".caret{{animation:caret {CYCLE}s steps({len(SQL)},end) infinite,blink 1s steps(2,end) infinite}}",
    f"@keyframes caret{{0%,{pct(T_TYPE_START)}%{{x:92px}}"
    f"{pct(T_TYPE_END)}%,{pct(T_HOLD_END)}%{{x:{92 + TEXT_W:.1f}px}}"
    f"{pct(T_HOLD_END + 0.15)}%,100%{{x:92px}}}}",
    "@keyframes blink{0%{opacity:1}50%{opacity:0}}",
    # Run button press
    f".run{{animation:run {CYCLE}s infinite}}",
    f"@keyframes run{{0%,{pct(T_PRESS - 0.08)}%{{transform:scale(1);opacity:1}}"
    f"{pct(T_PRESS)}%{{transform:scale(.94);opacity:.85}}"
    f"{pct(T_PRESS + 0.18)}%,100%{{transform:scale(1);opacity:1}}}}",
    # skeleton while the run is in flight
    f".skel{{animation:skel {CYCLE}s infinite}}",
    f"@keyframes skel{{0%,{pct(T_SKELETON - 0.01)}%{{opacity:0}}"
    f"{pct(T_SKELETON)}%,{pct(T_ROW_FIRST - 0.05)}%{{opacity:1}}"
    f"{pct(T_ROW_FIRST)}%,100%{{opacity:0}}}}",
    # the badge lands last, with a small overshoot
    f".badge{{animation:badge {CYCLE}s cubic-bezier(.2,1.6,.4,1) infinite;transform-origin:center}}",
    f"@keyframes badge{{0%,{pct(T_BADGE - 0.01)}%{{opacity:0;transform:scale(.8)}}"
    f"{pct(T_BADGE + 0.28)}%,{pct(T_HOLD_END)}%{{opacity:1;transform:scale(1)}}"
    f"{pct(T_HOLD_END + 0.15)}%,100%{{opacity:0;transform:scale(.8)}}}}",
    # header appears with the first row
    f".head{{animation:head {CYCLE}s infinite}}",
    f"@keyframes head{{0%,{pct(T_ROW_FIRST - 0.06)}%{{opacity:0}}"
    f"{pct(T_ROW_FIRST)}%,{pct(T_HOLD_END)}%{{opacity:1}}"
    f"{pct(T_HOLD_END + 0.15)}%,100%{{opacity:0}}}}",
]

# one keyframe set per row, so the cascade in is staggered but the clear is simultaneous
for i in range(len(ROWS)):
    t = T_ROW_FIRST + i * T_ROW_STEP
    css.append(f".r{i}{{animation:row{i} {CYCLE}s cubic-bezier(.22,1,.36,1) infinite}}")
    css.append(
        f"@keyframes row{i}{{0%,{pct(t)}%{{opacity:0;transform:translateY(6px)}}"
        f"{pct(t + 0.34)}%,{pct(T_HOLD_END)}%{{opacity:1;transform:translateY(0)}}"
        f"{pct(T_HOLD_END + 0.15)}%,100%{{opacity:0;transform:translateY(6px)}}}}"
    )

# ------------------------------------------------------------------- the paint
def sql_spans() -> str:
    """Words in document order, spaces carried inside the spans. No per-span x: that fights
    textLength, which is what pins the string to the width the typewriter clip steps through."""
    words = SQL.split(" ")
    out = []
    for i, word in enumerate(words):
        cls = "kw" if word in KEYWORDS else ("num" if word.rstrip(";").isdigit() else "id")
        tail = " " if i < len(words) - 1 else ""
        out.append(f'<tspan class="{cls}">{word}{tail}</tspan>')
    return "".join(out)

rows = []
for i, (a, b, c, d) in enumerate(ROWS):
    y = 300 + i * 30
    rows.append(
        f'<g class="r{i}">'
        f'{"<rect x=%s y=%s width=%s height=%s fill=%s/>" % (chr(34)+"40"+chr(34), chr(34)+str(y-15)+chr(34), chr(34)+"880"+chr(34), chr(34)+"30"+chr(34), chr(34)+"#141414"+chr(34)) if i % 2 else ""}'
        f'<text x="64" y="{y}" class="id">{a}</text>'
        f'<text x="250" y="{y}" class="id">{b}</text>'
        f'<text x="470" y="{y}" class="id">{c}</text>'
        f'<text x="880" y="{y}" class="id" text-anchor="end">{d}</text>'
        f"</g>"
    )

BIRD = ('<path d="M3 20h18"/><path d="M11.4 17L11 20M14.6 17L14.2 20"/>'
        '<path d="M20.5 8.2L18.3 7.2C17.8 5.3 15.5 4.4 14 5.6C13.2 6.2 12.4 6.5 11.6 7.2'
        'C10 8.6 9.6 10.85 7.9 12.2L3.95 15.3L5.55 17.35L9.3 14C10.3 15.6 13.8 18 16.2 15.6'
        'C17.6 14.2 18.4 12 18.3 10.5C18.2 9.6 18.4 9 18.6 8.9Z"/>'
        '<circle cx="16.4" cy="6.9" r=".65" fill="#fafafa" stroke="none"/>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 560" width="960" height="560" role="img" aria-label="Perch running a SQL query and rendering 12 rows in 5 milliseconds">
<title>Perch: type a query, run it, read the rows</title>
<style>{"".join(css)}</style>
<rect width="960" height="560" rx="14" fill="#0a0a0a"/>
<rect x="1" y="1" width="958" height="558" rx="13" fill="none" stroke="#262626"/>

<!-- topbar -->
<g transform="translate(24 22)" fill="none" stroke="#fafafa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{BIRD}</g>
<rect x="60" y="22" width="188" height="26" rx="7" fill="#161616" stroke="#2a2a2a"/>
<circle cx="74" cy="35" r="3.5" fill="#4ade80"/>
<text x="86" y="36" class="ui" fill="#fafafa" font-size="12">postgres-local</text>
<text x="176" y="36" class="ui" fill="#8b8b8b" font-size="12">postgres</text>
<g class="run">
  <rect x="836" y="21" width="100" height="28" rx="8" fill="#fafafa"/>
  <path d="M854 30l9 5-9 5z" fill="#0a0a0a"/>
  <text x="870" y="36" class="ui" fill="#0a0a0a" font-size="12" font-weight="500">Run</text>
  <text x="906" y="36" class="ui" fill="#6b6b6b" font-size="11">⌘↵</text>
</g>
<line x1="0" y1="70" x2="960" y2="70" stroke="#222"/>

<!-- editor -->
<text x="64" y="104" class="mut" text-anchor="end">1</text>
<clipPath id="typeclip"><rect x="92" y="90" width="0" height="28"/></clipPath>
<g clip-path="url(#typeclip)"><text x="92" y="104" xml:space="preserve" textLength="{TEXT_W:.1f}" lengthAdjust="spacingAndGlyphs">{sql_spans()}</text></g>
<rect class="caret" x="92" y="94" width="1.6" height="17" fill="#fafafa"/>
<line x1="0" y1="140" x2="960" y2="140" stroke="#222"/>

<!-- results -->
<g class="skel">
  {"".join(f'<rect x="{64 + i * 210}" y="180" width="{120 if i < 3 else 80}" height="9" rx="4" fill="#1e1e1e"/>' for i in range(4))}
  {"".join(f'<rect x="{64 + (j % 4) * 210}" y="{215 + (j // 4) * 30}" width="{150 if j % 4 < 3 else 70}" height="9" rx="4" fill="#161616"/>' for j in range(12))}
</g>

<g class="head">
  {"".join(f'<text x="{x}" y="255" class="id" font-weight="600"{" text-anchor=" + chr(34) + "end" + chr(34) if name == "salary" else ""}>{name}</text>' for name, x in COLS)}
  <line x1="40" y1="272" x2="920" y2="272" stroke="#262626"/>
</g>
{"".join(rows)}

<g class="badge">
  <rect x="40" y="520" width="118" height="24" rx="7" fill="#132a1c" stroke="#1f4a30"/>
  <text x="56" y="533" class="ui" fill="#4ade80" font-size="12">12 rows · 5 ms</text>
</g>
<text x="920" y="533" class="ui" fill="#5a5a5a" font-size="11" text-anchor="end">Perch</text>
</svg>
'''

out = Path("docs/assets/demo.svg")
out.write_text(svg)
print(f"wrote {out} ({len(svg) // 1024} KB, {CYCLE}s loop)")
