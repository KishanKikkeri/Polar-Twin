// Unified Production Pipeline:
// 4A Runtime (FastAPI backend)
//      ↓
// Telemetry / Twin State
//      ↓
// 4B Intelligence (ML & physics models)
//      ↓
// 4C Decision (Copilot, What-If, Replay, Emergency Mode, Station Comparison)
//      ↓
// React Operator UI

import { readEnvBaseUrl, resolveBaseUrl } from '../api/client.js'
import {
  createHttpTwinProvider,
  createLivePredictionProvider,
  createMockTwinProvider,
} from '../../decision/adapters.js'
import { createIntelligenceService } from '../../intelligence/service.js'
import { createCopilot } from '../../decision/copilot.js'
import { runScenario } from '../../decision/scenarioEngine.js'
import { buildEmergencyView, compareStations } from '../../decision/emergency.js'
import { createReplay } from '../../decision/replay.js'

let _pipelineInstance = null

export function getProductionPipeline({ baseUrl, fallbackToMock = true } = {}) {
  if (_pipelineInstance && !baseUrl) return _pipelineInstance

  const resolvedUrl = resolveBaseUrl(baseUrl || readEnvBaseUrl())

  // 1. 4A Runtime Provider (HTTP directly to FastAPI backend)
  const twinProvider = createHttpTwinProvider({
    baseUrl: resolvedUrl,
    fallbackToMock,
    mock: createMockTwinProvider(),
  })

  // 2. 4B Intelligence Service wired to 4A Runtime
  const intelligence = createIntelligenceService({
    telemetry: twinProvider,
    twin: twinProvider,
  })

  // 3. 4C Live Prediction Provider bridging 4B into 4C decision engines
  const predictionProvider = createLivePredictionProvider(intelligence, {
    fallbackToMock,
  })

  // 4. Grounded Operations Copilot
  const copilot = createCopilot({
    twin: twinProvider,
    predictions: predictionProvider,
  })

  _pipelineInstance = {
    baseUrl: resolvedUrl,
    twin: twinProvider,
    intelligence,
    predictions: predictionProvider,
    copilot,

    // High-level operational engine methods
    async getStationState(stationId, opts = {}) {
      return twinProvider.getState(stationId, opts)
    },

    async askCopilot(question, { stationId, asOf } = {}) {
      return copilot.ask(question, { stationId, asOf })
    },

    async runWhatIf(stationId, scenario) {
      const state = await twinProvider.getState(stationId)
      return runScenario(state, scenario)
    },

    async getEmergencyPlan(stationId) {
      const state = await twinProvider.getState(stationId)
      return buildEmergencyView(state)
    },

    async getComparison(stationA = 'maitri', stationB = 'bharati') {
      const [stateA, stateB] = await Promise.all([
        twinProvider.getState(stationA).catch(() => null),
        twinProvider.getState(stationB).catch(() => null),
      ])
      return compareStations(stateA, stateB)
    },

    createReplaySession(stationId, { from, to, stepMs } = {}) {
      return createReplay({
        provider: twinProvider,
        stationId,
        from,
        to,
        stepMs,
      })
    },

    async getStationIntelligence(stationId, { asOf } = {}) {
      const [forecast, anomalies, maintenance, risk, recommendations] = await Promise.allSettled([
        intelligence.getForecast(stationId, { metric: 'demandKw', horizonH: 24, asOf }),
        intelligence.getAnomalies(stationId, { asOf }),
        intelligence.getMaintenance(stationId, { asOf }),
        intelligence.getRisk(stationId, { asOf }),
        intelligence.getRecommendations(stationId, { asOf }),
      ])

      return {
        stationId,
        forecast: forecast.status === 'fulfilled' ? forecast.value : null,
        anomalies: anomalies.status === 'fulfilled' ? anomalies.value : [],
        maintenance: maintenance.status === 'fulfilled' ? maintenance.value : [],
        risk: risk.status === 'fulfilled' ? risk.value : null,
        recommendations: recommendations.status === 'fulfilled' ? recommendations.value : [],
      }
    },
  }

  return _pipelineInstance
}

export const productionPipeline = getProductionPipeline()
