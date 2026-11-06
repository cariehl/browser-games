// Deep Space: all of the game's content. Numbers, talents, repairs, sectors, keepsakes and Wren's log.
// Plain script: in the browser it sets window.DSData; under Node it is a CommonJS module (for tests/sim.js).
(function (root) {
'use strict';

// ---------- resources ----------
const RES = {
  o2:    { name: 'Air',   icon: 'O₂', col: '#5fe08a' },
  scrap: { name: 'Scrap', icon: '⬢',  col: '#ffb44a' },
  alloy: { name: 'Alloy', icon: '▰',  col: '#c9d3e6' },
  ice:   { name: 'Ice',   icon: '❄',  col: '#5cc8ff' },
  data:  { name: 'Data',  icon: '◈',  col: '#b48cff' },
};
const POWER_COL = '#ffd84a';

// ---------- ship systems ----------
// out: base output per level per second. draw: power per level. cost(lv): price of going from lv to lv+1.
// Every 10 levels a system is retuned and its output doubles.
const g = (base, mult, lv) => Math.ceil(base * Math.pow(mult, lv));
const MODS = {
  reactor: { name: 'Reactor', icon: '☢', col: POWER_COL, blurb: 'Makes the power everything else runs on.',
    cost: lv => ({ scrap: g(15, 1.6, lv - 1), ...(lv >= 4 ? { alloy: g(2, 1.6, lv - 4) } : {}) }) },
  scrubber: { name: 'CO₂ Scrubber', icon: '≋', col: '#5fe08a', out: 1.5, res: 'o2', draw: 2, blurb: 'Pulls carbon dioxide out of the cabin air.',
    cost: lv => ({ scrap: g(10, 1.55, lv - 1), ...(lv >= 5 ? { alloy: g(3, 1.5, lv - 5) } : {}) }) },
  drones: { name: 'Salvage Drones', icon: '⟁', col: '#ffb44a', out: 0.6, res: 'scrap', draw: 2, blurb: 'Little scavengers that bring back scrap on their own.',
    cost: lv => ({ scrap: g(20, 1.5, lv - 1), ...(lv >= 4 ? { alloy: g(2, 1.5, lv - 4) } : {}) }) },
  fab: { name: 'Fabricator', icon: '⚒', col: '#c9d3e6', out: 0.1, res: 'alloy', draw: 3, eats: { scrap: 6 }, blurb: 'Melts scrap into clean alloy plate.',
    cost: lv => ({ scrap: g(80, 1.55, lv - 1), ...(lv >= 2 ? { alloy: g(3, 1.5, lv - 2) } : {}) }) },
  drill: { name: 'Ice Drill', icon: '❄', col: '#5cc8ff', out: 0.25, res: 'ice', draw: 3, blurb: 'Bores into passing comets for water ice.',
    cost: lv => ({ scrap: g(120, 1.5, lv - 1), alloy: g(6, 1.5, lv - 1) }) },
  garden: { name: 'Hydroponics', icon: '❦', col: '#7ee07a', out: 3, res: 'o2', draw: 1, eats: { ice: 0.04 }, blurb: 'Plants turn melted ice and light into air. They also make the ship smell like tomatoes.',
    cost: lv => ({ alloy: g(12, 1.5, lv - 1), ice: g(10, 1.5, lv - 1) }) },
  scanner: { name: 'Scanner Dish', icon: '◎', col: '#b48cff', out: 0.04, res: 'data', draw: 4, blurb: 'Listens to the dark and turns what it hears into data.',
    cost: lv => ({ scrap: g(250, 1.55, lv - 1), alloy: g(15, 1.5, lv - 1) }) },
};
const MOD_ORDER = ['reactor', 'scrubber', 'drones', 'fab', 'drill', 'garden', 'scanner'];
// Wren cuts power in this order when the air runs low, and restores it in reverse.
const SHED_ORDER = ['scanner', 'drill', 'fab', 'drones'];
const reactorGen = lv => 6 + 5 * (lv - 1);

// ---------- repairs ----------
// One-off projects. Repairs stay done through jumps; jumping only knocks systems back to level 1.
const PROJECTS = [
  { id: 'scrub', name: 'Patch the scrubber', sector: 1, cost: { scrap: 10 }, unlock: 'scrubber',
    blurb: 'A cracked manifold and a lot of tape. Air first, everything else second.' },
  { id: 'drones', name: 'Wake the drone bay', sector: 1, req: 'scrub', cost: { scrap: 35 }, unlock: 'drones',
    blurb: 'Two drones survived, curled up in their cradles like sleeping beetles.' },
  { id: 'fab', name: 'Restart the fabricator', sector: 1, req: 'drones', cost: { scrap: 120 }, unlock: 'fab',
    blurb: 'Scrap is fine for patches. Real repairs need alloy plate.' },
  { id: 'drill', name: 'Rig an ice drill', sector: 1, req: 'fab', cost: { scrap: 260, alloy: 10 }, unlock: 'drill',
    blurb: 'Comet ice is water, coolant and, eventually, air.' },
  { id: 'scan', name: 'Rebuild the scanner dish', sector: 1, req: 'drill', cost: { scrap: 450, alloy: 25, ice: 15 }, unlock: 'scanner',
    blurb: 'If you are going to find a way home, you need to be able to see.' },
  { id: 'probe', name: 'Repair the probe bay', sector: 1, req: 'scan', cost: { alloy: 40, data: 6 },
    blurb: 'Probes go where you cannot, and come back with whatever they find.' },
  { id: 'garden', name: 'Plant the hydroponics bay', sector: 2, cost: { scrap: 900, alloy: 50, ice: 40 }, unlock: 'garden',
    blurb: 'You found a packet of tomato seeds in your locker. Wren insists you plant them.' },
  { id: 'clamp', name: 'Fit a docking clamp', sector: 3, cost: { alloy: 260, data: 40 }, fx: { probeReward: 0.25 },
    blurb: 'Lets probes haul back bigger finds from the wrecks out here. Probe rewards +25%.' },
  { id: 'fins', name: 'Unfold the radiator fins', sector: 4, cost: { alloy: 700, ice: 300 }, fx: { reactorMult: 0.4 },
    blurb: 'A cooler reactor is a happier reactor. Reactor output +40%.' },
  { id: 'scoops', name: 'Build nebula scoops', sector: 5, cost: { alloy: 1600, data: 200 }, fx: { iceMult: 0.5, dataMult: 0.25 },
    blurb: 'Wide nets of charged wire that sweep in dust and ice. Ice +50%, data +25%.' },
  { id: 'wren', name: "Restore Wren's memory core", sector: 6, cost: { alloy: 4000, data: 600, ice: 800 }, fx: { xpMult: 0.25, wrenTap: 1 },
    blurb: 'She has been running on a fraction of herself since the accident. Crew XP +25%, and Wren starts collecting chunks for you.' },
];

// ---------- the jump drive ----------
const DRIVE_STAGES = [
  { name: 'Replace the coil housings', cost: { scrap: 20000, alloy: 1500 } },
  { name: 'Refill the coolant loop', cost: { ice: 4000, alloy: 4000 } },
  { name: 'Plot a jump solution', cost: { data: 500, alloy: 8000, scrap: 60000 } },
];
const DRIVE_GROWTH = 3.8;     // stage costs grow this much per sector
const CHARGE_BASE = 40000;     // power-seconds of spare power to charge the drive
const CHARGE_GROWTH = 1.9;

// ---------- sectors ----------
// yield: everything you collect is worth more the farther out you get.
const SECTORS = [
  null,
  { name: 'The Drift', sub: 'Where the Kestrel broke apart', hue: [94, 80, 180], mod: null,
    note: 'No modifiers. Just you and the wreckage.' },
  { name: 'The Hollow Belt', sub: 'A river of frozen comets', hue: [70, 150, 200], mod: { iceMult: 0.5, iceChunks: 2 },
    note: 'Ice +50%, and ice chunks drift by twice as often.' },
  { name: 'The Graveyard', sub: 'Ships that did not make it', hue: [150, 110, 90], mod: { contactRate: 0.5, relicChunks: 1 },
    note: 'Probe contacts appear 50% faster, and golden chunks are twice as common.' },
  { name: 'Pulsar Reach', sub: 'A dead star, still ticking', hue: [120, 120, 230], mod: { reactorMult: 0.3 },
    note: 'Reactor +30%. The light comes in pulses.' },
  { name: 'Lantern Nebula', sub: 'Glowing dust as far as you can see', hue: [200, 80, 170], mod: { dataMult: 0.5, breath: 0.2 },
    note: 'Data +50%, but the dust clogs your lungs: breathing +20%.' },
  { name: 'The Quiet', sub: 'Nothing out here at all', hue: [60, 70, 100], mod: { xpMult: 0.5, spawn: -0.4 },
    note: 'Crew XP +50%, but chunks are rare.' },
  { name: 'Meridian', sub: 'The relay beacon. Home is one call away.', hue: [230, 170, 90], mod: { allMult: 0.1 },
    note: 'All production +10%. Someone is listening.' },
];
const BEYOND_MODS = [
  { name: 'Ice', mod: { iceMult: 0.5, iceChunks: 2 }, note: 'Ice +50%, more ice chunks.' },
  { name: 'Wrecks', mod: { contactRate: 0.5, relicChunks: 1 }, note: 'Contacts appear faster, more golden chunks.' },
  { name: 'Pulse', mod: { reactorMult: 0.3 }, note: 'Reactor +30%.' },
  { name: 'Dust', mod: { dataMult: 0.5, breath: 0.2 }, note: 'Data +50%, breathing +20%.' },
  { name: 'Calm', mod: { xpMult: 0.5, spawn: -0.4 }, note: 'Crew XP +50%, fewer chunks.' },
];
const BEYOND_NAMES = ['Uncharted Reach', 'The Long Dark', 'Tidewater Cluster', 'Saltglass Field', 'The Cradle', 'Ember Shoal', 'Farlight', 'The Lull', 'Kite Nebula', 'Old Harbor'];
const sectorYield = s => Math.pow(1.6, s - 1);
const FINAL_SECTOR = 7;
const BEACON = { name: 'Answer the Meridian beacon', cost: { alloy: 30000, data: 4000, ice: 8000, scrap: 400000 } };

// ---------- talents ----------
// Five branches radiate from the centre of the constellation. Tier is distance from the centre.
// Cross-links sit between two neighbouring branches and need a talent from each.
const BRANCHES = [
  { id: 's', name: 'Scavenging',  col: '#ffb44a', ang: -90 },
  { id: 'e', name: 'Engineering', col: '#ff7a45', ang: -18 },
  { id: 'l', name: 'Life Support', col: '#5fe08a', ang: 54 },
  { id: 'n', name: 'Navigation',  col: '#5cc8ff', ang: 126 },
  { id: 'g', name: 'Grit',        col: '#b48cff', ang: 198 },
];
// gate[t]: points already spent in the branch before tier t opens.
const TIER_GATE = [0, 0, 1, 3, 6, 10, 15];
const pct = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
const T = (id, b, t, o, max, name, fx, fmt, req, extra) => ({ id, b, t, o, max, name, fx, fmt, req: req || [], cost: 1, ...extra });
const TALENTS = [
  // Scavenging
  T('s_hands', 0, 1, 0, 5, 'Steady Hands', { tap: 0.25 }, r => `${pct(.25 * r)} scrap from chunks you tap`),
  T('s_drone', 0, 2, -1, 5, 'Drone Tuning', { droneMult: 0.2 }, r => `${pct(.2 * r)} drone output`, ['s_hands']),
  T('s_magnet', 0, 2, 1, 3, 'Magnet Glove', { magnet: 1 }, r => `A tap also grabs chunks within ${[0, 40, 65, 90][r]}px of your finger`, ['s_hands']),
  T('s_swarm', 0, 3, -1, 3, 'Swarm Logic', { droneDraw: -0.15 }, r => `Drones draw ${Math.round(15 * r)}% less power`, ['s_drone']),
  T('s_spot', 0, 3, 1, 3, "Spotter's Eye", { relicChunks: 0.5 }, r => `Golden chunks (worth 12×) appear ${pct(.5 * r)} more often`, ['s_magnet']),
  T('s_sweep', 0, 4, -1, 3, 'Sweeper Drones', { sweep: 1 }, r => `A drone grabs a chunk from the field every ${[0, 8, 5, 3][r]}s`, ['s_swarm']),
  T('s_tractor', 0, 4, 0.2, 1, 'Tractor Beam', { tractor: 1 }, () => 'Hold your finger on space to pull nearby chunks in', ['s_magnet']),
  T('s_lucky', 0, 4, 1.3, 5, 'Lucky Find', { crit: 0.03 }, r => `${Math.round(3 * r)}% chance a tapped chunk pays 5×`, ['s_spot']),
  T('s_junk', 0, 5, 0, 5, 'Junk Sense', { scrapMult: 0.1 }, r => `${pct(.1 * r)} all scrap`, ['s_tractor']),
  T('s_cap', 0, 6, 0, 1, 'Junk Artist', { scrapX: 0.5, tenthRelic: 1 }, () => 'All scrap ×1.5, and every 10th chunk you tap turns golden', ['s_junk'], { cost: 3 }),
  // Engineering
  T('e_wire', 1, 1, 0, 5, 'Rewiring', { reactorMult: 0.1 }, r => `${pct(.1 * r)} reactor output`),
  T('e_thrift', 1, 2, -1, 5, 'Thrifty Fabrication', { fabEff: 0.08 }, r => `Fabricator uses ${Math.round(8 * r)}% less scrap per plate`, ['e_wire']),
  T('e_circ', 1, 2, 1, 5, 'Clean Circuits', { draw: -0.05 }, r => `Every system draws ${Math.round(5 * r)}% less power`, ['e_wire']),
  T('e_fast', 1, 3, -1, 5, 'Hot Forge', { fabMult: 0.15 }, r => `${pct(.15 * r)} fabricator speed`, ['e_thrift']),
  T('e_oc', 1, 3, 1, 1, 'Overclock', { overclock: 1 }, () => 'New ability: double reactor output for 45s (6 min cooldown)', ['e_circ']),
  T('e_parts', 1, 4, -1, 5, 'Salvaged Parts', { costMult: -0.05 }, r => `System upgrades cost ${Math.round(5 * r)}% less`, ['e_fast']),
  T('e_cap', 1, 4, 0.1, 3, 'Capacitor Bank', { charge: 0.3 }, r => `Jump drive charges ${pct(.3 * r)} faster`, ['e_oc']),
  T('e_red', 1, 4, 1.3, 3, 'Redline', { ocDur: 15 }, r => `Overclock lasts ${15 * r}s longer`, ['e_oc']),
  T('e_fusion', 1, 5, 0, 1, 'Fusion Retrofit', { reactorX: 0.5 }, () => 'Reactor output ×1.5', ['e_cap'], { cost: 2 }),
  T('e_capst', 1, 6, 0, 1, 'Master Engineer', { freeLv: 2 }, () => 'Every system gets 2 free levels', ['e_fusion'], { cost: 3 }),
  // Life Support
  T('l_breath', 2, 1, 0, 5, 'Slow Breathing', { breath: -0.06 }, r => `You breathe ${Math.round(6 * r)}% less air`),
  T('l_tank', 2, 2, -1, 5, 'Bigger Tanks', { tank: 30 }, r => `+${30 * r} air capacity`, ['l_breath']),
  T('l_filter', 2, 2, 1, 5, 'Fine Filters', { scrubMult: 0.15 }, r => `${pct(.15 * r)} scrubber output`, ['l_breath']),
  T('l_watch', 2, 3, -1, 3, 'Long Watch', { offlineH: 2 }, r => `Wren keeps the ship running ${2 * r}h longer while you are away`, ['l_tank']),
  T('l_green', 2, 3, 1, 5, 'Green Thumb', { gardenMult: 0.2 }, r => `${pct(.2 * r)} hydroponics output`, ['l_filter']),
  T('l_calm', 2, 4, -1.3, 5, 'Calm Mind', { xpMult: 0.06 }, r => `${pct(.06 * r)} crew XP`, ['l_watch']),
  T('l_fresh', 2, 4, 0, 3, 'Fresh Air', { fresh: 0.05 }, r => `While air is above 80%, all production ${pct(.05 * r)}`, ['l_filter']),
  T('l_compost', 2, 4, 1.3, 3, 'Composting', { gardenIce: -0.15 }, r => `Hydroponics uses ${Math.round(15 * r)}% less ice`, ['l_green']),
  T('l_bio', 2, 5, 0, 1, 'Biosphere', { breath: -0.2, tank: 60 }, () => 'Breathe 20% less and +60 air capacity', ['l_fresh'], { cost: 2 }),
  T('l_cap', 2, 6, 0, 1, 'Second Home', { noBlackout: 1, allMult: 0.1 }, () => 'You never black out, and all production +10%', ['l_bio'], { cost: 3 }),
  // Navigation
  T('n_signal', 3, 1, 0, 5, 'Signal Processing', { dataMult: 0.15 }, r => `${pct(.15 * r)} data`),
  T('n_range', 3, 2, -1, 3, 'Long-range Scan', { contactRate: 0.25 }, r => `Probe contacts appear ${pct(.25 * r)} faster`, ['n_signal']),
  T('n_tele', 3, 2, 1, 5, 'Probe Telemetry', { probeSpeed: 0.08 }, r => `Probes come back ${Math.round(8 * r)}% sooner`, ['n_signal']),
  T('n_charts', 3, 3, -1, 3, 'Survey Charts', { probeReward: 0.2 }, r => `${pct(.2 * r)} probe rewards`, ['n_range']),
  T('n_slot2', 3, 3, 0.4, 1, 'Second Probe', { slots: 1 }, () => 'Fly two probes at once', ['n_tele']),
  T('n_anom', 3, 4, -1.3, 3, 'Anomaly Hunter', { rare: 0.4 }, r => `Rare contacts ${pct(.4 * r)} more often`, ['n_charts']),
  T('n_star', 3, 4, 1, 3, 'Star Charts', { driveCost: -0.08 }, r => `Jump drive repairs cost ${Math.round(8 * r)}% less`, ['n_tele']),
  T('n_slot3', 3, 5, -0.3, 1, 'Third Probe', { slots: 1 }, () => 'Fly three probes at once', ['n_slot2'], { cost: 2 }),
  T('n_echo', 3, 5, 1, 3, 'Jump Echoes', { jumpTP: 1 }, r => `+${r} talent point${r > 1 ? 's' : ''} every time you jump`, ['n_star']),
  T('n_cap', 3, 6, 0, 1, 'Pathfinder', { keepLv: 1 }, () => 'Systems keep a third of their levels when you jump', ['n_slot3'], { cost: 3 }),
  // Grit
  T('g_study', 4, 1, 0, 5, 'Quick Study', { xpMult: 0.06 }, r => `${pct(.06 * r)} crew XP`),
  T('g_rhythm', 4, 2, -1, 3, 'Rhythm', { combo: 0.1 }, r => `Quick taps build a combo worth up to ${pct(.1 * r)}`, ['g_study']),
  T('g_wren', 4, 2, 1, 3, "Wren's Hands", { wrenTap: 1 }, r => `Wren grabs a chunk for you every ${[0, 6, 4, 2.5][r]}s`, ['g_study']),
  T('g_walk', 4, 3, -1, 1, 'Spacewalk', { spacewalk: 1 }, () => 'New ability: go outside for 25s. Chunks pour in and taps pay double (8 min cooldown)', ['g_rhythm']),
  T('g_ingen', 4, 3, 1, 5, 'Ingenuity', { allMult: 0.04 }, r => `${pct(.04 * r)} all production`, ['g_wren']),
  T('g_tether', 4, 4, -1.3, 3, 'Longer Tether', { swDur: 10 }, r => `Spacewalks last ${10 * r}s longer`, ['g_walk']),
  T('g_nerve', 4, 4, 0, 3, 'Steady Nerves', { abilityCd: -0.12 }, r => `Ability cooldowns ${Math.round(12 * r)}% shorter`, ['g_ingen']),
  T('g_keep', 4, 4, 1.3, 3, 'Magpie', { relicFind: 0.5 }, r => `Probes find keepsakes ${pct(.5 * r)} more often`, ['g_ingen']),
  T('g_vet', 4, 5, 0, 5, 'Old Hand', { perJump: 0.02 }, r => `All production +${2 * r}% for every jump you have made`, ['g_nerve']),
  T('g_cap', 4, 6, 0, 1, 'Thrive', { allX: 0.25, levelCost: -0.15 }, () => 'All production ×1.25, and crew levels need 15% less XP', ['g_vet'], { cost: 3 }),
  // Cross-links between neighbouring branches
  T('x_se', [0, 1], 3.6, 0, 1, 'Drone Mk II', { droneMult: 0.3, droneDraw: -0.1 }, () => 'Drones +30% output and draw 10% less power', ['s_drone', 'e_thrift'], { cost: 2 }),
  T('x_el', [1, 2], 3.6, 0, 1, 'Hydro-electric', { gardenPower: 1.5 }, () => 'Each hydroponics level gives back 1.5 power', ['e_circ', 'l_filter'], { cost: 2 }),
  T('x_ln', [2, 3], 3.6, 0, 1, 'Cryosleep', { offlineH: 4, offlineMult: 0.2 }, () => 'Wren keeps things running 4h longer while you are away, at +20% output', ['l_tank', 'n_range'], { cost: 2 }),
  T('x_ng', [3, 4], 3.6, 0, 1, "Wanderer's Luck", { probeDouble: 0.15 }, () => '15% chance a probe comes back with double', ['n_tele', 'g_wren'], { cost: 2 }),
  T('x_gs', [4, 0], 3.6, 0, 1, 'Second Nature', { tap: 0.5, wrenFull: 1 }, () => "Taps +50%, and Wren's grabs count as your taps (combo, luck and magnet)", ['g_rhythm', 's_hands'], { cost: 2 }),
];
const TALENT_BY_ID = Object.fromEntries(TALENTS.map(t => [t.id, t]));

// ---------- abilities ----------
const ABILITIES = {
  overclock: { name: 'Overclock', icon: '⚡', col: POWER_COL, dur: 45, cd: 360, needs: 'overclock', durKey: 'ocDur' },
  spacewalk: { name: 'Spacewalk', icon: '✦', col: '#b48cff', dur: 25, cd: 480, needs: 'spacewalk', durKey: 'swDur' },
};

// ---------- crew levels ----------
const xpToNext = L => Math.round(60 * Math.pow(1.3, L - 1));
// What each unit you collect is worth in crew XP, before sector yield is divided back out.
const XP_VALUE = { scrap: 0.12, alloy: 1.5, ice: 0.5, data: 3, o2: 0 };
const JUMP_TP = 3;

// ---------- probes ----------
// mins: flight time. rewards: minutes of your current income, by resource. rare contacts can carry keepsakes.
const CONTACTS = [
  { id: 'hull', name: 'Hull fragment', mins: 5, w: 30, cost: 3, rewards: { scrap: 14 }, desc: 'A twisted slab of plating, tumbling slowly.' },
  { id: 'comet', name: 'Dirty comet', mins: 15, w: 22, cost: 5, rewards: { ice: 22, scrap: 6 }, desc: 'Mostly ice, partly gravel, entirely cold.' },
  { id: 'pod', name: 'Cargo pod', mins: 30, w: 18, cost: 8, rewards: { alloy: 26, scrap: 20 }, desc: 'Somebody lost this. It still has its seal.' },
  { id: 'buoy', name: 'Silent buoy', mins: 45, w: 12, cost: 6, rewards: { data: 40 }, desc: 'A navigation buoy, out of power, full of old maps.' },
  { id: 'wreck', name: 'Derelict ship', mins: 120, w: 6, rare: true, cost: 20, rewards: { scrap: 90, alloy: 70, ice: 40 }, relic: 0.35, desc: 'Dark windows. No answer on any channel.' },
  { id: 'signal', name: 'Strange signal', mins: 180, w: 3, rare: true, cost: 30, rewards: { data: 160, alloy: 60 }, relic: 0.7, desc: 'A pattern that repeats every 41 seconds. It is not natural.' },
];
const CONTACT_EVERY = 240; // seconds between new contacts, before bonuses
const MAX_CONTACTS = 4;

// ---------- keepsakes ----------
const RELICS = [
  { id: 'cat', name: 'Biscuit', icon: '🐈', fx: { allMult: 0.05 }, eff: 'All production +5%',
    text: 'A ginger cat, very cross, asleep in a crate of insulation on a dead freighter. She has decided the Kestrel is hers now.' },
  { id: 'postcard', name: 'Faded postcard', icon: '🏞', fx: { xpMult: 0.05 }, eff: 'Crew XP +5%',
    text: 'A lake at dawn. On the back: "Wish you were here. Actually, wish I was there."' },
  { id: 'harmonica', name: 'Dented harmonica', icon: '🎵', fx: { tap: 0.15 }, eff: 'Taps +15%',
    text: 'It only plays three notes now. You learn a song that only needs three.' },
  { id: 'drawing', name: "Child's drawing", icon: '🖍', fx: { droneMult: 0.1 }, eff: 'Drones +10%',
    text: 'A rocket, a sun, and four stick people holding hands. Someone kept it on their console.' },
  { id: 'compass', name: 'Brass compass', icon: '🧭', fx: { driveCost: -0.05 }, eff: 'Jump drive repairs -5%',
    text: 'It points nowhere in particular, very confidently. You keep it for luck.' },
  { id: 'thermos', name: 'Thermos, still warm', icon: '☕', fx: { breath: -0.05 }, eff: 'Breathe 5% less',
    text: 'You do not ask how. The tea is excellent.' },
  { id: 'flower', name: 'Pressed flower', icon: '🌼', fx: { gardenMult: 0.15 }, eff: 'Hydroponics +15%',
    text: 'A daisy sealed in clear resin. Wren says the tomatoes seem happier with it nearby.' },
  { id: 'chess', name: 'Chess set, one knight short', icon: '♞', fx: { dataMult: 0.08 }, eff: 'Data +8%',
    text: 'Wren plays a bolt in for the missing knight. She still wins.' },
  { id: 'medal', name: 'Survey medal', icon: '🎖', fx: { tp: 1 }, eff: '+1 talent point',
    text: '"For distinguished service beyond the charted lanes." Somebody earned this. Now you have too.' },
  { id: 'mixtape', name: 'Mixtape', icon: '📼', fx: { abilityCd: -0.1 }, eff: 'Ability cooldowns -10%',
    text: 'Labelled "for the long haul" in careful capitals. Track four is perfect.' },
  { id: 'scarf', name: 'Hand-knit scarf', icon: '🧣', fx: { tank: 25 }, eff: '+25 air capacity',
    text: 'Too long, slightly uneven, and very warm. Made by someone patient.' },
  { id: 'letter', name: 'An unsent letter', icon: '✉', fx: { tp: 1 }, eff: '+1 talent point',
    text: '"If you are reading this, I made it further than anyone thought I would." You fold it carefully and keep going.' },
];

// ---------- Wren's log ----------
// Short entries from the ship's AI. Each fires once, when its trigger happens.
const LOG = {
  wake: { title: 'Reboot', text: "WREN-7 back online. Partially. You are alive, which is the good news. The Kestrel is in about forty pieces, which is the other news. The scrubber is down and the air is getting thin. There is scrap drifting all around us. Tap it. Quickly, please." },
  scrub: { title: 'Breathing room', text: "Air is moving again. I've done the arithmetic and you will live through the next hour, which I think we should celebrate by doing it again. The reactor is wheezing. Every system you power up draws on it, so keep an eye on the power gauge." },
  drones: { title: 'Little helpers', text: "The drones are out. They are slow and not very bright, but they will keep collecting while you sleep. So will I. That's the deal: you do the clever parts, we do the boring parts." },
  fab: { title: 'Plate', text: "The fabricator turns scrap into alloy, but it eats scrap while it runs. If you need scrap for something else, switch it off. I won't take it personally." },
  level: { title: 'Getting the hang of it', text: "You're learning this ship faster than the manual suggests. Every time you level up you earn a talent point. Open the constellation from the badge at the top and spend it. There's no wrong answer, and you can take points back any time." },
  drill: { title: 'Cold water', text: "Ice. We can drink it, cool things with it, and later grow things with it. Ice chunks will start drifting past too." },
  scan: { title: 'Listening', text: "The dish is working. I can see our position now. We are a very long way from anywhere, and the relay at Meridian is seven jumps out. The jump drive is damaged but not dead. The Repairs list shows what it needs." },
  probe: { title: 'Out there', text: "Probe bay is pressurised. When the scanner picks up something interesting it appears on the Probes list. A probe takes a while to come back, so launch one and go do something else. Like sleeping. You should sleep." },
  blackout: { title: 'That was close', text: "You passed out. I vented the reserve tank and you came back. Some scrap went with the reserve purge. Next time, when the air bar turns red, turn something off. I'll try to do it for you, but I can only do so much." },
  relic: { title: 'Keepsakes', text: "The probe brought back something that isn't salvage. I've put it on the shelf over your bunk. These things belonged to people. They seem to help." },
  cat: { title: 'Stowaway', text: "There is a cat on my ship. She came back in the probe, in a crate of foam, and she is now asleep on the warm part of the reactor housing. I've named her Biscuit. I did not ask you. She seems to agree." },
  away: { title: 'While you slept', text: "I kept the lights on. When you're away I can run things for a few hours before I have to put the ship in low power and wait for you. That's not a deadline, by the way. The ship will keep. Take your time." },
  rest: { title: 'A gentle note', text: "You've been at the console for a while. The air is fine, the drones are fine, I'm fine. Go stretch. Drink some water. Everything will still be here." },
  jumpready: { title: 'Ready when you are', text: "The drive is repaired. It charges from spare power, so anything you switch off charges it faster. When it's full we can jump. A jump scrambles the systems back to their base settings, but what you've learned stays with you. Repairs stay done, too." },
  s2: { title: 'The Hollow Belt', text: "First jump done. Everything is rattled but nothing is broken that wasn't already. Lots of comets out here. Oh, and I found a packet of tomato seeds in your locker. I think we should talk about the hydroponics bay." },
  garden: { title: 'Green', text: "First sprouts. I have been watching them for six hours. That is not a complaint." },
  s3: { title: 'The Graveyard', text: "Lots of ships out here. None of them are talking. Probes will find more to look at. Let's be respectful and also take their stuff." },
  s4: { title: 'Pulsar Reach', text: "There's a pulsar nearby: a dead star that spins and flashes like a lighthouse. Our reactor likes the extra radiation. I like the light." },
  s5: { title: 'Lantern Nebula', text: "The dust out here glows. It's beautiful and it gets into everything, including your lungs. The scrubbers will have to work harder." },
  s6: { title: 'The Quiet', text: "No wrecks. No comets. No signal. Just us. I'll be honest, I find it a bit unnerving. You learn a lot about yourself in places like this, I'm told." },
  wren: { title: 'Whole again', text: "Oh. Oh, that's better. I remember the accident now. A gravity shear, out of nowhere. It folded the ship and threw us farther than anyone has ever been thrown. You got us this far anyway. Thank you." },
  s7: { title: 'Meridian', text: "There it is. The Meridian relay, blinking away like it's been waiting for us. One more big job: power up enough to answer the beacon, and somebody at home will finally hear you." },
  ending: { title: 'Heard', text: "The reply came in at 04:12 ship time. Six words: \"Kestrel, we hear you. Hold on.\" They'll send a tug. It'll take a while. I asked if you want to keep exploring while we wait. You smiled, which I'm counting as a yes." },
  beyond: { title: 'Off the map', text: "Past Meridian the charts just stop. Every sector out here is a guess. Good thing we're good at guessing." },
};

const DS = {
  RES, POWER_COL, MODS, MOD_ORDER, SHED_ORDER, reactorGen, PROJECTS, DRIVE_STAGES, DRIVE_GROWTH, CHARGE_BASE, CHARGE_GROWTH,
  SECTORS, BEYOND_MODS, BEYOND_NAMES, sectorYield, FINAL_SECTOR, BEACON, BRANCHES, TIER_GATE, TALENTS, TALENT_BY_ID, ABILITIES,
  xpToNext, XP_VALUE, JUMP_TP, CONTACTS, CONTACT_EVERY, MAX_CONTACTS, RELICS, LOG,
};
if (typeof module === 'object' && module.exports) module.exports = DS;
else root.DSData = DS;
})(typeof window !== 'undefined' ? window : globalThis);
