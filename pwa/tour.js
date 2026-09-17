export function resolveTourClick({ action, clickedBackdrop } = {}) {
  if (action === 'tour-next') return 'next';
  if (action === 'tour-skip') return 'skip';
  if (clickedBackdrop) return 'skip';
  return null;
}

export function applyTourNav(step, length, nav) {
  if (nav === 'start') return { step: 0, finished: false };
  if (nav === 'skip') return { step: null, finished: true };
  if (nav === 'next') {
    const n = Number(step);
    if (!Number.isFinite(n) || n >= Number(length) - 1) return { step: null, finished: true };
    return { step: n + 1, finished: false };
  }
  return { step, finished: false };
}
