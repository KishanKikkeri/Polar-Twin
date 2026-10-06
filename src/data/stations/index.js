import { maitriMeta, maitriObjects, maitriRoadPaths, maitriAlerts, maitriTerrain } from './maitri.js'
import { bharatiMeta, bharatiObjects, bharatiRoadPaths, bharatiAlerts, bharatiTerrain } from './bharati.js'

// Central registry so adding a future station (e.g. Dakshin Gangotri) only
// requires a new data/stations/<name>.js file plus one line here.
export const stations = [
  { meta: maitriMeta, objects: maitriObjects, roadPaths: maitriRoadPaths, alerts: maitriAlerts, terrain: maitriTerrain },
  { meta: bharatiMeta, objects: bharatiObjects, roadPaths: bharatiRoadPaths, alerts: bharatiAlerts, terrain: bharatiTerrain },
]

export function getStation(id) {
  return stations.find((s) => s.meta.id === id) || null
}

export const stationList = stations.map((s) => s.meta)
