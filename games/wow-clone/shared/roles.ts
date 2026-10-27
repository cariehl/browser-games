// The three raid roles. Step 2 attaches one class (abilities, stats) to each.

export const ROLES = ['tank', 'healer', 'dps'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, { label: string; color: number }> = {
  tank: { label: 'Tank', color: 0x4a7bd1 },
  healer: { label: 'Healer', color: 0x3fbf6a },
  dps: { label: 'DPS', color: 0xd1543f },
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
