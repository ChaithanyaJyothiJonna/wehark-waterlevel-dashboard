const COACHES = ["S1","S2","S3","S4","S5","A1","B1","B2"];

let settings = {
    low_threshold: 40,
    empty_threshold: 0,
    alert_low_water: true,
    alert_empty_tank: true,
    alert_sensor_fault: true,
    alert_mpu_offline: true,
    alert_low_battery: true
};

let latestData = null;

function createTrainLayout() {
    const layout = document.getElementById("trainLayout");
    let html = `<div class="engine"><span>FRONT</span></div>`;
    COACHES.forEach((coach, index) => {
        html += `
        <div id="position-${coach}" class="coach-position no-data">
            <div class="coach-box">
                <div class="coach-roof"></div>
                <div class="coach-name">${coach}</div>
                <div class="mini-tank"><div id="mini-fill-${coach}" class="mini-fill"></div></div>
                <div id="mini-value-${coach}" class="mini-value">0%</div>
            </div>
            <div class="coupler"></div>
            <div class="position-number">POSITION ${index + 1}</div>
        </div>`;
    });
    layout.innerHTML = html;
}

function createDetailCards() {
    document.getElementById("detailGrid").innerHTML = COACHES.map(coach => `
        <div id="detail-${coach}" class="detail-card no-data">
            <div class="detail-top">
                <span class="detail-coach">Coach ${coach}</span>
                <span id="detail-status-${coach}" class="detail-status no-data">NO DATA</span>
            </div>
            <div id="detail-water-${coach}" class="detail-water">0%</div>
            <div class="detail-bar"><div id="detail-fill-${coach}" class="detail-fill"></div></div>
            <div class="detail-info">
                <div>Battery<b id="battery-${coach}">0%</b></div>
                <div>Sensor<b id="sensor-${coach}">WAITING</b></div>
                <div>System<b id="system-${coach}">WAITING</b></div>
                <div>Status<b id="status-text-${coach}">NO DATA</b></div>
            </div>
        </div>`).join("");
}

function updateClock() {
    const now = new Date();
    document.getElementById("date").innerText =
        now.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"2-digit",year:"numeric"});
    document.getElementById("time").innerText = now.toLocaleTimeString();
}

function healthClass(v) {
    const s = String(v || "").toUpperCase();
    return (s === "GOOD" || s === "OK") ? "good" : "waiting";
}

function updateDashboard(data) {
    latestData = data;
    const threshold = Number(settings.low_threshold ?? data.low_threshold ?? 40);

    document.getElementById("averageWater").innerText = `${data.average_water_level || 0}%`;
    document.getElementById("activeCount").innerText = `${data.active_count || 0} / 8`;
    document.getElementById("lowCount").innerText = data.low_count || 0;
    document.getElementById("counter").innerText = data.counter || 0;
    document.getElementById("lastUpdate").innerText = data.received_at || "--";
    document.getElementById("legendThreshold").innerText = threshold;

    const mqttStatus = document.getElementById("mqttStatus");
    const mqttText = document.getElementById("mqttText");
    mqttStatus.className = data.online ? "mqtt-status online" : "mqtt-status offline";
    mqttText.innerText = data.online ? "MQTT ONLINE" : "MQTT OFFLINE";

    data.coaches.forEach(c => {
        const name = c.coach;
        if (!COACHES.includes(name)) return;
        const water = Math.max(0,Math.min(100,Number(c.water_level)||0));
        const battery = Math.max(0,Math.min(100,Number(c.battery)||0));
        const low = water <= threshold;
        const noData = c.status === "NO DATA";

        const position = document.getElementById(`position-${name}`);
        position.className = `coach-position ${noData ? "no-data" : low ? "low" : "ok"}`;
        document.getElementById(`mini-fill-${name}`).style.height = `${water}%`;
        document.getElementById(`mini-value-${name}`).innerText = `${water}%`;

        const card = document.getElementById(`detail-${name}`);
        card.className = `detail-card ${noData ? "no-data" : low ? "low" : ""}`;

        const status = document.getElementById(`detail-status-${name}`);
        status.className = `detail-status ${noData ? "no-data" : low ? "low" : "ok"}`;
        status.innerText = noData ? "NO DATA" : low ? "LOW" : "OK";

        document.getElementById(`detail-water-${name}`).innerText = `${water}%`;
        const fill = document.getElementById(`detail-fill-${name}`);
        fill.style.width = `${water}%`;
        fill.className = `detail-fill ${low ? "low" : ""}`;

        document.getElementById(`battery-${name}`).innerText = `${battery}%`;
        document.getElementById(`sensor-${name}`).innerText = String(c.sensor_health||"UNKNOWN").toUpperCase();
        document.getElementById(`system-${name}`).innerText = String(c.system_health||"UNKNOWN").toUpperCase();
        document.getElementById(`status-text-${name}`).innerText = String(c.status||"NO DATA").toUpperCase();

        document.getElementById(`sensor-${name}`).className = healthClass(c.sensor_health);
        document.getElementById(`system-${name}`).className = healthClass(c.system_health);
    });

    renderRake(data);
    renderAlerts(data);
}

