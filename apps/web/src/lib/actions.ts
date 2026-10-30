'use server';

import { redirect } from 'next/navigation';
import { deleteSession } from './session';

/**
 * User-initiated logout. A POST Server Action inherits Next's Origin/CSRF check and works without JS;
 * the top-bar logout button submits this. (The GET /logout route exists only as the render-path landing
 * for the DAL's mid-render 401.)
 */
export async function logout(): Promise<void> {
  await deleteSession();
  redirect('/login');
}
