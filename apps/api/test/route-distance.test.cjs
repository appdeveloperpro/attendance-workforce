const assert = require('node:assert/strict');
const { test } = require('node:test');
const { routeDistance } = require('../dist/route-distance.js');

test('calculates the distance between reasonable GPS points', () => {
  const points = [
    { latitude: 0, longitude: 0, accuracy: 10, capturedAt: new Date(0) },
    { latitude: 0, longitude: 0.001, accuracy: 10, capturedAt: new Date(60_000) },
  ];

  assert.equal(routeDistance(points), 111);
});

test('does not connect route points across poor-accuracy samples', () => {
  const points = [
    { latitude: 0, longitude: 0, accuracy: 10, capturedAt: new Date(0) },
    { latitude: 0, longitude: 0.001, accuracy: 101, capturedAt: new Date(60_000) },
    { latitude: 0, longitude: 0.002, accuracy: 10, capturedAt: new Date(120_000) },
    { latitude: 0, longitude: 0.003, accuracy: 10, capturedAt: new Date(180_000) },
  ];

  assert.equal(routeDistance(points), 111);
});

test('omits implausible jumps while continuing from the latest point', () => {
  const points = [
    { latitude: 0, longitude: 0, accuracy: 10, capturedAt: new Date(0) },
    { latitude: 0, longitude: 1, accuracy: 10, capturedAt: new Date(60_000) },
    { latitude: 0, longitude: 1.001, accuracy: 10, capturedAt: new Date(120_000) },
  ];

  assert.equal(routeDistance(points), 111);
});
