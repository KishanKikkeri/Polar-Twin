import { buildSeries, makeRand, pick } from './generate.js'

const HOURS = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']

// Station-specific baseline figures. These reflect roughly the differences
// in scale between Maitri (larger year-round crew/footprint) and Bharati
// (more compact, container-based build) — all still SIMULATED operational
// numbers, not live sensor feeds.
const STATION_SCALE = {
  maitri: { crew: 25, elecPeak: 517, elecLoad: 82, elecEff: 91.4, fuelTank: 450, fuelLevel: 326, fuelRate: 1.8, waterTank: 60000, waterLevelPct: 84, heatRooms: 42 },
  bharati: { crew: 34, elecPeak: 430, elecLoad: 68, elecEff: 89.1, fuelTank: 340, fuelLevel: 214, fuelRate: 1.5, waterTank: 42000, waterLevelPct: 76, heatRooms: 30 },
}

function scale(stationId) {
  return STATION_SCALE[stationId] || STATION_SCALE.maitri
}

export function getElectricityData(stationId) {
  const s = scale(stationId)
  const rand = makeRand(`${stationId}-elec`)
  return {
    base: {
      status: 'NORMAL',
      currentLoadKw: s.elecLoad,
      todayKwh: Math.round(s.elecLoad * 5.2),
      weekKwh: Math.round(s.elecLoad * 5.2 * 6.9),
      monthKwh: Math.round(s.elecLoad * 5.2 * 29.5),
      peakLoadKw: s.elecPeak,
      efficiency: s.elecEff,
      voltage: 415,
      frequency: 50.0,
      generators: [
        { id: 'DG-1', status: 'RUNNING', load: Math.round(pick(rand, 45, 65)) },
        { id: 'DG-2', status: pick(rand, 0, 1) > 0.5 ? 'STANDBY' : 'RUNNING', load: Math.round(pick(rand, 0, 20)) },
        { id: 'DG-3', status: 'RUNNING', load: Math.round(pick(rand, 25, 45)) },
      ],
    },
    hourly: buildSeries(HOURS, s.elecLoad * 0.28, 0.35, `${stationId}-elec-hourly`),
    daily: buildSeries(DAYS, s.elecLoad * 5.2, 0.08, `${stationId}-elec-daily`),
    monthly: buildSeries(MONTHS, s.elecLoad * 5.2 * 29.5, 0.06, `${stationId}-elec-monthly`),
  }
}

export function getFuelData(stationId) {
  const s = scale(stationId)
  const rand = makeRand(`${stationId}-fuel`)
  return {
    base: {
      status: 'NORMAL',
      tankCapacityKl: s.fuelTank,
      currentLevelKl: s.fuelLevel,
      todayUsageKl: s.fuelRate,
      weekUsageKl: Number((s.fuelRate * 7).toFixed(1)),
      monthUsageKl: Number((s.fuelRate * 30).toFixed(1)),
      consumptionRateKlPerDay: s.fuelRate,
      tanks: [
        { id: 'Tank A', pct: Math.round(pick(rand, 60, 90)) },
        { id: 'Tank B', pct: Math.round(pick(rand, 55, 85)) },
        { id: 'Tank C', pct: Math.round(pick(rand, 65, 95)) },
      ],
    },
    weekly: buildSeries(DAYS, s.fuelRate, 0.15, `${stationId}-fuel-weekly`),
    monthly: buildSeries(MONTHS, s.fuelRate * 30, 0.07, `${stationId}-fuel-monthly`),
  }
}

export function getWaterData(stationId) {
  const s = scale(stationId)
  const dailyL = Math.round(s.crew * 150)
  return {
    base: {
      status: 'NORMAL',
      tankLevelPct: s.waterLevelPct,
      storageCapacityL: s.waterTank,
      todayL: dailyL,
      weekL: dailyL * 7,
      monthL: dailyL * 30,
      pumpStatus: 'RUNNING',
      flowRateLpm: Math.round(s.crew * 1.6),
      purificationStatus: 'ACTIVE',
    },
    daily: buildSeries(DAYS, dailyL, 0.06, `${stationId}-water-daily`),
    monthly: buildSeries(MONTHS, dailyL * 30, 0.05, `${stationId}-water-monthly`),
  }
}

