import type { NetworkContext } from './connectionsStore';
import type { ImportSummary } from './linkedinExport';
import type { RankedRow } from './search';
import type { RankingFeedback } from './telemetry';

type Row = Record<string, unknown>;
export type ResultItem = { row: RankedRow; id: string; legacyId: string };
export type ResultSet = { main: ResultItem[]; irrelevant: ResultItem[] };
export type SearchSnapshot = {
  criteria: string;
  strictTitleOnly: boolean;
  results: ResultSet;
  resultsQuery: string;
  rankedCount: number;
  selectedId: string;
  tab: 'results' | 'saved-people' | 'saved-searches';
  rows: Row[];
  context: NetworkContext | null;
  columns: string[];
  fileName: string;
  importSummary: ImportSummary | null;
  feedback: Record<string, RankingFeedback>;
  ordering: { ordered: ResultItem[]; extras: ResultItem[]; note: string; query: string } | null;
};
let visit: { uid: string; snapshot: SearchSnapshot } | null = null;
export const readSearchSession = (uid: string | null) => (visit?.uid === uid ? visit.snapshot : null);
export function saveSearchSession(uid: string, snapshot: SearchSnapshot) {
  visit = { uid, snapshot };
}
export function clearSearchSession() {
  visit = null;
}
export function datasetChanged() {
  clearSearchSession();
  window.dispatchEvent(new Event('ncrp-dataset-changed'));
}
if (typeof window !== 'undefined') {
  window.addEventListener('ncrp-sign-out', clearSearchSession);
  window.addEventListener('ncrp-dataset-changed', clearSearchSession);
}
