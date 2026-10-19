/**
 * Stockbit Auto S/R - Extension Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    const masterToggle = document.getElementById('master-toggle');
    const lookbackSelect = document.getElementById('lookback-select');
    const zonesToggle = document.getElementById('zones-toggle');
    const obToggle = document.getElementById('ob-toggle');
    const refreshBtn = document.getElementById('refresh-btn');

    const tokenInput = document.getElementById('token-input');

    const DEFAULT_TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImExNWQ5OGE2LTdkYzgtNDM3NS05NDk0LTEyOWJlM2RlODVkNCIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InVzZSI6Ikhhc2liUmFobWF0IiwiZW1hIjoiaGFzaWJtYXVsYW5hcmFobWF0QGdtYWlsLmNvbSIsImZ1bCI6IkFzYURlbiIsInNlcyI6IlBRWDhnME1GUE9PankybGQiLCJkdmMiOiI0ZjY5Yzk2MDg2YWU4YWNiODU3MWQxM2I2YjY4OTBiNiIsInVpZCI6NTg2MjkzMSwiY291IjoiRUcifSwiZXhwIjoxNzg4OTAyMjQwLCJpYXQiOjE3ODg4MTU4NDAsImlzcyI6IlNUT0NLQklUIiwianRpIjoiOTgxMGU1NDAtNDVhNy00ZjY5LTg4YTYtYjJjNjAzZjk3NzBlIiwibmJmIjoxNzg4ODE1ODQwLCJ2ZXIiOiJ2MSJ9.MUHwJiO8Y6B8bT5AKNZemYngkiT3vv-2dzc_MA7MGdZsBN9050Nb7kyx56wLYcejTQthB9XRY-rzNPWvwOH_FCjLfaUDOg6d2wqb4nOThXrftUpJkUVkSBhN20OjF676o1e_EzrbRwTmOgwXjqUaQlBFIK0jHngxOj8-Js29CSfPJUBgftG_oocNFsSJXsWmVmH6VaNef8370OXNBFoWijwWoJMeadEaUzl2AS989bNZbGM1g5zbF5_9YzzEGrj1Q_hCQQFGY_Pq9_7fqNPOkti51XEMLteF915WgL52c9vEYyV0W7MFafFOffvBA_KZg8lr7g1Dr51KZK4cndmWVQ";

    // Load saved settings
    if (chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get({
            enabled: true,
            lookback: '10',
            showZones: true,
            showOrderbook: true,
            token: DEFAULT_TOKEN
        }, (items) => {
            masterToggle.checked = items.enabled;
            lookbackSelect.value = items.lookback;
            zonesToggle.checked = items.showZones;
            obToggle.checked = items.showOrderbook;
            if (tokenInput) tokenInput.value = items.token || DEFAULT_TOKEN;
        });
    }

    function saveSettings() {
        if (chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.set({
                enabled: masterToggle.checked,
                lookback: lookbackSelect.value,
                showZones: zonesToggle.checked,
                showOrderbook: obToggle.checked,
                token: tokenInput ? tokenInput.value.trim().replace(/^Bearer\s+/i, '') : DEFAULT_TOKEN
            });
        }
    }

    function sendMessageToActiveTab(msg) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, msg, () => {
                    if (chrome.runtime.lastError) {
                        // Tab might not be a Stockbit page
                    }
                });
            }
        });
    }

    masterToggle.addEventListener('change', () => {
        saveSettings();
        sendMessageToActiveTab({
            type: 'TOGGLE_AUTO_SR',
            enabled: masterToggle.checked
        });
    });

    lookbackSelect.addEventListener('change', () => {
        saveSettings();
        sendMessageToActiveTab({
            type: 'SET_LOOKBACK',
            lookback: lookbackSelect.value
        });
    });

    zonesToggle.addEventListener('change', () => {
        saveSettings();
        sendMessageToActiveTab({
            type: 'SET_LOOKBACK',
            lookback: lookbackSelect.value
        });
    });

    obToggle.addEventListener('change', () => {
        saveSettings();
    });

    if (tokenInput) {
        tokenInput.addEventListener('change', () => {
            saveSettings();
        });
    }

    refreshBtn.addEventListener('click', () => {
        sendMessageToActiveTab({
            type: 'SET_LOOKBACK',
            lookback: lookbackSelect.value
        });
        window.close();
    });
});
