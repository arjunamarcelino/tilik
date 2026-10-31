import { redirect } from 'next/navigation';

// The portal has no public landing — route into the app (proxy bounces unauthenticated users to /login).
export default function Home() {
  redirect('/dashboard');
}
