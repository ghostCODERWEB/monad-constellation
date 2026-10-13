import { redirect } from 'next/navigation';

// The station moved to the home page.
export default function StationPage() {
  redirect('/');
}
