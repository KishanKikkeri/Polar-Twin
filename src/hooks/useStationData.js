import ElectricityPanel from '../components/dashboard/panels/ElectricityPanel.jsx'
import FuelPanel from '../components/dashboard/panels/FuelPanel.jsx'
import WaterPanel from '../components/dashboard/panels/WaterPanel.jsx'
import HeatingPanel from '../components/dashboard/panels/HeatingPanel.jsx'
import LaboratoryPanel from '../components/dashboard/panels/LaboratoryPanel.jsx'
import MainBuildingPanel from '../components/dashboard/panels/MainBuildingPanel.jsx'
import WastePanel from '../components/dashboard/panels/WastePanel.jsx'
import CommunicationPanel from '../components/dashboard/panels/CommunicationPanel.jsx'

// Maps a stationObject.dashboardType to the panel component that renders it.
export const dashboardRegistry = {
  electricity: ElectricityPanel,
  fuel: FuelPanel,
  water: WaterPanel,
  heating: HeatingPanel,
  laboratory: LaboratoryPanel,
  'main-building': MainBuildingPanel,
  waste: WastePanel,
  communication: CommunicationPanel,
}

export function getPanelComponent(dashboardType) {
  return dashboardRegistry[dashboardType] || MainBuildingPanel
}
