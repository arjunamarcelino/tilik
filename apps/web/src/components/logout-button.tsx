import { logout } from '@/lib/actions';

/** POST Server Action (not a link) — inherits Next's Origin/CSRF check and works without JS. */
export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
      >
        Log out
      </button>
    </form>
  );
}
