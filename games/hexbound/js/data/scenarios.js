// Scenario maps. Rows are "odd-r" offset hex rows; each char maps through the legend.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const L = (terrain, extra) => Object.assign({ terrain }, extra || {});

  // emoji banner art for scenario cards and campaign map nodes
  G.SCEN_ART = { goblins: '🌲⚔🌲', barrow: '🪦🏮🪦', bandits: '🔥🪓🛒', golem: '🎂👁👁🎂' };

  G.Scenarios = [
    {
      id: 'goblins', level: 1, deployRows: [9, 11], name: 'Thornwood Crossing', sub: 'Level 1 · Party vs Goblins',
      blurb: 'Grizzlenack the Bold has claimed the old bridges over Thornwater Creek and charges a "toll" of everything you own. Cross the creek, break the warband.',
      intro: 'Goblin war-drums thump in the Thornwood. "TOLL!" shrieks a voice from across the creek.',
      winText: 'The goblins scatter into the thorns, leaving Grizzlenack\'s ridiculous crown behind.',
      palette: { ground: 0x5f8f3e, sky: 0x9fc6e8, fog: 0xbfd8c0, light: 0xfff2d6 },
      legend: {
        '.': L('grass'), ',': L('rough'), 'T': L('tree'), 'R': L('rock'), '~': L('water'), '=': L('bridge'), 'H': L('grass', { spawn: 'hero' }), 'F': L('rough'),
      },
      map: [
        'TT,,...T...,,.,TT',
        'T,.......R.....,T',
        ',..T..,.....T..,,',
        '...,......,......',
        '~~~~=~~~FF~~~=~~~',
        '~~~~=~~~FF~~~=~~~',
        '....,...T.......,',
        '.T....,.....,..T.',
        '..,..R.....T.....',
        '.....,..,....,...',
        'T,..H.H..H.H...,T',
        'TT,.....T.....,TT',
      ],
      enemies: [
        { id: 'goblin_boss', at: [8, 1] },
        { id: 'goblin_cutter', at: [4, 3] }, { id: 'goblin_cutter', at: [13, 3] }, { id: 'goblin_cutter', at: [8, 3] }, { id: 'goblin_cutter', at: [9, 3] },
        { id: 'goblin_skulker', at: [6, 2] },
        { id: 'goblin_slinger', at: [11, 1] },
        { id: 'warg', at: [2, 2] },
      ],
      events: [
        { round: 3, msg: 'Shrill whoops from the treeline — three more goblin cutters rush the creek!', spawn: [{ id: 'goblin_cutter', at: [2, 0] }, { id: 'goblin_cutter', at: [14, 0] }, { id: 'goblin_cutter', at: [5, 0] }] },
      ],
      tips: ['Goblin Cutters die to any hit. Area attacks shred them.', 'The ford (rough ground) and two bridges are chokepoints. A Fighter on a bridge is a wall.', 'Grizzlenack calls for help when bloodied.'],
    },
    {
      id: 'barrow', level: 2, deployRows: [9, 11], name: 'The Lantern Barrow', sub: 'Level 2 · Party vs the Restless Dead',
      blurb: 'Past the Thornwood, the road climbs through an old hill cemetery. Old Sallow, the Lantern Widow, tends it with green soul lanterns, and nothing buried there stays down for long.',
      intro: 'Green lights bob between the headstones. Somewhere in the crypt, an old woman hums. "Visitors! Come in, come in. Everyone stays for supper."',
      winText: 'The last lantern gutters out. Old Sallow crumbles to dust and grave-moss, and the hill goes quiet at last.',
      loseText: 'The party joins the Widow\'s garden. The lanterns glow a little brighter.',
      palette: { ground: 0x4a5a44, sky: 0x5a6a8a, fog: 0x6a7a7f, light: 0xc8d8ff },
      legend: {
        '.': L('grass'), ',': L('rough'), 'T': L('tree'), 'R': L('rock'), '+': L('grave'), '#': L('wall'), 'H': L('grass', { spawn: 'hero' }),
      },
      map: [
        'TT,...##.##...,TT',
        'T,....#...#....,T',
        '..+.+.......+.+..',
        '.,......,.......,',
        '..+.+..+.+..+.+..',
        '.......,.........',
        ',.+.+.......+.+.,',
        '.......R.........',
        '..,...........,..',
        '.....,....,......',
        'T,..H.H..H.H...,T',
        'TT,.....T.....,TT',
      ],
      enemies: [
        { id: 'lantern_widow', at: [8, 1] },
        { id: 'barrow_warden', at: [8, 3] },
        { id: 'barrow_archer', at: [5, 2] }, { id: 'barrow_archer', at: [11, 2] },
        { id: 'grave_hound', at: [15, 3] },
        { id: 'rattlebone', at: [3, 5] }, { id: 'rattlebone', at: [6, 5] }, { id: 'rattlebone', at: [10, 5] }, { id: 'rattlebone', at: [13, 5] },
      ],
      objects: [{ id: 'soul_lantern', at: [3, 3] }, { id: 'soul_lantern', at: [13, 3] }],
      events: [
        { round: 3, msg: 'The ground heaves near the crypt. Two more Rattlebones claw their way up!', spawn: [{ id: 'rattlebone', at: [6, 1] }, { id: 'rattlebone', at: [11, 1] }] },
      ],
      tips: ['Each soul lantern lets the Widow raise a Rattlebone every turn. Smashing one also blasts the undead around it with radiant light.', 'Headstones block movement but not line of sight. Use them to funnel the dead.', 'Kill the Widow and every Rattlebone falls with her.'],
    },
    {
      id: 'bandits', level: 3, deployRows: [9, 11], name: 'The Red Toll', sub: 'Level 3 · Party vs Bandits',
      blurb: 'Merrin the Red\'s crew has barricaded the King\'s Road with overturned wagons. Their camp is full of lamp oil, which is a fire hazard. Literally.',
      intro: '"Evening, travelers," calls a woman in a crimson coat. "The road\'s closed. Unless you can pay." Her crew draws steel.',
      winText: 'Merrin the Red yields her rapier with a theatrical bow. "Fine. The road is yours. This time."',
      palette: { ground: 0x8a7a55, sky: 0xe39b6b, fog: 0xd9a88a, light: 0xffc48a },
      legend: {
        '.': L('grass'), ',': L('rough'), 'T': L('tree'), 'R': L('rock'), 'r': L('road'), 'W': L('wagon'), 'F': L('fire'), 't': L('tent'), 'H': L('road', { spawn: 'hero' }),
      },
      map: [
        'TT..tt...rr..tt.T',
        'T...tt..rr...tt..',
        '..,....Frr.......',
        '.,..WW.rr..WW..,.',
        '.......rr........',
        '..T...rr.....R...',
        '.,....rr.,.....,.',
        '.....rr......T...',
        'T...rr..,........',
        '...,rr.......,..T',
        'T..H.H.H.H...,.TT',
        'TT,rr......,..TTT',
      ],
      enemies: [
        { id: 'bandit_captain', at: [9, 1] },
        { id: 'bandit_bruiser', at: [7, 3] },
        { id: 'bandit_cutthroat', at: [13, 4] },
        { id: 'bandit_xbow', at: [12, 2] },
        { id: 'bandit_thug', at: [6, 4] }, { id: 'bandit_thug', at: [9, 4] }, { id: 'bandit_thug', at: [3, 4] }, { id: 'bandit_thug', at: [10, 3] },
      ],
      objects: [
        { id: 'oil_barrel', at: [6, 3] }, { id: 'oil_barrel', at: [10, 4] }, { id: 'oil_barrel', at: [3, 3] }, { id: 'oil_barrel', at: [8, 0] },
      ],
      events: [
        { round: 3, msg: 'Merrin whistles. "Lads! Company!" Two thugs vault the wagons and a crossbowman climbs onto a tent pole.', spawn: [{ id: 'bandit_thug', at: [16, 1] }, { id: 'bandit_thug', at: [0, 2] }, { id: 'bandit_xbow', at: [4, 0] }] },
      ],
      tips: ['Oil barrels explode when damaged (2d6+3 fire, burst 1) and leave burning ground. Bandits camp next to them...', 'Merrin ripostes when you miss her in melee. Bait her with ranged attacks first.', 'Crossbowmen knock you prone with Aimed Bolts — stand up costs your move.'],
    },
    {
      id: 'golem', level: 5, deployRows: [9, 11], name: 'The Grand Bakery', sub: 'Level 5 · Party vs "The Pastry Golem"',
      blurb: 'A wizard-baker\'s animation spell went horribly right. Something enormous, tiered and frosted now rules the Grand Bakery of Hollowmere, and it has opinions about you.',
      intro: 'Ovens roar. Flour drifts like snow. Atop a mountain of cake, two cherry eyes open. "PREHEATING... COMPLETE."',
      winText: 'The Pastry Golem sags, deflates, and collapses into the world\'s largest, angriest trifle. The bakery is saved. It smells incredible.',
      bossId: 'pastry_golem',
      palette: { ground: 0xf3d9e4, sky: 0xffe9f2, fog: 0xffe4ef, light: 0xfff6e8 },
      legend: {
        '.': L('tile'), ',': L('tile'), '#': L('wall'), 'O': L('oven'), 'f': L('frosting'), 'P': L('pillar'), 'C': L('counter'), 'H': L('tile', { spawn: 'hero' }),
      },
      map: [
        '#OO###OO#OO###OO#',
        '.................',
        '.P..ff.......f.P.',
        '....ff.......ff..',
        '..C.............C',
        '.......f.f.......',
        '..P....fff....P..',
        '.....C.....C.....',
        '..f...........ff.',
        '.ff.............f',
        '...H..H...H..H...',
        '#.......P.......#',
      ],
      enemies: [
        { id: 'pastry_golem', at: [8, 2] },
        { id: 'gingerbread', at: [5, 4] }, { id: 'gingerbread', at: [11, 4] }, { id: 'gingerbread', at: [7, 5] }, { id: 'gingerbread', at: [10, 5] },
        { id: 'macaron', at: [2, 1] },
      ],
      objects: [{ id: 'jam_jar', at: [4, 6] }, { id: 'jam_jar', at: [12, 6] }, { id: 'jam_jar', at: [8, 7] }],
      events: [
        { round: 3, msg: 'The pantry door bursts open: a Cinnamon Roller unfurls and barrels in!', spawn: [{ id: 'cinnamon_roller', at: [16, 4] }] },
        { round: 5, msg: 'A second Macaron Mortar hops down from the display shelf, cracking its shell menacingly.', spawn: [{ id: 'macaron', at: [14, 1] }] },
      ],
      tips: ['The Golem is Large: it fills seven hexes, so more of you can gang up on it. Once bloodied it acts twice per round — save your dailies for that phase.', 'When bloodied it starts a Grand Soufflé: a marked area that slams down on its next turn. MOVE.', 'Jam jars shatter into sticky jam that immobilizes. Smash one near the Golem\'s friends.', 'Ovens burn anyone who enters or starts a turn in them — push minions in!'],
    },
  ];
})();
if (typeof module !== 'undefined') module.exports = G;
