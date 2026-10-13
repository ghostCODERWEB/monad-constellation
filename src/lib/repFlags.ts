// Shared by the server (which scores) and the page (which explains scores).
export const FLAG = {
  SMART: 1, FUND: 2, WHALE: 4, NAMED: 8, TRADER: 16, PROFITABLE: 32, INSIDER: 64, FUNDER: 128,
} as const;

export const FLAG_NAMES: [number, string][] = [
  [FLAG.SMART, 'Smart trader'], [FLAG.FUND, 'Fund'], [FLAG.WHALE, 'Whale'], [FLAG.NAMED, 'Named'],
  [FLAG.TRADER, 'Active trader'], [FLAG.PROFITABLE, 'Profitable'], [FLAG.INSIDER, 'Insider cluster'], [FLAG.FUNDER, 'Cluster funder'],
];

export type Tier = 'Proven' | 'Trusted' | 'Known' | 'Unproven' | 'Insider-linked';

export interface Reputation {
  address: string;
  star: number;
  score: number;
  flags: number;
  tier: Tier;
  parts: { base: number; profit: number; labels: number; breadth: number; size: number; insider: number };
}

export interface ReputationSet {
  builtAt: string;
  methodology: string;
  /** keccak256 of "address,score,flags" lines, sorted: the epoch's dataset hash. */
  datasetHash: string;
  wallets: Reputation[];
  stats: { scored: number; skipped: number; proven: number; trusted: number; insiders: number };
}