function renderRake(data) {
    const el = document.getElementById("rakeList");
    el.innerHTML = data.coaches.map((c,i) => {
        const water = Number(c.water_level)||0;
        const low = water <= Number(settings.low_threshold ?? 40);
        return `
        <div class="rake-row ${c.status==="NO DATA" ? "no-data" : low ? "low" : ""}">
            <span class="rake-pos">${i+1}</span>
            <b>${c.coach}</b>
            <span>${water}% water</span>
            <span>${Number(c.battery)||0}% battery</span>
            <strong>${c.status}</strong>
        </div>`;
    }).join("");
}

function renderAlerts(data) {
    const alerts = [];
    const threshold = Number(settings.low_threshold ?? 40);

    data.coaches.forEach(c => {
        const water = Number(c.water_level)||0;
        if (c.status === "NO DATA" && settings.alert_mpu_offline) {
            alerts.push({type:"CRITICAL", coach:c.coach, text:"No live data received"});
        } else if (water <= Number(settings.empty_threshold ?? 0) && settings.alert_empty_tank) {
            alerts.push({type:"CRITICAL", coach:c.coach, text:"Water tank empty"});
        } else if (water <= threshold && settings.alert_low_water) {
            alerts.push({type:"LOW", coach:c.coach, text:`Water level ${water}%`});
        }
        if (String(c.sensor_health).toUpperCase() !== "GOOD" && settings.alert_sensor_fault) {
            alerts.push({type:"SENSOR", coach:c.coach, text:"Sensor health requires attention"});
        }
        if ((Number(c.battery)||0) <= Number(settings.low_battery ?? 20) && settings.alert_low_battery) {
            alerts.push({type:"BATTERY", coach:c.coach, text:`Battery ${Number(c.battery)||0}%`});
        }
    });

    const el = document.getElementById("alertsList");
    if (!alerts.length) {
        el.innerHTML = `<div class="empty-alert">✓ No active alerts</div>`;
        return;
    }
    el.innerHTML = alerts.map(a => `
        <div class="alert-item ${a.type==="CRITICAL" ? "critical" : "warning"}">
            <div class="alert-icon">!</div>
            <div><b>${a.type} — Coach ${a.coach}</b><p>${a.text}</p></div>
        </div>`).join("");
}

function getLiveData() {
    fetch("/api/live",{cache:"no-store"})
    .then(r => r.json())
    .then(updateDashboard)
    .catch(e => console.log("Dashboard API error:",e));
}

function loadSettings() {
    fetch("/api/settings",{cache:"no-store"})
    .then(r=>r.json())
    .then(data=>{
        settings = {...settings,...data};
        Object.keys(settings).forEach(key=>{
            const el = document.getElementById(key);
            if (!el) return;
            if (el.type === "checkbox") el.checked = !!settings[key];
            else el.value = settings[key];
        });
        const copy = document.getElementById("low_battery_copy");
        if (copy) copy.value = settings.low_battery;
    });
}

function collectSettings() {
    const result = {...settings};
    document.querySelectorAll("#page-settings input[id]").forEach(el=>{
        if (el.type === "checkbox") result[el.id] = el.checked;
        else if (el.type === "number") result[el.id] = Number(el.value);
        else result[el.id] = el.value;
    });
    result.low_battery = Number(document.getElementById("low_battery_copy").value);
    delete result.low_battery_copy;
    return result;
}

