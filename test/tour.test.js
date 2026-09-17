import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTourClick, applyTourNav } from '../pwa/tour.js';

test('Skip and Next on the tour card resolve even when the card would stop bubbling', () => {
  assert.equal(resolveTourClick({ action: 'tour-next', clickedBackdrop: false }), 'next');
  assert.equal(resolveTourClick({ action: 'tour-skip', clickedBackdrop: false }), 'skip');
});

test('clicking dimmed area around the card skips; clicking the card body does not', () => {
  assert.equal(resolveTourClick({ action: null, clickedBackdrop: true }), 'skip');
  assert.equal(resolveTourClick({ action: null, clickedBackdrop: false }), null);
});

test('Next advances then finishes; Skip finishes immediately', () => {
  assert.deepEqual(applyTourNav(0, 5, 'next'), { step: 1, finished: false });
  assert.deepEqual(applyTourNav(4, 5, 'next'), { step: null, finished: true });
  assert.deepEqual(applyTourNav(2, 5, 'skip'), { step: null, finished: true });
  assert.deepEqual(applyTourNav(null, 5, 'start'), { step: 0, finished: false });
});
