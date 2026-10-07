"""Tests for edge store-and-forward buffering and MQTT abstraction."""

from datetime import UTC, datetime

from app.domain.enums import Provenance, Quality
from app.runtime.buffering import EdgeBuffer, ResilientPublisher
from app.runtime.mqtt import InMemoryBroker, MqttNormalizer, MqttTopic
from app.runtime.telemetry_event import TelemetryEvent


def test_edge_buffer_fifo_and_capacity():
    buf = EdgeBuffer(capacity=3)
    now = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)

    for i in range(5):
        buf.push(
            TelemetryEvent(
                event_id=f"ev-{i}",
                station_id="maitri",
                asset_id="maitri.aws-1",
                channel_id="maitri.aws-1.air_temp_c",
                metric="air_temp_c",
                unit="degC",
                observed_at=now,
                value=float(i),
            )
        )

    # Capacity was 3, so first 2 were dropped
    assert buf.size() == 3
    assert buf.dropped_count == 2

    # Draining yields oldest surviving items: 2, 3, 4
    drained = buf.drain(max_items=5)
    assert len(drained) == 3
    assert [e.event_id for e in drained] == ["ev-2", "ev-3", "ev-4"]
    assert buf.is_empty()


def test_resilient_publisher_disconnection_and_flush():
    sink_received = []

    def mock_sink(batch):
        sink_received.extend(batch)

    buf = EdgeBuffer(capacity=100)
    publisher = ResilientPublisher(sink=mock_sink, buffer=buf, is_connected=True)
    now = datetime(2026, 10, 7, 12, 0, 0, tzinfo=UTC)

    # 1. Connected: published immediately
    ev1 = TelemetryEvent(
        event_id="p-1",
        station_id="maitri",
        asset_id="maitri.aws-1",
        channel_id="maitri.aws-1.air_temp_c",
        metric="air_temp_c",
        unit="degC",
        observed_at=now,
        value=-14.0,
    )
    publisher.publish(ev1)
    assert len(sink_received) == 1
    assert buf.size() == 0

    # 2. Link disconnects (e.g. Antarctic blizzard / satcom loss)
    publisher.set_connected(False)
    ev2 = TelemetryEvent(
        event_id="p-2",
        station_id="maitri",
        asset_id="maitri.aws-1",
        channel_id="maitri.aws-1.air_temp_c",
        metric="air_temp_c",
        unit="degC",
        observed_at=now,
        value=-15.0,
    )
    publisher.publish(ev2)
    assert len(sink_received) == 1  # Not sent to sink
    assert buf.size() == 1           # Enqueued to edge buffer

    # 3. Reconnection triggers automatic flush
    flushed = publisher.set_connected(True)
    assert flushed == 1
    assert len(sink_received) == 2
    assert sink_received[1].event_id == "p-2"
    assert buf.is_empty()


def test_mqtt_topic_parsing_and_normalization():
    topic_parser = MqttTopic(root="polartwin/v1")
    topic = "polartwin/v1/bharati/aws-1/wind_speed_ms"
    parsed = topic_parser.parse(topic)
    assert parsed == ("bharati", "aws-1", "wind_speed_ms")

    normalizer = MqttNormalizer(topic_parser)
    payload = {
        "value": 14.8,
        "unit": "m/s",
        "quality": "GOOD",
        "provenance": "SYNTHETIC",
        "timestamp": "2026-10-07T12:00:00Z",
    }
    event = normalizer.normalize(topic, payload)

    assert event.station_id == "bharati"
    assert event.asset_id == "bharati.aws-1"
    assert event.channel_id == "bharati.aws-1.wind_speed_ms"
    assert event.metric == "wind_speed_ms"
    assert event.value == 14.8
    assert event.unit == "m/s"
    assert event.provenance == Provenance.SYNTHETIC


def test_in_memory_broker_wildcards():
    broker = InMemoryBroker()
    received = []

    def on_weather(topic, payload):
        received.append((topic, payload.decode("utf-8")))

    # Subscribe with wildcard '+'
    broker.subscribe("polartwin/v1/+/aws-1/+", on_weather)

    broker.publish("polartwin/v1/maitri/aws-1/air_temp_c", '{"val": -12}')
    broker.publish("polartwin/v1/bharati/aws-1/wind_speed_ms", '{"val": 9}')
    broker.publish("polartwin/v1/maitri/dg-1/load_kw", '{"val": 45}')  # Unmatched

    assert len(received) == 2
    assert received[0][0] == "polartwin/v1/maitri/aws-1/air_temp_c"
    assert received[1][0] == "polartwin/v1/bharati/aws-1/wind_speed_ms"
