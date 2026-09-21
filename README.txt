WEHARK MQTT TRAIN WATER LEVEL WEBSITE - SETTINGS FINAL
=========================================================

This is a website-only update. The existing working ESP32 MQTT code
does NOT need to be changed.

MQTT:
Broker : broker.hivemq.com
Port   : 1883
Topic  : wehark/waterlevel/live

RUN:
    python -m pip install -r requirements.txt
    python app.py

OPEN:
    http://127.0.0.1:5000

NEW MENU:
    Dashboard
    Train Rake
    Coaches
    Alerts
    Settings

SETTINGS INCLUDED:
    - System configuration
    - Low water / empty tank thresholds
    - Demo and target reporting interval
    - Alert enable/disable
    - Critical water and battery thresholds
    - Sensor configuration reference
    - GPS/location configuration
    - Battery configuration
    - MQTT communication information
    - Coach / MPU mapping
    - Maintenance records

The settings are stored in memory while the Flask application is running.
They are intended for the prototype dashboard and do not automatically
change the ESP32 firmware.

Source basis:
The uploaded RDSO WLI specification describes real-time water monitoring,
40% low-water alerting, coach/MPU unique ID mapping, sensor calibration,
GPS/location, battery health, 15-minute reporting, MQTT/JSON communication,
web monitoring and maintenance/health checks.

Production note:
The current HiveMQ public broker configuration is only for the working
prototype/demo. Production deployment should use the authorized railway
server, authentication/security and approved communication configuration.
