"""Phase 4A living Digital Twin runtime.

Pipeline::

    Simulator (causal model, deterministic)          [station edge]
        -> TelemetryEvent -> EdgePublisher (store-and-forward buffer, reconnect)
        -> Transport (in-memory broker | MQTT)        [link]
        -> Normalizer -> IngestionPipeline (validate, dedupe, order, timeliness)   [HQ]
        -> TelemetrySink (DB) + RuntimeChannelState
        -> GapDetector -> DependencyGraph evaluation -> AlertEngine -> events
"""
