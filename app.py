from flask import Flask, jsonify, render_template, request
import paho.mqtt.client as mqtt
import threading
import json
import time
from datetime import datetime

app = Flask(__name__)

# Exact MQTT settings used by the working ESP32 application
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
MQTT_TOPIC = "wehark/waterlevel/live"

LOW_THRESHOLD = 40
COACHES = ["S1", "S2", "S3", "S4", "S5", "A1", "B1", "B2"]

lock = threading.Lock()
last_message_time = 0

live_data = {
    "counter": 0,
    "received_at": None,
    "online": False,
    "coaches": [
        {
            "coach": name,
            "water_level": 0,
            "battery": 0,
            "sensor_health": "WAITING",
            "system_health": "WAITING",
            "status": "NO DATA",
        }
        for name in COACHES
    ],
}


def apply_payload(data, source="MQTT"):
    """Merge one telemetry packet into live_data.

    Shared by the MQTT subscriber and the HTTP /api/ingest route, so the
    STM32 (via the serial bridge) and the ESP32 nodes behave identically.
    Returns the number of coaches that were updated.
    """
    global last_message_time

    incoming = data.get("coaches", [])
    if not isinstance(incoming, list):
        return 0

    updated = 0

    with lock:
        live_data["counter"] = data.get("counter", 0)
        live_data["received_at"] = datetime.now().strftime("%H:%M:%S")
        live_data["online"] = True

        # Optional GNSS fix from the EC200U (absent until the modem locks on)
        if data.get("lat") and data.get("lon"):
            live_data["lat"] = str(data["lat"])
            live_data["lon"] = str(data["lon"])

        for item in incoming:
            name = str(item.get("coach", "")).upper()

            if name not in COACHES:
                continue

            water = max(0, min(100, float(item.get("water_level", 0))))
            battery = max(0, min(100, float(item.get("battery", 0))))

            for coach in live_data["coaches"]:
                if coach["coach"] == name:
                    coach["water_level"] = water
                    coach["battery"] = battery
                    coach["sensor_health"] = str(
                        item.get("sensor_health", "UNKNOWN")
                    ).upper()
                    coach["system_health"] = str(
                        item.get("system_health", "UNKNOWN")
                    ).upper()
                    coach["status"] = str(
                        item.get(
                            "status",
                            "LOW" if water <= LOW_THRESHOLD else "OK",
                        )
                    ).upper()
                    updated += 1
                    break

    last_message_time = time.time()
    print(f"{source} UPDATE: counter={data.get('counter', 0)} coaches={updated}")
    return updated


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("==============================================")
        print("MQTT CONNECTED")
        print("Broker :", MQTT_BROKER)
        print("Topic  :", MQTT_TOPIC)
        print("==============================================")
        client.subscribe(MQTT_TOPIC, qos=1)
        print("Subscribed successfully")
    else:
        print("MQTT connection failed:", rc)


def on_disconnect(client, userdata, rc):
    print("MQTT DISCONNECTED:", rc)


def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode("utf-8")
        print("MQTT RECEIVED:", payload)
        apply_payload(json.loads(payload), source="MQTT")
    except Exception as exc:
        print("MQTT DATA ERROR:", exc)


def mqtt_worker():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message

    while True:
        try:
            print("Connecting to MQTT...")
            client.connect(MQTT_BROKER, MQTT_PORT, 60)
            client.loop_forever()
        except Exception as exc:
            print("MQTT ERROR:", exc)
            time.sleep(5)


settings = {
    "system_name": "WeHark Water Level Indicator",
    "low_threshold": 40,
    "empty_threshold": 0,
    "demo_reporting_interval": 1,
    "target_reporting_interval": 15,
    "dashboard_refresh": 1,
    "alert_low_water": True,
    "alert_empty_tank": True,
    "alert_sensor_fault": True,
    "alert_mpu_offline": True,
    "alert_low_battery": True,
    "critical_water": 20,
    "low_battery": 20,
    "critical_battery": 10,
    "gps_status": "DEMO",
    "sleep_after_same_location_hours": 6,
    "mqtt_protocol": "MQTT",
    "mqtt_qos": 1,
}

maintenance = {
    coach: {
        "last_service": "",
        "next_service": "",
        "sensor_calibration": "",
        "battery_check": "",
        "enclosure_check": "GOOD",
        "sensor_check": "GOOD",
        "system_check": "GOOD",
    }
    for coach in COACHES
}


@app.route("/api/ingest", methods=["POST"])
def api_ingest():
    """HTTP entry point for the STM32 serial bridge.

    Expects the same JSON body the ESP32 publishes over MQTT:
        {"counter": 12, "coaches": [{"coach": "S1", "water_level": 88, ...}]}
    """
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "Body must be a JSON object"}), 400

    if not isinstance(data.get("coaches"), list):
        return jsonify({"error": "Missing 'coaches' list"}), 400

    try:
        updated = apply_payload(data, source="HTTP")
    except (ValueError, TypeError) as exc:
        return jsonify({"error": f"Bad field value: {exc}"}), 400

    if updated == 0:
        return jsonify({"error": "No known coach names in payload"}), 400

    return jsonify({"ok": True, "updated": updated, "counter": live_data["counter"]})


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    global settings
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        for key in settings:
            if key in data:
                settings[key] = data[key]
        try:
            settings["low_threshold"] = max(0, min(100, int(settings["low_threshold"])))
            settings["empty_threshold"] = max(0, min(100, int(settings["empty_threshold"])))
            settings["critical_water"] = max(0, min(100, int(settings["critical_water"])))
            settings["low_battery"] = max(0, min(100, int(settings["low_battery"])))
            settings["critical_battery"] = max(0, min(100, int(settings["critical_battery"])))
            settings["dashboard_refresh"] = max(1, int(settings["dashboard_refresh"]))
        except (ValueError, TypeError):
            pass
    return jsonify(settings)


@app.route("/api/maintenance/<coach>", methods=["GET", "POST"])
def api_maintenance(coach):
    coach = coach.upper()
    if coach not in maintenance:
        return jsonify({"error": "Unknown coach"}), 404

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        for key in maintenance[coach]:
            if key in data:
                maintenance[coach][key] = str(data[key])

    return jsonify(maintenance[coach])


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/live")
def api_live():
    with lock:
        result = json.loads(json.dumps(live_data))

    age = time.time() - last_message_time if last_message_time else 999
    result["online"] = age <= 5
    result["age"] = round(age, 1)

    levels = [
        float(c["water_level"])
        for c in result["coaches"]
        if c["status"] != "NO DATA"
    ]

    result["average_water_level"] = round(sum(levels) / len(levels), 1) if levels else 0
    result["low_count"] = sum(
        1 for c in result["coaches"] if c["status"] == "LOW"
    )
    result["active_count"] = len(levels)
    result["low_threshold"] = settings["low_threshold"]

    return jsonify(result)

# Start MQTT worker when the app is loaded by Gunicorn/Render
threading.Thread(target=mqtt_worker, daemon=True).start()


if __name__ == "__main__":

    print("==============================================")
    print(" WEHARK TRAIN COACH WATER LEVEL")
    print("==============================================")
    print("Website : http://127.0.0.1:5000")
    print("Ingest  : POST http://127.0.0.1:5000/api/ingest")
    print("MQTT    : broker.hivemq.com:1883")
    print("Topic   : wehark/waterlevel/live")
    print("==============================================")

    app.run(host="0.0.0.0", port=5000, debug=False)
