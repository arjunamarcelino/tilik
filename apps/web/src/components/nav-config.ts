import type { NavItem } from './nav-links';

/** Primary nav. Import is admin-only — omitted (not disabled) for reviewers. */
export function navItemsFor(isAdmin: boolean): NavItem[] {
  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/cases', label: 'Cases' },
  ];
  if (isAdmin) items.push({ href: '/import', label: 'Import' });
  return items;
}
