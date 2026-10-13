'use client';

import StationView from './StationView';
import { installFeatures } from './features';

/** The station with every feature installed. */
export default function Station() {
  return <StationView setup={installFeatures} />;
}
