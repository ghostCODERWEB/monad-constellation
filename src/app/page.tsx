'use client';

import dynamic from 'next/dynamic';
import './station.css';

// Home is the station; the galaxy lives at /galaxy.
const Station = dynamic(() => import('@/station/Station'), { ssr: false, loading: () => <div className="st-loading">Pressurising the station…</div> });

export default function Home() {
  return <Station />;
}
