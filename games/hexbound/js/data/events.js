// Non-combat encounters for campaign runs ("?" nodes): a scene, two or three choices, and skill checks.
// A check rolls d20 + the best living hero's skill bonus (ability modifier + half level, +5 if their class is
// trained in it, +2 for some ancestries) against a DC that rises with level. Outcomes are plain data that
// campaign.js applies (see applyOutcome there). All names and text are original.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  G.Skills = {
    athletics: { name: 'Athletics', abil: 'STR' }, acrobatics: { name: 'Acrobatics', abil: 'DEX' }, stealth: { name: 'Stealth', abil: 'DEX' },
    thievery: { name: 'Thievery', abil: 'DEX' }, endurance: { name: 'Endurance', abil: 'CON' }, arcana: { name: 'Arcana', abil: 'INT' },
    history: { name: 'History', abil: 'INT' }, religion: { name: 'Religion', abil: 'WIS' }, nature: { name: 'Nature', abil: 'WIS' },
    perception: { name: 'Perception', abil: 'WIS' }, insight: { name: 'Insight', abil: 'WIS' }, heal: { name: 'Heal', abil: 'WIS' },
    diplomacy: { name: 'Diplomacy', abil: 'CHA' }, bluff: { name: 'Bluff', abil: 'CHA' }, intimidate: { name: 'Intimidate', abil: 'CHA' },
  };
  G.SkillTraining = {
    fighter: ['athletics', 'endurance', 'intimidate'], rogue: ['stealth', 'thievery', 'acrobatics', 'bluff'],
    ranger: ['nature', 'perception', 'stealth', 'athletics'], cleric: ['religion', 'heal', 'insight', 'diplomacy'],
    warlord: ['diplomacy', 'history', 'intimidate', 'athletics'], wizard: ['arcana', 'history', 'insight'],
  };
  G.SkillAncestry = { dwarf: ['endurance'], elf: ['perception', 'nature'], halfling: ['acrobatics', 'thievery'], emberkin: ['intimidate', 'bluff'], orc: ['athletics', 'intimidate'], human: [] };
  G.SkillDC = { easy: 10, moderate: 15, hard: 19 };

  const hasPackItem = (run) => run.heroes.some(h => !h.dead && h.pack.length);
  const hasCurse = (run) => run.heroes.some(h => !h.dead && (h.boons || []).some(b => G.Boons[b] && G.Boons[b].curse));
  const hurt = (run) => run.heroes.some(h => !h.dead && h.damage > 0);

  G.Events = {
    shrine: {
      title: 'The Drowned Shrine', icon: '⛲',
      text: 'Half sunk in a reedy pool stands a shrine to some forgotten river goddess. A silver offering bowl, black with age, still sits in her stone hands.',
      choices: [
        { label: 'Pray at the shrine', check: { skill: 'religion', dc: 'moderate' },
          success: { text: 'The water stirs and warms. A gentle current washes the road-grime and the wounds away.', heal: { who: 'all', amt: 'surge' } },
          fail: { text: 'Only cold water and the croak of a frog. The goddess, if she is there, is not listening.' } },
        { label: 'Pry loose the silver bowl', check: { skill: 'thievery', dc: 'moderate' },
          success: { text: 'The bowl comes free with a wet click. Nobody struck you down. Probably fine.', gold: 45 },
          fail: { text: 'The bowl comes free, and so does a curse: the pool turns black, and one of you feels it settle on their shoulders.', gold: 45, curse: { id: 'c_hexed', who: 'checker' } } },
        { label: 'Leave the goddess in peace', outcome: { text: 'You leave a copper on the stone and move on.' } },
      ],
    },
    wagon: {
      title: 'Stuck in the Mud', icon: '🛞',
      text: 'A spice merchant\'s wagon is sunk to the axles in a rut, and his mule has opinions about all of it. "Friends! Help a poor man and I\'ll make it worth your while!"',
      choices: [
        { label: 'Put your backs into it', check: { skill: 'athletics', dc: 'moderate' },
          success: { text: 'With a heave and a sucking pop, the wagon rolls free. The merchant pays in coin and a little something from his stock.', gold: 25, item: 1 },
          fail: { text: 'Something in your back goes twang. The wagon comes free eventually, and the merchant pays a little for the trouble.', gold: 10, damage: { who: 'checker', amt: 6 } } },
        { label: 'Sell him a spare consumable', need: hasPackItem, needText: 'Needs an item in a pack',
          outcome: { text: 'He buys it at a fair price, which for a spice merchant is a minor miracle.', loseItem: 1, gold: 30 } },
        { label: 'Walk on by', outcome: { text: 'His curses follow you down the road for a good mile.' } },
      ],
    },
    cage: {
      title: 'The Hanging Cage', icon: '🪤',
      text: 'An iron cage swings from an oak branch. Inside, a skinny goblin named Snikkit presses his face to the bars. "Let Snikkit out! Snikkit knows things! Snikkit has stuff!"',
      choices: [
        { label: 'Let him out', outcome: { text: 'Snikkit drops to the ground, presses a grubby flask into your hand, and is gone into the brambles before you can say "you\'re welcome".', item: 1 } },
        { label: 'Make him talk first', check: { skill: 'intimidate', dc: 'easy' },
          success: { text: 'Snikkit squeals, then squeals out the location of his warband\'s stash. You let him go. You are not monsters.', gold: 35 },
          fail: { text: 'Snikkit bites. Hard. Then he escapes anyway.', damage: { who: 'checker', amt: 4 } } },
        { label: 'Leave him hanging', outcome: { text: '"You\'ll be sorry!" he shrieks. You probably won\'t.' } },
      ],
    },
    well: {
      title: 'The Wishing Well', icon: '🪣',
      text: 'An old well at a crossroads, its stones carved with a thousand scratched wishes. Far below, coins glint in the dark water.',
      choices: [
        { label: 'Toss in 20 gold and wish', cost: { gold: 20 },
          luck: [{ p: 0.55, out: { text: 'A warm wind rises out of the well and wraps around one of you like a blessing.', boon: { id: 'b_blessed', who: 'random' } } },
            { p: 0.45, out: { text: 'Plink. Nothing happens. Probably.' } }] },
        { label: 'Climb down after the coins', check: { skill: 'athletics', dc: 'hard' },
          success: { text: 'You come up soaked, freezing, and very rich.', gold: 60 },
          fail: { text: 'The rope snaps on the way up. You keep a handful of coins and a spectacular bruise.', gold: 15, damage: { who: 'checker', amt: 8 } } },
        { label: 'Keep walking', outcome: { text: 'Some wishes are best left in the water.' } },
      ],
    },
    toadstools: {
      title: 'A Ring of Toadstools', icon: '🍄',
      text: 'In a moonlit clearing, red-capped toadstools grow in a perfect circle. Tiny lights drift above it, and faint, impossible music plays from nowhere.',
      choices: [
        { label: 'Dance in the ring', check: { skill: 'acrobatics', dc: 'moderate' },
          success: { text: 'The fey laugh and clap. When the music stops, you feel rested in a way that sleep never manages: your spent daily powers return.', daily: { who: 'all' } },
          fail: { text: 'You trip over your own feet, and the music turns mocking. One of you leaves the ring feeling decades older.', curse: { id: 'c_weary', who: 'random' } } },
        { label: 'Eat one of the toadstools', check: { skill: 'endurance', dc: 'moderate' },
          success: { text: 'It tastes of earth and thunder. Whoever ate it feels like they could march for a week.', boon: { id: 'b_iron', who: 'checker' } },
          fail: { text: 'It tastes of earth and regret. A long, unpleasant hour follows.', damage: { who: 'checker', amt: 8 } } },
        { label: 'Back away slowly', outcome: { text: 'The music follows you for a while, sulking.' } },
      ],
    },
    sergeant: {
      title: 'The Old Sergeant', icon: '🎖',
      text: 'A grey-bearded veteran sits outside a waystation, polishing a dented helm. "You lot look green. For forty gold I\'ll drill one of you till they stop telegraphing every swing."',
      choices: [
        { label: 'Pay 40 gold for a day of drills', cost: { gold: 40 },
          outcome: { text: 'Sweat, shouting and bruises. By sunset one of you moves like a soldier.', boon: { id: 'b_drilled', who: 'undrilled' } } },
        { label: 'Swap war stories', check: { skill: 'history', dc: 'easy' },
          success: { text: 'He laughs until he cries, then tells you three things about fighting that every book leaves out.', xp: 1 },
          fail: { text: 'He nods politely through your stories and then tells his own, which are better.' } },
        { label: 'Wave and move on', outcome: { text: '"Keep your guard up!" he calls after you.' } },
      ],
    },
    knight: {
      title: 'The Wounded Knight', icon: '🩸',
      text: 'A knight in a tattered tabard lies against a milestone, an arrow through his side and a fine suit of armor going rusty in the rain.',
      choices: [
        { label: 'Tend his wounds', check: { skill: 'heal', dc: 'moderate' },
          success: { text: '"I\'ll not need this where I\'m going," he says, pressing his armor on you once he can stand. "Home. Finally."', gear: { slot: 'armor' } },
          fail: { text: 'You do what you can. It isn\'t enough. You bury him by the milestone.' } },
        { label: 'Take his armor', outcome: { text: 'He is too weak to stop you. That night one of you dreams of a knight standing at the foot of their bedroll, watching.', gear: { slot: 'armor' }, curse: { id: 'c_frail', who: 'random' } } },
        { label: 'Leave him to his fate', outcome: { text: 'You leave him your waterskin. It is something.' } },
      ],
    },
    tower: {
      title: 'The Burned Tower', icon: '🗼',
      text: 'A wizard\'s tower, gutted by fire. Scorched books lie open in the ash, and here and there something still glints.',
      choices: [
        { label: 'Study the scorched tomes', check: { skill: 'arcana', dc: 'moderate' },
          success: { text: 'Between the burned pages you find the wizard\'s notes on a hidden cache, and in the cache, something enchanted.', gear: { slot: 'trinket' } },
          fail: { text: 'You read one word aloud. The word reads you back. A burst of wild magic scorches the whole party.', damage: { who: 'all', amt: 5 } } },
        { label: 'Search the rubble', check: { skill: 'perception', dc: 'easy' },
          success: { text: 'A sharp eye turns up a pair of unbroken bottles in the cellar.', item: 2 },
          fail: { text: 'You find one intact bottle, and a lot of soot.', item: 1 } },
        { label: 'Leave the ashes alone', outcome: { text: 'Some fires are best left out.' } },
      ],
    },
    dice: {
      title: 'Dice by the Fire', icon: '🎲',
      text: 'Three dwarf caravaneers rattle bone dice around a fire. "Fancy a throw? Twenty-five gold to play. Double if you beat the house."',
      choices: [
        { label: 'Bet 25 gold', cost: { gold: 25 },
          luck: [{ p: 0.45, out: { text: 'Boxcars! The dwarves groan and pay up.', gold: 50 } }, { p: 0.55, out: { text: 'Snake eyes. The dwarves are very gracious winners.' } }] },
        { label: 'Play with a little help', check: { skill: 'bluff', dc: 'hard' },
          success: { text: 'Loaded dice, a winning smile, and a pile of gold. They suspect nothing.', gold: 55 },
          fail: { text: 'One dwarf catches the switch. You are thrown out with a black eye and a lighter purse.', gold: -20, damage: { who: 'checker', amt: 5 } } },
        { label: 'Just warm your hands', outcome: { text: 'The fire is free, and so is the company.' } },
      ],
    },
    ambush: {
      title: 'Too Quiet', icon: '👣',
      text: 'The birds have stopped singing. Fresh tracks cross the path and vanish into the brush. Someone is waiting up ahead.',
      choices: [
        { label: 'Sneak around them', check: { skill: 'stealth', dc: 'moderate' },
          success: { text: 'You slip past unseen, and lift a purse from their unattended camp on the way.', gold: 25 },
          fail: { text: 'A twig snaps. Shouts go up. Here they come!', fight: { kind: 'combat' } } },
        { label: 'Strike first', outcome: { text: 'You spread out and charge into their hiding place. Better them surprised than you.', fight: { kind: 'combat', first: true } } },
        { label: 'Take the long way round', outcome: { text: 'Three hours of brambles later, you are back on the road, scratched and sour, but nobody had to bleed.', damage: { who: 'all', amt: 2 } } },
      ],
    },
    witch: {
      title: 'The Hedge Witch', icon: '🧙',
      text: 'A cottage with chicken-foot stilts squats beside the road. A woman with a pipe and a great many cats looks you over. "Hurt, cursed, or just lost? I can fix the first two."',
      choices: [
        { label: 'Buy a remedy (30 gold)', cost: { gold: 30 }, need: hurt, needText: 'Nobody is hurt',
          outcome: { text: 'Her tea tastes of moss and pennies. Every wound closes.', heal: { who: 'all', amt: 'full' } } },
        { label: 'Have her lift a curse (40 gold)', cost: { gold: 40 }, need: hasCurse, needText: 'Nobody is cursed',
          outcome: { text: 'She spits, mutters, and plucks something dark out of the air like a thread. "There. Don\'t do it again."', removeCurses: true } },
        { label: 'Trade her an item for a charm', need: hasPackItem, needText: 'Needs an item in a pack',
          outcome: { text: 'She sniffs the item, pockets it, and ties a knotted string around one of your wrists. "For heartiness."', loseItem: 1, boon: { id: 'b_vigor', who: 'random' } } },
        { label: 'Politely decline', outcome: { text: 'The cats watch you leave.' } },
      ],
    },
    pilgrims: {
      title: 'Lost Pilgrims', icon: '🕯',
      text: 'A dozen pilgrims huddle under a shrine-roof, their guide run off in the night. "Please. The road ahead is not safe. Could you at least tell us the way?"',
      choices: [
        { label: 'Calm them and guide them', check: { skill: 'diplomacy', dc: 'moderate' },
          success: { text: 'They sing as they walk, and when you part, they press a purse and their prayers on you.', gold: 30, boon: { id: 'b_blessed', who: 'random' } },
          fail: { text: 'They argue about the route the whole way. You arrive late, hoarse, and slightly richer.', gold: 10 } },
        { label: 'Read the stars for them', check: { skill: 'nature', dc: 'easy' },
          success: { text: 'You point the way true. A grateful pilgrim gives you a healing draught.', item: 1 },
          fail: { text: 'You point the way. Possibly true. They thank you anyway.' } },
        { label: 'Wish them luck', outcome: { text: 'You hope they make it.' } },
      ],
    },
  };
})();
if (typeof module !== 'undefined') module.exports = G;
