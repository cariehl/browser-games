// Consumable items: potions, throwables and field gear a hero carries in their pack.
// Each `power` uses the same shape as a class power; the engine turns it into a one-use power
// (kind 'item') on whoever carries it. Item attacks roll d20 + the item's bonus + the user's level,
// with no ability modifier. The table holds no battle state, so an inventory can reuse it.
// Mechanics follow the generic shape of 4th-edition-style consumables; all names and text are original.
var G = (typeof G !== 'undefined') ? G : {};
(function () {
  const burst = (o) => Object.assign({ action: 'standard', tgt: 'areaBurst', size: 1, range: 10 }, o);

  G.Items = {
    // ---- potions (minor action, Personal) ----
    redroot: {
      name: 'Redroot Draught', icon: '🧪', cat: 'potion',
      flavor: 'Bitter, warm, and faintly peppery. It knits torn flesh in a heartbeat.',
      power: { action: 'minor', tgt: 'self', eff: [{ on: 'self', t: 'heal', surge: true, flat: 10 }], text: 'Spend a healing surge, but regain 10 HP instead of your surge value.' },
    },
    barkskin: {
      name: 'Oakhide Tonic', icon: '🌰', cat: 'potion',
      flavor: 'Your skin creaks and toughens like old bark.',
      power: {
        action: 'minor', tgt: 'self',
        eff: [{ on: 'self', t: 'temp', amt: (B, u) => 5 + Math.floor(u.level / 2) }, { on: 'self', t: 'cond', c: 'defBonus', amt: 2, label: '+2 defenses' }],
        text: 'Gain 5 + half your level temporary HP and +2 to all defenses until the end of your next turn.',
      },
    },
    clarity: {
      name: 'Clearwater Vial', icon: '💧', cat: 'potion',
      flavor: 'Cold as a mountain spring. The fog lifts and the burning fades.',
      power: { action: 'minor', tgt: 'self', eff: [{ on: 'self', t: 'save', all: true, bonus: 2 }, { on: 'self', t: 'temp', amt: 3 }], text: 'Make a saving throw at +2 against every save-ends effect on you, then gain 3 temporary HP.' },
    },
    quickstep: {
      name: 'Harefoot Philter', icon: '🐇', cat: 'potion',
      flavor: 'Your heart skips and your legs itch to run.',
      power: { action: 'minor', tgt: 'self', eff: [{ on: 'self', t: 'cond', c: 'speedBonus', amt: 2, label: '+2 speed' }], text: 'Gain +2 speed until the end of your next turn.' },
    },
    // ---- throwables (standard action) ----
    fireflask: {
      name: 'Emberflask', icon: '🔥', cat: 'throwable',
      flavor: 'A clay jar of sticky lamp oil with a smouldering wick.',
      power: burst({ atk: { vs: 'Ref', bonus: 3 }, dmg: '1d6', dtype: 'fire', hit: [{ t: 'ongoing', amt: 2, dtype: 'fire' }], miss: 'half', text: 'Shatters in a sheet of flame: fire damage and burning (ongoing 2 fire, save ends) to every enemy in the burst. Half damage on a miss.' }),
    },
    thunderstone: {
      name: 'Clapstone', icon: '🪨', cat: 'throwable',
      flavor: 'A rune-scratched pebble that bursts with a deafening crack.',
      power: burst({ atk: { vs: 'Fort', bonus: 3 }, dmg: '1d6', dtype: 'thunder', hit: [{ t: 'push', n: 1 }], text: 'A thunderclap knocks every enemy in the burst back 1 hex.' }),
    },
    frostvial: {
      name: 'Rimeglass Vial', icon: '❄', cat: 'throwable',
      flavor: 'Thin glass beaded with frost, cold enough to sting the fingers.',
      power: burst({ atk: { vs: 'Fort', bonus: 3 }, dmg: '1d6', dtype: 'cold', hit: [{ t: 'cond', c: 'slowed' }], text: 'Bursts into biting frost that leaves every enemy in the burst slowed until the end of your next turn.' }),
    },
    snare: {
      name: 'Tanglecord Pouch', icon: '🪢', cat: 'throwable',
      flavor: 'A leather pouch of weighted cords that wrap around legs.',
      power: { action: 'standard', tgt: 'ranged', range: 10, atk: { vs: 'Ref', bonus: 3 }, hit: [{ t: 'cond', c: 'immobilized', dur: 'save' }], text: 'Tangles one enemy: immobilized (save ends).' },
    },
    dustpellet: {
      name: 'Gloomdust Pellet', icon: '💨', cat: 'throwable',
      flavor: 'A wax ball packed with stinging grey powder.',
      power: { action: 'standard', tgt: 'ranged', range: 5, atk: { vs: 'Fort', bonus: 3 }, hit: [{ t: 'cond', c: 'blinded' }], text: 'Bursts in one enemy\'s face: blinded until the end of your next turn.' },
    },
    // ---- field gear ----
    dressing: {
      name: 'Field Dressing', icon: '🩹', cat: 'gear',
      flavor: 'Clean linen, a pot of honey salve and a strip of willow bark.',
      power: { action: 'standard', tgt: 'ranged', range: 1, targets: 'allyOrSelf', hit: [{ t: 'heal', surge: true, revive: true }], text: 'Bind your own wounds or an adjacent ally\'s: they spend a healing surge. Brings a dying ally back to their feet even with no surges left.' },
    },
  };
})();
if (typeof module !== 'undefined') module.exports = G;
