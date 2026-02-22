function maxHandicap(size) {
    if (size % 2 === 0 || size < 7) { return 0; }
    return size >= 13 ? 9 : 5;
}

function syncHandicap() {
    var cols = parseInt(document.getElementById("cols").value, 10) || 19;
    var handicap = document.getElementById("handicap");
    var max = maxHandicap(cols);
    // min=1 means "no handicap"; max of 1 disables choosing stones
    handicap.max = max < 2 ? 1 : max;
    if (parseInt(handicap.value, 10) > parseInt(handicap.max, 10)) {
        handicap.value = handicap.max;
    }
}

function toggleTC(value) {
    ["tc-fischer", "tc-byoyomi", "tc-correspondence"].forEach(function (id) {
        var section = document.getElementById(id);
        var active = id === "tc-" + value;
        section.style.display = active ? "" : "none";
        section.querySelectorAll("input").forEach(function (input) {
            input.disabled = !active;
        });
    });
}

(function () {
    var KEY = "gameSettings";
    var form = document.getElementById("new-game");

    // TC radio toggle
    document.querySelectorAll('input[name="time_control"]').forEach(function (radio) {
        radio.addEventListener("change", function () { toggleTC(radio.value); });
    });

    // Sync handicap max when board size changes
    document.getElementById("cols").addEventListener("change", syncHandicap);

    var numberFields = [
        "cols", "komi", "handicap",
        "main_time_minutes", "byo_main_time_minutes",
        "increment_secs", "byoyomi_time_secs", "byoyomi_periods",
        "correspondence_days"
    ];
    var radioFields = ["time_control", "color"];
    var checkboxFields = ["allow_undo", "is_private"];

    // Save on submit
    form.addEventListener("submit", function () {
        var settings = {};
        numberFields.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) { settings[id] = el.value; }
        });
        radioFields.forEach(function (name) {
            var checked = form.querySelector('input[name="' + name + '"]:checked');
            if (checked) { settings[name] = checked.value; }
        });
        checkboxFields.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) { settings[id] = el.checked; }
        });
        try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
    });

    // Restore on load
    try {
        var raw = localStorage.getItem(KEY);
        if (raw) {
            var saved = JSON.parse(raw);
            numberFields.forEach(function (id) {
                if (saved[id] !== undefined) {
                    var el = document.getElementById(id);
                    if (el) { el.value = saved[id]; }
                }
            });
            radioFields.forEach(function (name) {
                if (saved[name] !== undefined) {
                    var radio = form.querySelector('input[name="' + name + '"][value="' + saved[name] + '"]');
                    if (radio) { radio.checked = true; }
                }
            });
            checkboxFields.forEach(function (id) {
                if (saved[id] !== undefined) {
                    var el = document.getElementById(id);
                    if (el) { el.checked = saved[id]; }
                }
            });
            if (saved.time_control) { toggleTC(saved.time_control); }
        }
    } catch (e) {}

    syncHandicap();
})();
