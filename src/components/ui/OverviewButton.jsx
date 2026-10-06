export default function OverviewButton({ visible, onClick }) {
  if (!visible) return null
  return (
    <button
      onClick={onClick}
      className="absolute top-16 left-1/2 -translate-x-1/2 z-30 glass glow-border rounded-lg px-3 py-2 text-xs text-ice-100 hover:border-ice-accent/50 transition-colors flex items-center gap-2"
    >
      ↩ OVERVIEW
    </button>
  )
}
