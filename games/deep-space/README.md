# Deep Space

An idle survival game for phones and desktops. You are the only crew left aboard the survey tug *Kestrel* after a gravity shear tore her apart far past the edge of the charts. Salvage what drifts by, keep the air flowing, rebuild the ship, and jump your way home to the Meridian relay, seven sectors away.

Plain HTML, CSS and scripts, no build step and no dependencies. Open `index.html` in a browser (it works from `file://`). Progress saves to `localStorage`.

## How it plays

- **Salvage.** Chunks drift past the ship: grey scrap, blue ice, violet data boxes and the occasional golden chunk worth twelve times as much. Tap them. Later talents add a magnet glove, a tractor beam (hold your finger down), a tap combo, lucky finds, sweeper drones and Wren grabbing chunks for you.
- **Air.** You breathe all the time. The scrubber, and later the hydroponics bay, make air. When the air bar runs low, Wren switches systems off to save you, and turns them back on when it recovers. If it still runs out you black out and lose some scrap.
- **Power.** The reactor makes power and every system draws some. Draw more than you make and everything slows to match. Spare power charges the jump drive, so switching things off is a real choice near the end of a sector.
- **Systems.** Reactor, CO₂ scrubber, salvage drones, fabricator (scrap into alloy), ice drill, hydroponics (ice into air) and the scanner dish (data). Every tenth level a system is retuned and doubles its output.
- **Repairs.** One-off projects bring systems back online and fix the ship. Some only become possible in later sectors. Repairs survive jumps.
- **Probes.** The scanner finds contacts. Probes fly out for minutes to hours and come back with loot worth a stretch of your current income, and rare contacts can carry one of twelve keepsakes, each with a story and a small permanent bonus. One of them is a cat.
- **Jumping.** Three drive repairs and a full charge take you to the next sector. A jump resets materials and system levels, and pays three talent points. Each of the seven sectors has its own look and modifier. Answering the beacon at Meridian ends the story, and the drive then keeps going into endless uncharted sectors.
- **Talents.** Fifty-five stars in five branches (Scavenging, Engineering, Life Support, Navigation, Grit) plus five cross-links between neighbouring branches, 187 ranks in all. Every crew level earns a point, and points can be taken back for free at any time. Two of them unlock active abilities, Overclock and Spacewalk.

## Pacing, and not playing too much

Deep Space is meant to be checked on a few times a day, not watched.

- The ship runs while you are away, but only for 8 hours (Long Watch and Cryosleep extend that). The welcome-back screen says what happened and when Wren put the ship in low power.
- Probe trips are long, contacts never expire, and nothing is lost by being away inside that window.
- After 40 minutes at the console, Wren suggests a break.
- There are no streaks, daily rewards or notifications.

`tests/sim.js` plays the game with a bot on three schedules. The story ends after about 4 days for a keen player (20 minutes an hour), 7 days for a casual one (10 minutes every 4 hours) and 10 days for someone who checks in twice a day.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `css/style.css` | The page and its styles |
| `js/data.js` | All content and numbers: systems, repairs, sectors, talents, probes, keepsakes and Wren's log |
| `js/core.js` | The simulation (no DOM, also runs under Node) |
| `js/field.js` | The canvas: space, the Kestrel, chunks, drones and effects |
| `js/ui.js` | HUD, tabs, the talent constellation, overlays, saving and the main loop |

## Tests

```
node --test tests/rules.js  # rules, plus a pacing check that runs the casual sim
node tests/sim.js casual    # pacing report: casual | keen | idle
node tests/play.js [outDir] # browser walk-through with screenshots (needs Playwright)
```
