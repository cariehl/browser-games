// The three raid roles. Each has one class: see shared/classes.js.

export const ROLES = ['tank', 'healer', 'dps'];

export const ROLE_INFO = {
  tank: { label: 'Tank', color: 0x4a7bd1 },
  healer: { label: 'Healer', color: 0x3fbf6a },
  dps: { label: 'DPS', color: 0xd1543f },
};

export function isRole(value) {
  return ROLES.includes(value);
}

/** A role's color as CSS hex, grey for anything unknown. */
export function roleCss(role) {
  return `#${(ROLE_INFO[role]?.color ?? 0x888888).toString(16).padStart(6, '0')}`;
}
