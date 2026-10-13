'use client';

import dynamic from 'next/dynamic';
import './station.css';

const Station = dynamic(() => import('@/station/Station'), { ssr: false, loading: () => <div className="st-loading">Pressurising the station…</div> });

export default function StationPage() {
  return <Station />;
}
