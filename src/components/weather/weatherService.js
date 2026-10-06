// Thin wrapper around the OpenWeather "current weather" endpoint.
// The API key is read from an env var at build time (Vite exposes only
// VITE_-prefixed vars to the client) and is NEVER hard-coded here.
//
// If the key is missing, the request fails, or it times out, callers get a
// clearly-flagged simulated reading instead of a crash.

const API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY
const ENDPOINT = 'https://api.openweathermap.org/data/2.5/weather'
const TIMEOUT_MS = 8000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

// A small, station-appropriate simulated reading used whenever the live
// API isn't available. Clearly marked `source: 'simulated'` so the UI can
// label it honestly.
function simulatedWeather(stationId) {
  const presets = {
    maitri: { tempC: -18, feelsLikeC: -26, condition: 'Clear', humidity: 58, windKmh: 24, windDeg: 210, pressureHpa: 985, visibilityKm: 8.4 },
    bharati: { tempC: -9, feelsLikeC: -15, condition: 'Overcast', humidity: 64, windKmh: 31, windDeg: 260, pressureHpa: 978, visibilityKm: 6.1 },
  }
  const preset = presets[stationId] || presets.maitri
  return {
    ...preset,
    sunrise: null,
    sunset: null,
    source: 'simulated',
    fetchedAt: new Date(),
  }
}

export async function fetchStationWeather(stationId, { lat, lon }) {
  if (!API_KEY) {
    return { ok: false, reason: 'missing-key', data: simulatedWeather(stationId) }
  }

  try {
    const url = `${ENDPOINT}?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`
    const res = await withTimeout(fetch(url), TIMEOUT_MS)
    if (!res.ok) {
      return { ok: false, reason: `http-${res.status}`, data: simulatedWeather(stationId) }
    }
    const json = await res.json()
    return {
      ok: true,
      data: {
        tempC: json.main?.temp,
        feelsLikeC: json.main?.feels_like,
        condition: json.weather?.[0]?.main || '—',
        humidity: json.main?.humidity,
        windKmh: json.wind?.speed != null ? Number((json.wind.speed * 3.6).toFixed(1)) : null,
        windDeg: json.wind?.deg,
        pressureHpa: json.main?.pressure,
        visibilityKm: json.visibility != null ? Number((json.visibility / 1000).toFixed(1)) : null,
        sunrise: json.sys?.sunrise ? new Date(json.sys.sunrise * 1000) : null,
        sunset: json.sys?.sunset ? new Date(json.sys.sunset * 1000) : null,
        source: 'live',
        fetchedAt: new Date(),
      },
    }
  } catch (err) {
    return { ok: false, reason: err.message || 'error', data: simulatedWeather(stationId) }
  }
}
