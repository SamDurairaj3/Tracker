import { redirect } from 'next/navigation';

/**
 * Keeps the application entry point focused on the active management surface.
 */
export default function Home() {
  redirect('/management');
}
