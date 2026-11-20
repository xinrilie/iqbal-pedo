const progressRank = {
  queued: 0,
  in_preparation: 1,
  ready: 2,
  served: 3
};

export function deriveTicketStatus(currentStatus, counts) {
  const activeCount = Number(counts.activeCount);
  const servedCount = Number(counts.servedCount);
  const readyCount = Number(counts.readyCount);
  const preparingCount = Number(counts.preparingCount);

  if (activeCount === 0) return 'cancelled';

  let derived;
  if (servedCount === activeCount) derived = 'served';
  else if (readyCount === activeCount) derived = 'ready';
  else if (preparingCount > 0 || readyCount > 0) derived = 'in_preparation';
  else derived = 'queued';

  // Item cancellation can make the remaining set look less advanced, but a
  // ticket's lifecycle is monotonic: never move an already-started ticket back.
  if (currentStatus === 'cancelled') return 'cancelled';
  if (progressRank[currentStatus] > progressRank[derived]) return currentStatus;
  return derived;
}