export function getHeatingData(stationId) {
  const s = scale(stationId)
  const rand = makeRand(`${stationId}-heat`)
  return {
    base: {
      status: 'NORMAL',
      currentTempC: Number(pick(rand, 20.5, 21.8).toFixed(1)),
      targetTempC: 22,
      loadPct: Math.round(pick(rand, 60, 75)),
      systemStatus: 'ACTIVE',
      fuelUsedTodayKl: Number((s.fuelRate * 0.33).toFixed(2)),
      efficiency: Number(pick(rand, 86, 91).toFixed(1)),
      roomsHeated: s.heatRooms,
    },
    trend: HOURS.filter((_, i) => i % 2 === 0).map((label, i) => ({
      label,
      tempC: Number(pick(rand, 20.4, 21.9).toFixed(1)),
      outsideC: Number(pick(rand, -20, -16.5).toFixed(1)),
    })),
  }
}

export function getLaboratoryData(stationId) {
  const s = scale(stationId)
  const rand = makeRand(`${stationId}-lab`)
  return {
    status: 'NORMAL',
    occupancy: Math.round(pick(rand, 2, 6)),
    activeEquipment: Math.round(pick(rand, 7, 14)),
    electricityKw: Number(pick(rand, 4, 8).toFixed(1)),
    temperatureC: Number(pick(rand, 19.5, 21).toFixed(1)),
    humidityPct: Math.round(pick(rand, 32, 42)),
    airQuality: 'GOOD',
    crew: s.crew,
  }
}

export function getMainBuildingData(stationId) {
  const s = scale(stationId)
  const rand = makeRand(`${stationId}-main`)
  return {
    status: 'NORMAL',
    occupancy: s.crew,
    electricityKw: Number((s.elecLoad * 0.42).toFixed(1)),
    heatingLoadPct: Math.round(pick(rand, 60, 76)),
    waterL: Math.round(s.crew * 90),
    temperatureC: Number(pick(rand, 20.5, 21.8).toFixed(1)),
    airQuality: 'GOOD',
    emergencyStatus: 'CLEAR',
  }
}

export function getWasteData(stationId) {
  const s = scale(stationId)
  const rand = makeRand(`${stationId}-waste`)
  const generated = Math.round(s.crew * 2.4)
  return {
    status: 'NORMAL',
    generatedTodayKg: generated,
    processedTodayKg: Math.round(generated * pick(rand, 0.85, 0.96)),
    storageCapacityPct: Math.round(pick(rand, 25, 45)),
    incineratorStatus: stationId === 'bharati' ? 'N/A — treaty-restricted' : 'ACTIVE',
    recyclingStatus: 'IN PROGRESS',
  }
}

export function getCommunicationData(stationId) {
  const rand = makeRand(`${stationId}-comms`)
  return {
    status: 'NORMAL',
    satelliteLink: 'STABLE',
    networkStatus: 'ONLINE',
    bandwidthMbps: Number(pick(rand, 12, 22).toFixed(1)),
    latencyMs: Math.round(pick(rand, 520, 720)),
    uptimePct: Number(pick(rand, 97.5, 99.6).toFixed(1)),
  }
}

export function getInfraBundle(stationId, dashboardType) {
  switch (dashboardType) {
    case 'electricity':
      return getElectricityData(stationId)
    case 'fuel':
      return getFuelData(stationId)
    case 'water':
      return getWaterData(stationId)
    case 'heating':
      return getHeatingData(stationId)
    case 'laboratory':
      return getLaboratoryData(stationId)
    case 'waste':
      return getWasteData(stationId)
    case 'communication':
      return getCommunicationData(stationId)
    case 'main-building':
    default:
      return getMainBuildingData(stationId)
  }
}
