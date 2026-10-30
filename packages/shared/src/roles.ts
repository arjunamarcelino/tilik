import { Role } from './enums';

/**
 * Single source of truth for the role hierarchy: ADMIN ⊇ REVIEWER. Both the API's RolesGuard and the
 * web portal's DAL consume this so the rule lives in exactly one place (the repo's enum-SoT discipline,
 * applied to the ordering too). Exhaustively keyed over the finite Role union — the lookup is never
 * `undefined`, and adding a role forces this map to be updated (a compile error otherwise).
 */
const RANK: Record<Role, number> = {
  [Role.REVIEWER]: 1,
  [Role.ADMIN]: 2,
};

/** True when `have` meets or exceeds the `need` role in the hierarchy (ADMIN satisfies a REVIEWER gate). */
export function roleSatisfies(have: Role, need: Role): boolean {
  return RANK[have] >= RANK[need];
}