function saveSettings() {
    const payload = collectSettings();
    fetch("/api/settings",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
    })
    .then(r=>r.json())
    .then(data=>{
        settings = {...settings,...data};
        const msg = document.getElementById("saveMessage");
        msg.innerText = "✓ Settings saved successfully";
        msg.className = "save-message show";
        setTimeout(()=>msg.className="save-message",2500);
        if (latestData) updateDashboard(latestData);
    });
}

function createCoachConfig() {
    const el = document.getElementById("coachConfigRows");
    el.innerHTML = COACHES.map((c,i)=>`
        <div class="table-row">
            <span>${i+1}</span>
            <b>${c}</b>
            <span>MPU_${c}_00${i+1}</span>
            <span class="state-active">ACTIVE</span>
            <button class="small-btn" onclick="selectMaintenance('${c}')">Maintenance</button>
        </div>`).join("");

    const select = document.getElementById("maintenanceCoach");
    select.innerHTML = COACHES.map(c=>`<option value="${c}">${c}</option>`).join("");
    select.addEventListener("change",()=>loadMaintenance(select.value));
    loadMaintenance("S1");
}

function selectMaintenance(coach) {
    document.getElementById("maintenanceCoach").value = coach;
    loadMaintenance(coach);
    document.getElementById("maintenanceCoach").scrollIntoView({behavior:"smooth",block:"center"});
}

function loadMaintenance(coach) {
    fetch(`/api/maintenance/${coach}`)
    .then(r=>r.json())
    .then(data=>{
        document.getElementById("maintenanceForm").innerHTML = `
            <label>Last Service<input id="m_last_service" type="date" value="${data.last_service||""}"></label>
            <label>Next Service<input id="m_next_service" type="date" value="${data.next_service||""}"></label>
            <label>Sensor Calibration<input id="m_sensor_calibration" type="date" value="${data.sensor_calibration||""}"></label>
            <label>Battery Check<input id="m_battery_check" type="date" value="${data.battery_check||""}"></label>
            <label>Enclosure Check<select id="m_enclosure_check"><option>GOOD</option><option>ATTENTION</option></select></label>
            <label>Sensor Check<select id="m_sensor_check"><option>GOOD</option><option>ATTENTION</option></select></label>
            <label>System Check<select id="m_system_check"><option>GOOD</option><option>ATTENTION</option></select></label>
            <button class="primary-btn" onclick="saveMaintenance('${coach}')">Save Maintenance</button>`;
        document.getElementById("m_enclosure_check").value = data.enclosure_check||"GOOD";
        document.getElementById("m_sensor_check").value = data.sensor_check||"GOOD";
        document.getElementById("m_system_check").value = data.system_check||"GOOD";
    });
}

function saveMaintenance(coach) {
    const payload = {
        last_service: document.getElementById("m_last_service").value,
        next_service: document.getElementById("m_next_service").value,
        sensor_calibration: document.getElementById("m_sensor_calibration").value,
        battery_check: document.getElementById("m_battery_check").value,
        enclosure_check: document.getElementById("m_enclosure_check").value,
        sensor_check: document.getElementById("m_sensor_check").value,
        system_check: document.getElementById("m_system_check").value
    };
    fetch(`/api/maintenance/${coach}`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
    }).then(()=> {
        const msg = document.getElementById("saveMessage");
        msg.innerText = `✓ Coach ${coach} maintenance saved`;
        msg.className = "save-message show";
        setTimeout(()=>msg.className="save-message",2500);
    });
}

function showCalibration() {
    alert("Sensor calibration screen placeholder. Actual raw-sensor calibration should be performed in the MPU and stored in its non-volatile memory.");
}

function showPage(page) {
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    document.getElementById(`page-${page}`).classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
}

document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click",()=>showPage(btn.dataset.page));
});

document.getElementById("saveSettings").addEventListener("click",saveSettings);

createTrainLayout();
createDetailCards();
createCoachConfig();
loadSettings();
updateClock();
getLiveData();

setInterval(updateClock,1000);
setInterval(getLiveData,1000);
