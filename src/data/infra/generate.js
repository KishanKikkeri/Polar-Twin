// Small seeded pseudo-random generator so each station gets a distinct but
// stable (non-flickering-on-rerender) simulated dataset.
function seededRandom(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h) || 1
}

// Generates a labelled series around `base`, wiggling by +/- variancePct.
export function buildSeries(labels, base, variancePct, seedKey) {
  const rand = seededRandom(hashString(seedKey))
  return labels.map((label) => {
    const wiggle = (rand() - 0.5) * 2 * variancePct
    const value = Math.max(0, base * (1 + wiggle))
    return { label, value: Number(value.toFixed(1)) }
  })
}

export function pick(rand, min, max) {
  return min + rand() * (max - min)
}

export function makeRand(seedKey) {
  return seededRandom(hashString(seedKey))
}
