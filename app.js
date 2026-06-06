/* ==========================================================================
   CLIENT HOUR TRACKER - CORE INTERACTIVE ENGINE
   ========================================================================== */

// 1. Initial Default Sandbox Data (Single name architecture)
const DEFAULT_CLIENTS = [
    { id: 'c1', name: 'TP', hours: 12 },
    { id: 'c2', name: 'JM', hours: 6 },
    { id: 'c3', name: 'SP', hours: 6 },
    { id: 'c4', name: 'AB', hours: 2 },
    { id: 'c5', name: 'NG', hours: 2 }
];

const DEFAULT_ENTRIES = [
    { id: 'e1', clientId: 'c1', date: '2026-05-21', hours: 3, notes: 'Completed full backend schema designs & API layouts.' },
    { id: 'e2', clientId: 'c2', date: '2026-05-20', hours: 3, notes: 'Designed frontend Figma wireframes and reviewed palette choice.' },
    { id: 'e3', clientId: 'c3', date: '2026-05-18', hours: 2, notes: 'Conducted user interview sessions and gathered feedback.' }
];

// App State (Persisting period-independent databases!)
let state = {
    activePeriodId: '2026-05-18_2026-05-31',
    periods: [
        {
            id: '2026-05-18_2026-05-31',
            start: '2026-05-18',
            end: '2026-05-31',
            clients: JSON.parse(JSON.stringify(DEFAULT_CLIENTS)),
            entries: JSON.parse(JSON.stringify(DEFAULT_ENTRIES))
        }
    ]
};

// Currently selected client in details view modal
let activeDetailsClientId = null;

// Calendar month view date controller
let calendarViewDate = null;

// Sync server connection tracking variables
let isServerOnline = false;
let syncCheckIntervalId = null;
let isSyncInProgress = false; // flag to prevent concurrent overlapping pings/syncs

// ==========================================================================
// STATE MANAGEMENT & LOCAL STORAGE
// ==========================================================================

function getActivePeriod() {
    let period = state.periods.find(p => p.id === state.activePeriodId);
    if (!period) {
        // Fallback safety to the first period in list
        period = state.periods[0] || {
            id: '2026-05-18_2026-05-31',
            start: '2026-05-18',
            end: '2026-05-31',
            clients: JSON.parse(JSON.stringify(DEFAULT_CLIENTS)),
            entries: JSON.parse(JSON.stringify(DEFAULT_ENTRIES))
        };
    }
    return period;
}

function initApp() {
    const savedPeriods = localStorage.getItem('hour_tracker_periods_v2');
    const savedActivePeriodId = localStorage.getItem('hour_tracker_active_period_id_v2');

    // Backward compatibility variables
    const savedClientsLegacy = localStorage.getItem('hour_tracker_clients');
    const savedEntriesLegacy = localStorage.getItem('hour_tracker_entries');
    const savedPeriodStartLegacy = localStorage.getItem('hour_tracker_period_start');
    const savedPeriodEndLegacy = localStorage.getItem('hour_tracker_period_end');

    if (savedPeriods) {
        try {
            state.periods = JSON.parse(savedPeriods);
            state.activePeriodId = savedActivePeriodId || state.periods[0].id;
            
            // Ensure parsed periods have correct array forms
            if (!Array.isArray(state.periods) || state.periods.length === 0) {
                throw new Error("Invalid structure loaded from localStorage");
            }
            
            // Repair any missing names just in case
            state.periods.forEach(p => {
                if (p.clients && Array.isArray(p.clients)) {
                    p.clients.forEach(c => {
                        if (!c.name && c.initials) c.name = c.initials;
                        
                        // Map long default wireframe names back to user's desired initials Tp, Jm, SP
                        if (c.name === 'Robert Brown') c.name = 'TP';
                        if (c.name === 'Taylor Lynn') c.name = 'JM';
                        if (c.name === 'Jordan Brooks') c.name = 'SP';
                        if (c.name === 'Alex Bennett') c.name = 'AB';
                        if (c.name === 'Nadia Gray') c.name = 'NG';
                    });
                }
            });
        } catch (e) {
            console.error("Local storage corrupt, resetting to defaults:", e);
            resetToDefaults(false);
        }
    } else if (savedClientsLegacy && savedEntriesLegacy) {
        // Migrate old flat structure into our new separate-period worksheets v2 architecture automatically!
        try {
            const oldClients = JSON.parse(savedClientsLegacy);
            const oldEntries = JSON.parse(savedEntriesLegacy);
            const oldStart = savedPeriodStartLegacy || '2026-05-18';
            const oldEnd = savedPeriodEndLegacy || '2026-05-31';

            // Repair single names
            oldClients.forEach(c => {
                if (!c.name && c.initials) c.name = c.initials;
            });

            state.periods = [
                {
                    id: `${oldStart}_${oldEnd}`,
                    start: oldStart,
                    end: oldEnd,
                    clients: oldClients,
                    entries: oldEntries
                }
            ];
            state.activePeriodId = `${oldStart}_${oldEnd}`;
            saveState();

            // Clear legacy items
            localStorage.removeItem('hour_tracker_clients');
            localStorage.removeItem('hour_tracker_entries');
            localStorage.removeItem('hour_tracker_period_start');
            localStorage.removeItem('hour_tracker_period_end');
        } catch (err) {
            console.error("Migration failed, resetting to defaults:", err);
            resetToDefaults(false);
        }
    } else {
        resetToDefaults(false); // Populate defaults without showing toast
    }

    setupEventListeners();
    prefillDefaultDate();
    normalizeClientInitials();
    render();

    // Start automated real-time background sync engine
    startBackgroundSyncEngine();

    // Set up a 30-second interval to update in-progress times, battery segments, and details modal in real time
    setInterval(() => {
        render();
        if (activeDetailsClientId) {
            openClientDetailsModal(activeDetailsClientId);
        }
    }, 30000);
}

function getSyncServerUrl() {
    const savedUrl = localStorage.getItem('hour_tracker_sync_server_url');
    if (savedUrl) {
        return savedUrl.trim().replace(/\/$/, '');
    }
    return window.location.origin;
}

function saveState(isLocalModification = true) {
    if (isLocalModification) {
        const activePeriod = getActivePeriod();
        if (activePeriod) {
            activePeriod.lastUpdated = Date.now();
        }
    }

    // 1. Write to local browser storage as highly durable backup
    localStorage.setItem('hour_tracker_periods_v2', JSON.stringify(state.periods));
    localStorage.setItem('hour_tracker_active_period_id_v2', state.activePeriodId);

    // 2. Wireless dynamic POST API server upload
    const syncUrl = `${getSyncServerUrl()}/api/sync`;
    fetch(syncUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(state)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            console.log("Wireless sync save complete!");
            isServerOnline = true;
            updateSyncStatusUI(true);
        }
    })
    .catch(() => {
        console.log("Offline mode: changes saved locally in browser.");
        isServerOnline = false;
        updateSyncStatusUI(false);
    });
}

function resetToDefaults(showToast = true) {
    state.periods = [
        {
            id: '2026-05-18_2026-05-31',
            start: '2026-05-18',
            end: '2026-05-31',
            clients: JSON.parse(JSON.stringify(DEFAULT_CLIENTS)),
            entries: JSON.parse(JSON.stringify(DEFAULT_ENTRIES))
        }
    ];
    state.activePeriodId = '2026-05-18_2026-05-31';
    saveState();

    if (showToast) {
        render();
        showToastNotification('Dashboard reset to original wireframe worksheets!', 'success');
        
        // Close modals if active
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.classList.remove('active');
        });
    }
}

function normalizeClientInitials() {
    let changed = false;
    state.periods.forEach(p => {
        if (p.clients && Array.isArray(p.clients)) {
            p.clients.forEach(c => {
                // Instantly convert any legacy long mock name to the requested shortform initials Tp, Jm, SP
                if (c.name === 'Robert Brown') { c.name = 'TP'; changed = true; }
                if (c.name === 'Taylor Lynn') { c.name = 'JM'; changed = true; }
                if (c.name === 'Jordan Brooks') { c.name = 'SP'; changed = true; }
                if (c.name === 'Alex Bennett') { c.name = 'AB'; changed = true; }
                if (c.name === 'Nadia Gray') { c.name = 'NG'; changed = true; }
            });
        }
    });
    if (changed) {
        saveState();
    }
}

// Wireless dynamic synchronization check & smart merge
function syncWithServer(triggerReason = '') {
    if (isSyncInProgress) return Promise.resolve();
    isSyncInProgress = true;

    // Rotate sync icon in header to indicate active background sync
    const syncIcon = document.getElementById('btn-sync-icon');
    if (syncIcon) {
        syncIcon.classList.add('fa-spin');
    }

    const syncUrl = `${getSyncServerUrl()}/api/sync`;
    return fetch(syncUrl)
        .then(res => res.json())
        .then(data => {
            // Server responded successfully, transition to online state if was offline
            const wasOffline = !isServerOnline;
            isServerOnline = true;
            updateSyncStatusUI(true);

            if (data && Array.isArray(data.periods) && data.periods.length > 0) {
                // Perform a smart merge between local periods and server periods to prevent data loss!
                const localPeriods = state.periods || [];
                const serverPeriods = data.periods;
                const mergedPeriods = [];

                // Combine all unique period IDs
                const allPeriodIds = new Set([
                    ...localPeriods.map(p => p.id),
                    ...serverPeriods.map(p => p.id)
                ]);

                allPeriodIds.forEach(id => {
                    const localP = localPeriods.find(p => p.id === id);
                    const serverP = serverPeriods.find(p => p.id === id);

                    if (localP && serverP) {
                        // Compare modification timestamps to decide last write wins (reconciles deletions correctly!)
                        const localTime = localP.lastUpdated || 0;
                        const serverTime = serverP.lastUpdated || 0;
                        if (localTime >= serverTime) {
                            mergedPeriods.push(localP);
                        } else {
                            mergedPeriods.push(serverP);
                        }
                    } else if (localP) {
                        // Exists only locally on this phone/device, preserve it!
                        mergedPeriods.push(localP);
                    } else if (serverP) {
                        // Exists only on the server, preserve it!
                        mergedPeriods.push(serverP);
                    }
                });

                // Check if the state actually changed during the merge (JSON comparison)
                const oldPeriodsJSON = JSON.stringify(state.periods);
                const newPeriodsJSON = JSON.stringify(mergedPeriods);
                const didDataChange = (oldPeriodsJSON !== newPeriodsJSON);

                if (didDataChange) {
                    // Update state and active period pointer securely
                    state.periods = mergedPeriods;
                    
                    // If current active period doesn't exist in merged list, default to server active period or first available
                    if (!state.periods.some(p => p.id === state.activePeriodId)) {
                        state.activePeriodId = data.activePeriodId || state.periods[0].id;
                    }

                    // Enforce initials mapping on the merged database items instantly
                    normalizeClientInitials();
                    
                    // Save locally and upload without modifying timestamp (isLocalModification = false)
                    saveState(false);
                    
                    render();
                    showToastNotification('Wireless sync: Data automatically merged with computer server!', 'success');
                } else {
                    // Check if local and server have a mismatch in activePeriodId (e.g. local was changed while offline)
                    if (state.activePeriodId !== data.activePeriodId) {
                        saveState(false);
                    }
                }

                if (wasOffline && triggerReason !== 'startup') {
                    showToastNotification('Connected back online to your computer sync server!', 'success');
                }
            } else {
                // Server database is currently empty, push our local database UP to populate it
                saveState(true);
                if (wasOffline && triggerReason !== 'startup') {
                    showToastNotification('Connected back online to your computer sync server!', 'success');
                }
            }
        })
        .catch((err) => {
            console.log("Local Wi-Fi server not running, operating in standalone browser mode.", err);
            isServerOnline = false;
            updateSyncStatusUI(false);
        })
        .finally(() => {
            isSyncInProgress = false;
            // Stop sync icon rotation shortly after completion
            setTimeout(() => {
                if (syncIcon) {
                    syncIcon.classList.remove('fa-spin');
                }
            }, 800);
        });
}

// Real-time synchronization UI state updater
function updateSyncStatusUI(isOnline) {
    const dot = document.getElementById('sync-status-dot');
    if (dot) {
        if (isOnline) {
            dot.classList.remove('offline');
            dot.classList.add('online');
            dot.title = "Connected & Synced with Computer Database";
        } else {
            dot.classList.remove('online');
            dot.classList.add('offline');
            dot.title = "Offline / Standalone Mode (Computer server unreachable)";
        }
    }

    // Also dynamically update the sync status card inside the modal if it's open
    const card = document.getElementById('sync-status-card');
    const icon = document.getElementById('sync-status-icon');
    const title = document.getElementById('sync-status-title');
    const desc = document.getElementById('sync-status-desc');

    if (!card || !icon || !title || !desc) return;

    if (isOnline) {
        card.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
        card.style.borderColor = 'rgba(16, 185, 129, 0.2)';
        icon.className = 'fa-solid fa-cloud-arrow-up';
        icon.style.color = '#10b981';
        title.textContent = 'Connected & Wireless Synced';
        title.style.color = '#065f46';
        desc.textContent = 'All your worksheet data is synchronized wirelessly in real-time between your phone and your computer database file!';
    } else {
        card.style.backgroundColor = 'rgba(15, 23, 42, 0.03)';
        card.style.borderColor = 'var(--muted-color)';
        icon.className = 'fa-solid fa-cloud-arrow-down';
        icon.style.color = 'var(--text-muted)';
        title.textContent = 'Standalone / Offline Mode';
        title.style.color = 'var(--fg-color)';
        desc.textContent = 'Using local device storage. Run the built-in Node.js server on your computer to enable automatic wireless real-time sync between your phone and computer.';
    }
}

// Start background sync checker to periodically reconcile databases and check status
function startBackgroundSyncEngine() {
    // Check initially on app startup
    syncWithServer('startup');

    // Setup periodic polling every 15 seconds
    if (syncCheckIntervalId) {
        clearInterval(syncCheckIntervalId);
    }
    syncCheckIntervalId = setInterval(() => {
        syncWithServer('poll');
    }, 15000);

    // Setup listener to immediately trigger sync on page focus or tab visibility switch
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log("App visibility restored - triggering instant connection check & sync.");
            syncWithServer('visibilitychange');
        }
    });

    window.addEventListener('focus', () => {
        console.log("App focus restored - triggering instant connection check & sync.");
        syncWithServer('focus');
    });
}

// Background sync status card visual updates
function checkSyncConnectionStatus() {
    syncWithServer('modal_open');
}

// ==========================================================================
// CALCULATIONS & HELPER MATHS
// ==========================================================================

// Parse start and end Date objects for an entry
function getEntryTimeRange(entry) {
    if (!entry.date) return null;
    
    const dateParts = entry.date.split('-');
    if (dateParts.length !== 3) return null;
    
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const day = parseInt(dateParts[2], 10);
    
    let startH = 0;
    let startM = 0;
    if (entry.timeFrom) {
        const timeParts = entry.timeFrom.split(':');
        if (timeParts.length === 2) {
            startH = parseInt(timeParts[0], 10);
            startM = parseInt(timeParts[1], 10);
        }
    }
    
    const startDate = new Date(year, month, day, startH, startM, 0, 0);
    
    let endDate = null;
    if (entry.timeTo) {
        const timeParts = entry.timeTo.split(':');
        if (timeParts.length === 2) {
            const endH = parseInt(timeParts[0], 10);
            const endM = parseInt(timeParts[1], 10);
            endDate = new Date(year, month, day, endH, endM, 0, 0);
            if (endDate < startDate) {
                // overnight entry crosses midnight
                endDate.setDate(endDate.getDate() + 1);
            }
        }
    }
    
    if (!endDate) {
        // Fallback: add entry.hours duration to the start date
        endDate = new Date(startDate.getTime() + (entry.hours || 0) * 60 * 60 * 1000);
    }
    
    return { startDate, endDate };
}

// Calculate the split between used and planned hours for a time entry based on current time
function getEntryHoursSplit(entry, now) {
    const parsedNow = now || new Date();
    
    if (entry.type !== 'planned') {
        // Actual entries are 100% used
        return { used: entry.hours, planned: 0, isInProgress: false, progressPercent: 100 };
    }
    
    const range = getEntryTimeRange(entry);
    if (!range) {
        return { used: 0, planned: entry.hours, isInProgress: false, progressPercent: 0 };
    }
    
    const { startDate, endDate } = range;
    
    if (parsedNow < startDate) {
        return { used: 0, planned: entry.hours, isInProgress: false, progressPercent: 0 };
    } else if (parsedNow >= endDate) {
        return { used: entry.hours, planned: 0, isInProgress: false, progressPercent: 100 };
    } else {
        // In Progress!
        const totalMs = endDate - startDate;
        if (totalMs <= 0) {
            return { used: 0, planned: entry.hours, isInProgress: false, progressPercent: 0 };
        }
        
        const elapsedMs = parsedNow - startDate;
        const fraction = Math.min(1, Math.max(0, elapsedMs / totalMs));
        const usedHours = entry.hours * fraction;
        const plannedHours = entry.hours - usedHours;
        
        return { 
            used: usedHours, 
            planned: plannedHours, 
            isInProgress: true, 
            progressPercent: parseFloat((fraction * 100).toFixed(1)) 
        };
    }
}

// Return color hex and rgba codes based on client name matching CSS stylesheet values
function getClientColorValues(clientName) {
    const name = (clientName || '').toLowerCase();
    if (name.includes('ryan')) {
        return { filled: '#ef4444', plannedBg: 'rgba(239, 68, 68, 0.08)', plannedBorder: 'rgba(239, 68, 68, 0.5)' };
    } else if (name.includes('jamie')) {
        return { filled: '#a855f7', plannedBg: 'rgba(168, 85, 247, 0.08)', plannedBorder: 'rgba(168, 85, 247, 0.5)' };
    } else if (name.includes('tyler')) {
        return { filled: '#f97316', plannedBg: 'rgba(249, 115, 22, 0.08)', plannedBorder: 'rgba(249, 115, 22, 0.5)' };
    } else if (name.includes('adrian')) {
        return { filled: '#facc15', plannedBg: 'rgba(234, 179, 8, 0.08)', plannedBorder: 'rgba(234, 179, 8, 0.5)' };
    } else if (name.includes('noah')) {
        return { filled: '#06b6d4', plannedBg: 'rgba(6, 182, 212, 0.08)', plannedBorder: 'rgba(6, 182, 212, 0.5)' };
    }
    // Default fallback color (Gold / Amber theme)
    return { filled: '#fbbf24', plannedBg: 'rgba(251, 191, 36, 0.08)', plannedBorder: 'rgba(251, 191, 36, 0.5)' };
}

function getClientStats(client, period) {
    const targetPeriod = period || getActivePeriod();
    const entries = targetPeriod.entries || [];
    const clientEntries = entries.filter(e => e.clientId === client.id);
    
    // Sort chronologically by date and starting time
    clientEntries.sort((a, b) => {
        if (a.date !== b.date) {
            return a.date.localeCompare(b.date);
        }
        const timeA = a.timeFrom || '00:00';
        const timeB = b.timeFrom || '00:00';
        return timeA.localeCompare(timeB);
    });
    
    let used = 0;
    let planned = 0;
    const now = new Date();
    
    clientEntries.forEach(entry => {
        const split = getEntryHoursSplit(entry, now);
        used += split.used;
        planned += split.planned;
    });
    
    const remaining = Math.max(0, client.hours - used - planned);
    
    return { used, planned, remaining, entries: clientEntries };
}

function getOverallStats() {
    let totalAssigned = 0;
    let totalUsed = 0;
    let totalPlanned = 0;
    let totalKms = 0;

    const activePeriod = getActivePeriod();
    const visibleClients = activePeriod.clients.filter(c => !c.hidden);

    visibleClients.forEach(client => {
        totalAssigned += client.hours;
        const stats = getClientStats(client);
        totalUsed += stats.used;
        totalPlanned += stats.planned;
        
        const clientEntries = stats.entries || [];
        clientEntries.forEach(entry => {
            totalKms += (entry.kms || 0);
        });
    });

    const totalRemaining = Math.max(0, totalAssigned - totalUsed - totalPlanned);

    return {
        assigned: totalAssigned,
        used: totalUsed,
        planned: totalPlanned,
        remaining: totalRemaining,
        kms: totalKms
    };
}

// Format hours into friendly dynamic string (e.g. 0.33 Hr -> "20 min", 1.5 Hr -> "1 hr 30 min")
function formatEntryHours(hours) {
    const totalMinutes = Math.round(hours * 60);
    if (totalMinutes < 60) {
        return `${totalMinutes} min`;
    }
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (mins === 0) {
        return `${hrs} hr${hrs > 1 ? 's' : ''}`;
    }
    return `${hrs} hr${hrs > 1 ? 's' : ''} ${mins} min`;
}

// Helper to format float display numbers cleanly without floating precision trails
function formatDisplayHours(hours) {
    if (Number.isInteger(hours)) {
        return hours.toString();
    }
    return parseFloat(hours.toFixed(2)).toString();
}

// Format date into human-readable e.g. "May 21, 2026" -> "Thu, May 21, 2026"
function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// Format short date for segment block text e.g. "May 21" -> "Thu, May 21"
function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Format time into human-readable 12-hour format e.g. "2:30 PM"
function formatTime12h(timeStr) {
    if (!timeStr) return '';
    try {
        const [hours, minutes] = timeStr.split(':');
        let hr = parseInt(hours);
        const ampm = hr >= 12 ? 'PM' : 'AM';
        hr = hr % 12;
        hr = hr ? hr : 12; // 0 hour should be 12
        return `${hr}:${minutes} ${ampm}`;
    } catch(e) {
        return timeStr;
    }
}

// Format time range e.g. "10:00 AM – 1:00 PM"
function formatTimeRange(fromStr, toStr) {
    if (!fromStr && !toStr) return '';
    const formattedFrom = formatTime12h(fromStr);
    const formattedTo = formatTime12h(toStr);
    if (formattedFrom && formattedTo) {
        return `${formattedFrom} – ${formattedTo}`;
    } else if (formattedFrom) {
        return `from ${formattedFrom}`;
    } else if (formattedTo) {
        return `until ${formattedTo}`;
    }
    return '';
}

// Safe timezone-agnostic local date parsing and auto-conversion of planned entries
function autoConvertPlannedEntries() {
    let changed = false;
    const now = new Date();

    state.periods.forEach(period => {
        if (period.entries && Array.isArray(period.entries)) {
            period.entries.forEach(entry => {
                if (entry.type === 'planned') {
                    const range = getEntryTimeRange(entry);
                    if (range && range.endDate && now >= range.endDate) {
                        entry.type = 'actual';
                        changed = true;
                        console.log(`Auto-converted entry "${entry.notes}" on ${entry.date} from planned to logged/used because it has completed.`);
                    }
                }
            });
        }
    });

    if (changed) {
        saveState(); // Update browser storage & sync server immediately
    }
}

// Helper to dynamically display the day name for a date input field next to its label
function setupDateWeekdayHelper(inputId, helperId) {
    const input = document.getElementById(inputId);
    const helper = document.getElementById(helperId);
    if (!input || !helper) return;

    const update = () => {
        const val = input.value;
        if (val) {
            const date = new Date(val + 'T00:00:00');
            const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
            helper.textContent = `(${dayName})`;
        } else {
            helper.textContent = '';
        }
    };

    input.addEventListener('input', update);
    input.addEventListener('change', update);
    update();
}

// Helper to return a CSS class identifier based on client name for color personalization
function getClientColorClass(clientName) {
    if (!clientName) return '';
    const name = clientName.toLowerCase();
    if (name.includes('ryan')) return 'client-red';
    if (name.includes('jamie')) return 'client-purple';
    if (name.includes('tyler')) return 'client-orange';
    if (name.includes('adrian')) return 'client-yellow';
    if (name.includes('noah')) return 'client-cyan';
    return '';
}

// ==========================================================================
// DOM RENDERING ENGINE
// ==========================================================================

function render() {
    autoConvertPlannedEntries();
    renderPeriodDropdown();
    renderSummaryBar();
    renderClientsGrid();
    populateClientDropdowns();
    renderHiddenClientsManager();
    renderCalendar();
}

// Render dynamic periods dropdown select options
function renderPeriodDropdown() {
    const dropdown = document.getElementById('period-select-dropdown');
    const calDropdown = document.getElementById('calendar-period-select');
    
    const dropdowns = [];
    if (dropdown) dropdowns.push(dropdown);
    if (calDropdown) dropdowns.push(calDropdown);
    
    if (dropdowns.length === 0) return;

    // Sort periods chronologically by starting date
    const sortedPeriods = [...state.periods].sort((a, b) => new Date(a.start) - new Date(b.start));

    dropdowns.forEach(select => {
        select.innerHTML = '';
        sortedPeriods.forEach(period => {
            const option = document.createElement('option');
            option.value = period.id;
            option.textContent = `${formatDate(period.start)} – ${formatDate(period.end)}`;
            
            if (period.id === state.activePeriodId) {
                option.selected = true;
            }

            select.appendChild(option);
        });
    });
}

// Smoothly update the summary figures
function renderSummaryBar() {
    const stats = getOverallStats();
    
    animateNumberUpdate('total-assigned', stats.assigned);
    animateNumberUpdate('total-used', stats.used);
    animateNumberUpdate('total-remaining', stats.remaining);
    animateNumberUpdate('total-kms', stats.kms, true);

    // Dynamic sub-label inside Remaining card to display Planned Hours
    const remainingCard = document.querySelector('.summary-card.left');
    if (remainingCard) {
        let plannedLabel = document.getElementById('planned-sub-label');
        if (!plannedLabel) {
            plannedLabel = document.createElement('span');
            plannedLabel.id = 'planned-sub-label';
            plannedLabel.style.fontSize = '0.6875rem';
            plannedLabel.style.fontWeight = '600';
            plannedLabel.style.color = '#6366f1';
            plannedLabel.style.marginTop = '4px';
            plannedLabel.style.textTransform = 'uppercase';
            plannedLabel.style.letterSpacing = '0.05em';
            remainingCard.appendChild(plannedLabel);
        }
        plannedLabel.textContent = `${formatDisplayHours(stats.planned)} Planned`;
        plannedLabel.style.display = stats.planned > 0 ? 'inline-block' : 'none';
    }
}

function animateNumberUpdate(elementId, targetValue, isDecimal = false) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    const startValue = parseFloat(el.textContent) || 0;
    if (Math.abs(startValue - targetValue) < 0.001) {
        if (isDecimal) {
            el.textContent = targetValue.toFixed(1);
        } else {
            el.textContent = formatDisplayHours(targetValue);
        }
        return;
    }

    const duration = 400; // ms
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease out quadratic
        const easeProgress = progress * (2 - progress);
        const currentValue = startValue + (targetValue - startValue) * easeProgress;
        
        if (isDecimal) {
            el.textContent = currentValue.toFixed(1);
        } else {
            el.textContent = formatDisplayHours(currentValue);
        }

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            if (isDecimal) {
                el.textContent = targetValue.toFixed(1);
            } else {
                el.textContent = formatDisplayHours(targetValue);
            }
        }
    }

    requestAnimationFrame(update);
}

// Render client cards and vertical stacked battery
function renderClientsGrid() {
    const grid = document.getElementById('clients-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const activePeriod = getActivePeriod();
    const visibleClients = activePeriod.clients.filter(c => !c.hidden);

    if (visibleClients.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 4rem; color: var(--text-muted);">
                <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                <p style="font-weight: 600;">No active columns visible in this period.</p>
                <p style="font-size: 0.875rem; margin-top: 4px;">Click "+ Add Client" or restore hidden columns from the header menu.</p>
            </div>
        `;
        return;
    }

    visibleClients.forEach(client => {
        const stats = getClientStats(client);
        
        // Card HTML Frame
        const card = document.createElement('article');
        card.className = 'client-card';
        card.setAttribute('id', `client-card-${client.id}`);

        // Hours Left / Used header info (with inline quick adjustment controls)
        const hoursSummary = document.createElement('div');
        hoursSummary.className = 'card-hours-summary';
        
        let subText = `${formatDisplayHours(stats.used)} used`;
        if (stats.planned > 0) {
            subText += ` <span style="color: #6366f1; font-weight: 600; font-size: 0.75rem;">(+${formatDisplayHours(stats.planned)}p)</span>`;
        }
        
        hoursSummary.innerHTML = `
            <div class="hours-summary-left">
                <span class="hours-top">${formatDisplayHours(stats.remaining)} left</span>
                <span class="hours-sub">${subText}</span>
            </div>
            <div class="hours-adjuster-quick">
                <button class="btn-quick-adjust btn-quick-minus" title="Remove 1 hour (Used/Planned)">
                    <i class="fa-solid fa-minus"></i>
                </button>
                <button class="btn-quick-adjust btn-quick-plus" title="Add used/planned hours for this client">
                    <i class="fa-solid fa-plus"></i>
                </button>
            </div>
        `;
        
        // Bind quick add and remove hours click handlers
        const btnQuickMinus = hoursSummary.querySelector('.btn-quick-minus');
        const btnQuickPlus = hoursSummary.querySelector('.btn-quick-plus');
        
        btnQuickMinus.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent modal opening
            quickRemoveHour(client.id);
        });
        
        btnQuickPlus.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent card click
            
            const modalAddEntry = document.getElementById('modal-add-entry');
            const dropdown = document.getElementById('entry-client');
            const formAddEntry = document.getElementById('form-add-entry');
            
            if (modalAddEntry && dropdown) {
                if (formAddEntry) {
                    formAddEntry.reset();
                    prefillDefaultDate();
                }
                // Populate dropdown option
                dropdown.value = client.id;
                
                // Show modal
                modalAddEntry.classList.add('active');
                
                // Pre-fill date picker to the current day in sandbox context
                const dateInput = document.getElementById('entry-date');
                if (dateInput) {
                    dateInput.focus();
                }
            }
        });

        card.appendChild(hoursSummary);

        // Vertical Battery Container
        const battery = document.createElement('div');
        battery.className = 'battery-container';
        battery.style.maxHeight = '320px';

        // Build array of segments
        // We need total of client.hours segment blocks
        const totalSegments = client.hours;
        const segmentElements = [];

        // Distribute actual used hours into segments bottom-up
        let totalUsedSegmentsCount = 0;
        const usedEntries = stats.entries.filter(e => e.type !== 'planned');
        
        usedEntries.forEach(entry => {
            const entryHours = entry.hours;
            for (let i = 0; i < entryHours; i++) {
                const isLabelSegment = (i === 0);
                const clientColorClass = getClientColorClass(client.name);
                const segment = document.createElement('div');
                segment.className = `battery-segment filled ${clientColorClass}`;
                segment.setAttribute('title', 'Click to edit time entry');
                
                if (isLabelSegment) {
                    const kmsDotHtml = entry.kms ? `<span class="kms-dot" title="${entry.kms} Kms traveled"></span>` : '';
                    segment.innerHTML = `
                        <span class="segment-date">${formatShortDate(entry.date)}</span>
                        <span class="segment-hours">${formatEntryHours(entryHours)}</span>
                        ${kmsDotHtml}
                    `;
                }

                const rangeText = formatTimeRange(entry.timeFrom, entry.timeTo) || (entry.time ? formatTime12h(entry.time) : '');
                const timeText = rangeText ? ` (${rangeText})` : '';
                const tooltip = document.createElement('div');
                tooltip.className = 'segment-tooltip';
                tooltip.innerHTML = `
                    <span class="tooltip-date">${formatDate(entry.date)}${timeText}</span>
                    <span class="tooltip-hours"><strong>${formatEntryHours(entry.hours)}</strong> used</span>
                    ${entry.kms ? `<span class="tooltip-hours" style="color: var(--primary-color);"><strong>${entry.kms} Kms</strong> traveled</span>` : ''}
                    ${entry.notes ? `<span class="tooltip-note">"${entry.notes}"</span>` : ''}
                    <span class="tooltip-action-prompt"><i class="fa-solid fa-pen-to-square"></i> Click block to edit</span>
                `;
                segment.appendChild(tooltip);

                segment.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditEntryModal(entry.id);
                });
                
                segmentElements.push(segment);
                totalUsedSegmentsCount++;
            }
        });

        // Distribute future planned hours into segments next
        let totalPlannedSegmentsCount = 0;
        const plannedEntries = stats.entries.filter(e => e.type === 'planned');
        
        plannedEntries.forEach(entry => {
            const entryHours = entry.hours;
            const split = getEntryHoursSplit(entry, new Date());
            const isInProgress = split.isInProgress;
            const U = split.used;
            
            for (let i = 0; i < entryHours; i++) {
                const isLabelSegment = (i === 0);
                const clientColorClass = getClientColorClass(client.name);
                const segment = document.createElement('div');
                
                const segmentDuration = Math.min(entryHours - i, 1);
                let usedFraction = 0;
                if (isInProgress) {
                    const segmentUsed = Math.max(0, Math.min(U - i, segmentDuration));
                    usedFraction = segmentUsed / segmentDuration;
                }
                
                if (isInProgress && usedFraction > 0 && usedFraction < 1) {
                    segment.className = `battery-segment planned in-progress ${clientColorClass}`;
                    const colors = getClientColorValues(client.name);
                    const percent = (usedFraction * 100).toFixed(1);
                    segment.style.background = `linear-gradient(to top, ${colors.filled} 0%, ${colors.filled} ${percent}%, ${colors.plannedBg} ${percent}%, ${colors.plannedBg} 100%)`;
                } else if (isInProgress && usedFraction === 1) {
                    segment.className = `battery-segment filled ${clientColorClass}`;
                } else {
                    segment.className = `battery-segment planned ${clientColorClass}`;
                }
                
                segment.setAttribute('title', isInProgress ? 'In Progress: Click to edit Plan' : 'Future Plan: Click to edit');
                
                if (isLabelSegment) {
                    const kmsDotHtml = entry.kms ? `<span class="kms-dot" title="${entry.kms} Kms traveled"></span>` : '';
                    const textColorStyle = isInProgress ? 'color: #312e81; font-weight: 600;' : 'color: #312e81;';
                    segment.innerHTML = `
                        <span class="segment-date" style="${textColorStyle}">${formatShortDate(entry.date)}</span>
                        <span class="segment-hours" style="${textColorStyle}">${formatEntryHours(entryHours)}</span>
                        ${kmsDotHtml}
                    `;
                }

                const rangeText = formatTimeRange(entry.timeFrom, entry.timeTo) || (entry.time ? formatTime12h(entry.time) : '');
                const timeText = rangeText ? ` (${rangeText})` : '';
                const tooltip = document.createElement('div');
                tooltip.className = 'segment-tooltip';
                
                let headerText = `<span class="tooltip-date" style="color: #4f46e5; font-weight: 600;">🔮 Future Plan</span>`;
                let hoursDetails = `<span class="tooltip-hours"><strong>${formatEntryHours(entry.hours)}</strong> planned</span>`;
                
                if (isInProgress) {
                    const percent = split.progressPercent;
                    headerText = `<span class="tooltip-date" style="color: #0891b2; font-weight: 600;">⚡ In Progress (${percent}% completed)</span>`;
                    hoursDetails = `
                        <span class="tooltip-hours" style="color: var(--primary-color);"><strong>${formatEntryHours(U)}</strong> used so far</span>
                        <span class="tooltip-hours" style="color: #4f46e5;"><strong>${formatEntryHours(entry.hours - U)}</strong> remaining planned</span>
                    `;
                }
                
                tooltip.innerHTML = `
                    ${headerText}
                    <span class="tooltip-date">${formatDate(entry.date)}${timeText}</span>
                    ${hoursDetails}
                    ${entry.kms ? `<span class="tooltip-hours" style="color: #06b6d4;"><strong>${entry.kms} Kms</strong> traveled</span>` : ''}
                    ${entry.notes ? `<span class="tooltip-note">"${entry.notes}"</span>` : ''}
                    <span class="tooltip-action-prompt"><i class="fa-solid fa-pen-to-square"></i> Click block to edit plan</span>
                `;
                segment.appendChild(tooltip);

                segment.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditEntryModal(entry.id);
                });
                
                segmentElements.push(segment);
                totalPlannedSegmentsCount++;
            }
        });

        // Fill remaining segments as empty blocks
        const totalUsedOrPlanned = totalUsedSegmentsCount + totalPlannedSegmentsCount;
        const remainingEmpty = Math.max(0, totalSegments - totalUsedOrPlanned);
        for (let i = 0; i < remainingEmpty; i++) {
            const segment = document.createElement('div');
            segment.className = 'battery-segment empty';
            segmentElements.push(segment);
        }

        // Add segments to battery container
        segmentElements.forEach(seg => battery.appendChild(seg));
        card.appendChild(battery);

        // Bottom card info details (Interactive settings gear)
        const cardDetails = document.createElement('div');
        cardDetails.className = 'card-details';
        cardDetails.setAttribute('title', `Manage ${client.name} hours & view logs`);
        
        let clientKms = 0;
        stats.entries.forEach(entry => {
            clientKms += (entry.kms || 0);
        });
        const kmsDisplay = clientKms > 0 ? `<div style="font-size: 0.75rem; font-weight: 600; color: #0891b2; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-car" style="font-size: 0.6875rem;"></i> ${clientKms.toFixed(1)} Kms</div>` : '';

        cardDetails.innerHTML = `
            <span class="client-name-title">${client.name}</span>
            <span class="client-total-assigned">
                ${client.hours} Hrs Assigned <i class="fa-solid fa-sliders details-cog"></i>
            </span>
            ${kmsDisplay}
        `;
        
        // Open details modal on click
        cardDetails.addEventListener('click', () => {
            openClientDetailsModal(client.id);
        });

        card.appendChild(cardDetails);

        grid.appendChild(card);
    });
}

// Render Schedule Calendar at the bottom of the main dashboard
// Render Schedule Calendar at the bottom of the main dashboard
function renderCalendar() {
    const gridContainer = document.getElementById('calendar-days-grid');
    const monthYearLabel = document.getElementById('calendar-month-year-label');
    if (!gridContainer) return;

    const activePeriod = getActivePeriod();
    if (!activePeriod) return;

    // Initialize calendarViewDate to activePeriod's start date if not set
    if (!calendarViewDate) {
        calendarViewDate = new Date(activePeriod.start + 'T00:00:00');
    }

    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth(); // 0-indexed

    // Update the Month & Year Label
    if (monthYearLabel) {
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        monthYearLabel.textContent = `${monthNames[month]} ${year}`;
    }

    gridContainer.innerHTML = '';

    // First day of the month
    const firstDayOfMonth = new Date(year, month, 1);
    // Last day of the month
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Bounding week start (preceding Sunday)
    const calendarStart = new Date(firstDayOfMonth);
    calendarStart.setDate(firstDayOfMonth.getDate() - firstDayOfMonth.getDay());

    // Bounding week end (succeeding Saturday)
    const calendarEnd = new Date(lastDayOfMonth);
    calendarEnd.setDate(lastDayOfMonth.getDate() + (6 - lastDayOfMonth.getDay()));

    // Get current date string for checking "today" (local date)
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

    // Group entries from ALL periods by date for lookup
    const entriesByDate = {};
    state.periods.forEach(period => {
        if (period.entries && Array.isArray(period.entries)) {
            period.entries.forEach(entry => {
                if (!entriesByDate[entry.date]) {
                    entriesByDate[entry.date] = [];
                }
                // Store with period ID reference
                entriesByDate[entry.date].push({
                    ...entry,
                    periodId: period.id
                });
            });
        }
    });

    // Loop through each day from calendarStart to calendarEnd
    const current = new Date(calendarStart);
    while (current <= calendarEnd) {
        // Safe string parsing for local ISO date
        const yyyy = current.getFullYear();
        const mm = (current.getMonth() + 1).toString().padStart(2, '0');
        const dd = current.getDate().toString().padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        
        const dayNum = current.getDate();
        const isToday = (dateStr === todayStr);
        const isActive = (current.getMonth() === month); // True if it belongs to viewed month

        const dayCell = document.createElement('div');
        dayCell.className = `calendar-day ${isActive ? 'active-month' : 'inactive-month'} ${isToday ? 'today' : ''}`;
        dayCell.setAttribute('data-date', dateStr);

        // Header container for the cell (number + today label)
        const headerContainer = document.createElement('div');
        headerContainer.className = 'day-number-container';
        
        const spanNumber = document.createElement('span');
        spanNumber.className = 'day-number';
        spanNumber.textContent = dayNum;
        headerContainer.appendChild(spanNumber);

        if (isToday) {
            const spanToday = document.createElement('span');
            spanToday.className = 'today-badge';
            spanToday.textContent = 'TODAY';
            headerContainer.appendChild(spanToday);
        }

        dayCell.appendChild(headerContainer);

        // Entries container
        const entriesContainer = document.createElement('div');
        entriesContainer.className = 'day-entries-container';

        // Render entries for this day
        const dayEntries = entriesByDate[dateStr] || [];
        dayEntries.forEach(entry => {
            // Find target period for this entry
            const entryPeriod = state.periods.find(p => p.id === entry.periodId);
            const client = entryPeriod ? entryPeriod.clients.find(c => c.id === entry.clientId) : null;
            const clientName = client ? client.name : 'Unknown';

            const clientColorClass = getClientColorClass(clientName);
            const pill = document.createElement('div');
            
            const split = getEntryHoursSplit(entry, new Date());
            const isInProgress = split.isInProgress;
            const U = split.used;
            
            pill.className = `calendar-entry-pill ${entry.type} ${isInProgress ? 'in-progress' : ''} ${clientColorClass}`;
            pill.setAttribute('data-entry-id', entry.id);
            
            const kmsSuffix = entry.kms ? `, ${entry.kms} Kms` : '';
            const inProgressTitle = isInProgress ? ` (In Progress: ${split.progressPercent}% completed)` : '';
            pill.setAttribute('title', `${clientName}: ${formatEntryHours(entry.hours)} ${entry.type === 'planned' ? 'Planned' : 'Used'}${inProgressTitle}${kmsSuffix}${entry.notes ? ' - "' + entry.notes + '"' : ''}`);

            const spanClient = document.createElement('span');
            spanClient.className = 'pill-client';
            spanClient.style.display = 'inline-flex';
            spanClient.style.alignItems = 'center';
            spanClient.style.gap = '4px';
            spanClient.textContent = clientName;

            if (entry.kms) {
                const dot = document.createElement('span');
                dot.className = 'kms-dot calendar-kms-dot';
                spanClient.appendChild(dot);
            }

            const spanHours = document.createElement('span');
            spanHours.className = 'pill-hours';
            
            if (isInProgress) {
                const colors = getClientColorValues(clientName);
                const percent = split.progressPercent;
                pill.style.setProperty('background', `linear-gradient(to right, ${colors.filled} 0%, ${colors.filled} ${percent}%, ${colors.plannedBg} ${percent}%, ${colors.plannedBg} 100%)`, 'important');
                pill.style.setProperty('border-color', colors.filled, 'important');
                pill.style.setProperty('border-style', 'solid', 'important');
                const textColor = clientName.toLowerCase().includes('adrian') ? '#713f12' : '#ffffff';
                pill.style.setProperty('color', textColor, 'important');
                
                spanHours.textContent = `${formatEntryHours(U)} / ${formatEntryHours(entry.hours)}${entry.kms ? ` (${entry.kms} km)` : ''}`;
            } else {
                spanHours.textContent = formatEntryHours(entry.hours) + (entry.kms ? ` (${entry.kms} km)` : '');
            }

            pill.appendChild(spanClient);
            pill.appendChild(spanHours);

            // Click handler for editing entry
            pill.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent opening Add Entry modal
                openEditEntryModal(entry.id);
            });

            entriesContainer.appendChild(pill);
        });

        // Click handler for day cell to add a new entry for this date (supports any day visible on the calendar)
        dayCell.addEventListener('click', () => {
            const modalAddEntry = document.getElementById('modal-add-entry');
            const dateInput = document.getElementById('entry-date');
            const clientDropdown = document.getElementById('entry-client');
            const formAddEntry = document.getElementById('form-add-entry');
            
            if (modalAddEntry && dateInput) {
                if (formAddEntry) {
                    formAddEntry.reset();
                }
                dateInput.value = dateStr;
                dateInput.dispatchEvent(new Event('change'));
                modalAddEntry.classList.add('active');
                if (clientDropdown) {
                    clientDropdown.focus();
                }
            }
        });

        dayCell.appendChild(entriesContainer);
        gridContainer.appendChild(dayCell);

        // Advance to next day
        current.setDate(current.getDate() + 1);
    }
}

// Update option lists in form selectors
function populateClientDropdowns() {
    const dropdown = document.getElementById('entry-client');
    if (!dropdown) return;

    // Save selected value if any
    const selectedVal = dropdown.value;

    dropdown.innerHTML = '<option value="" disabled selected>Select client...</option>';

    const activePeriod = getActivePeriod();
    const visibleClients = activePeriod.clients.filter(c => !c.hidden);

        visibleClients.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        const stats = getClientStats(client);
        option.textContent = `${client.name} - ${formatDisplayHours(stats.remaining)} hrs left`;
        
        // Disable option if no hours remaining
        if (stats.remaining <= 0) {
            option.disabled = true;
        }

        dropdown.appendChild(option);
    });

    if (selectedVal) {
        dropdown.value = selectedVal;
    }
}

// Prefill entry date selector to May 21, 2026 (local date context)
function prefillDefaultDate() {
    const dateInput = document.getElementById('entry-date');
    if (dateInput) {
        // Find if today falls inside active period range to set it logically
        const activePeriod = getActivePeriod();
        const todayStr = '2026-05-21';
        if (todayStr >= activePeriod.start && todayStr <= activePeriod.end) {
            dateInput.value = todayStr;
        } else {
            // Set it directly to the start date of that period
            dateInput.value = activePeriod.start;
        }
    }
}

// ==========================================================================
// CLIENT DETAILS MODAL ENGINE (Manage Assigned Hours & Entries List)
// ==========================================================================

function openClientDetailsModal(clientId) {
    activeDetailsClientId = clientId;
    const activePeriod = getActivePeriod();
    const client = activePeriod.clients.find(c => c.id === clientId);
    if (!client) return;

    const stats = getClientStats(client);

    // Bind basic content with bulletproof existence guards
    const elName = document.getElementById('details-client-name');
    if (elName) elName.textContent = client.name;

    const elSubtitle = document.getElementById('details-client-subtitle');
    if (elSubtitle) {
        let subtitleText = `${formatDisplayHours(stats.remaining)} Hrs Remaining`;
        if (stats.planned > 0) {
            subtitleText += ` (+${formatDisplayHours(stats.planned)} Planned)`;
        }
        elSubtitle.textContent = subtitleText;
    }

    const elAssigned = document.getElementById('details-assigned-hours');
    if (elAssigned) elAssigned.textContent = `${formatDisplayHours(client.hours)} Hrs`;

    // Calculate total Kms for this client
    let clientKms = 0;
    stats.entries.forEach(entry => {
        clientKms += (entry.kms || 0);
    });
    const elClientKms = document.getElementById('details-client-kms');
    if (elClientKms) elClientKms.textContent = `${clientKms.toFixed(1)} Kms`;

    // Prefill Editable Identity Input with guard
    const elEditName = document.getElementById('details-edit-name');
    if (elEditName) elEditName.value = client.name;

    // Populate Entries History List
    const listContainer = document.getElementById('details-entries-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (stats.entries.length === 0) {
        listContainer.innerHTML = '<div class="details-no-entries">No time entries logged in this tracking period.</div>';
    } else {
        // Render each logged time entry with a delete button
        stats.entries.forEach(entry => {
            const entryItem = document.createElement('div');
            entryItem.className = 'details-entry-item';
            
            const split = getEntryHoursSplit(entry, new Date());
            const isPlanned = entry.type === 'planned';
            let badgeClass = isPlanned ? 'entry-badge-planned' : 'entry-badge-used';
            let badgeText = isPlanned ? `${formatEntryHours(entry.hours)} Planned` : `${formatEntryHours(entry.hours)} Used`;
            let inProgressBadge = '';
            
            if (split.isInProgress) {
                badgeClass = 'entry-badge-planned';
                badgeText = `${formatEntryHours(entry.hours)} In Progress`;
                inProgressBadge = `<span class="entry-badge-used" style="background-color: rgba(8, 145, 178, 0.1); color: #0891b2; border: 1px solid rgba(8, 145, 178, 0.2); text-transform: none; font-size: 0.625rem; font-weight: 600; padding: 0.125rem 0.375rem; border-radius: 4px;">⚡ ${split.progressPercent}% (${formatEntryHours(split.used)} used)</span>`;
            }
            
            const kmsBadge = entry.kms ? `<span class="entry-badge-used" style="background-color: rgba(6, 182, 212, 0.1); color: #0891b2; border: 1px solid rgba(6, 182, 212, 0.2); text-transform: none; font-size: 0.625rem; font-weight: 600; padding: 0.125rem 0.375rem; border-radius: 4px;">${entry.kms} Kms</span>` : '';
            
            const rangeText = formatTimeRange(entry.timeFrom, entry.timeTo) || (entry.time ? formatTime12h(entry.time) : '');
            const timeSuffix = rangeText ? ` @ ${rangeText}` : '';
            entryItem.innerHTML = `
                <div class="details-entry-content">
                    <div class="details-entry-header" style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                        <span class="details-entry-date">${formatDate(entry.date)}${timeSuffix}</span>
                        <span class="${badgeClass}">${badgeText}</span>
                        ${inProgressBadge}
                        ${kmsBadge}
                    </div>
                    ${entry.notes ? `<span class="details-entry-notes">"${entry.notes}"</span>` : ''}
                </div>
                <button class="btn-delete-entry" title="Delete entry">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;

            // Delete action bindings
            const btnDelete = entryItem.querySelector('.btn-delete-entry');
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation(); // prevent opening the edit modal
                deleteEntry(entry.id, client);
            });

            // Edit action bindings
            const entryContent = entryItem.querySelector('.details-entry-content');
            if (entryContent) {
                entryContent.style.cursor = 'pointer';
                entryContent.addEventListener('click', () => {
                    openEditEntryModal(entry.id);
                });
            }

            listContainer.appendChild(entryItem);
        });
    }

    // Toggle modal visibility
    const modalDetails = document.getElementById('modal-client-details');
    if (modalDetails) {
        modalDetails.classList.add('active');
    }
}

function deleteEntry(entryId, client) {
    const activePeriod = getActivePeriod();
    if (!activePeriod.entries) activePeriod.entries = [];
    const entry = activePeriod.entries.find(e => e.id === entryId);
    if (!entry) return;

    // Filter out the entry in active period list
    activePeriod.entries = activePeriod.entries.filter(e => e.id !== entryId);
    saveState();
    render();
    
    // Refresh modal
    openClientDetailsModal(client.id);

    showToastNotification(`Deleted entry of ${entry.hours} hrs for client "${client.name}".`, 'success');
}

// ==========================================================================
// EDIT TIME ENTRY MODAL CONTROLLER
// ==========================================================================

function openEditEntryModal(entryId) {
    let entry = null;
    let foundPeriod = null;
    
    for (const period of state.periods) {
        if (period.entries) {
            entry = period.entries.find(e => e.id === entryId);
            if (entry) {
                foundPeriod = period;
                break;
            }
        }
    }
    
    if (!entry || !foundPeriod) return;

    // Switch active period to the entry's period if it is different
    if (foundPeriod.id !== state.activePeriodId) {
        state.activePeriodId = foundPeriod.id;
        saveState();
        render();
    }

    const client = foundPeriod.clients.find(c => c.id === entry.clientId);
    if (!client) return;

    // Fill form elements
    const elId = document.getElementById('edit-entry-id');
    if (elId) elId.value = entry.id;

    const elDate = document.getElementById('edit-entry-date');
    if (elDate) {
        elDate.value = entry.date;
        elDate.dispatchEvent(new Event('change'));
    }

    const elHours = document.getElementById('edit-entry-hours');
    if (elHours) elHours.value = entry.hours;

    const elNotes = document.getElementById('edit-entry-notes');
    if (elNotes) elNotes.value = entry.notes || '';

    const elSubtitle = document.getElementById('edit-entry-client-subtitle');
    if (elSubtitle) {
        elSubtitle.textContent = `${client.name} — ${formatDate(entry.date)}`;
    }

    const elTimeFrom = document.getElementById('edit-entry-time-from');
    if (elTimeFrom) elTimeFrom.value = entry.timeFrom || entry.time || '';

    const elTimeTo = document.getElementById('edit-entry-time-to');
    if (elTimeTo) elTimeTo.value = entry.timeTo || '';

    const elKms = document.getElementById('edit-entry-kms');
    if (elKms) elKms.value = entry.kms || '';

    // Select correct time status radio pill
    const entryType = entry.type || 'actual';
    const editRadio = document.querySelector(`input[name="edit-entry-type"][value="${entryType}"]`);
    if (editRadio) editRadio.checked = true;

    // Bind delete button listener inside edit modal with clone node purge protection
    const btnDelete = document.getElementById('btn-delete-edit-entry');
    if (btnDelete) {
        const newBtnDelete = btnDelete.cloneNode(true);
        btnDelete.parentNode.replaceChild(newBtnDelete, btnDelete);
        
        const typeLabel = entry.type === 'planned' ? 'future plan' : 'logged hours';
        newBtnDelete.addEventListener('click', () => {
            if (confirm(`Are you sure you want to permanently delete this ${typeLabel} for "${client.name}"?`)) {
                // Hide Edit Modal
                document.getElementById('modal-edit-entry').classList.remove('active');
                
                // Delete the entry
                deleteEntry(entry.id, client);
            }
        });
    }

    // Show Edit Modal
    const modalEdit = document.getElementById('modal-edit-entry');
    if (modalEdit) {
        modalEdit.classList.add('active');
    }
}

// ==========================================================================
// QUICK USED HOURS ADJUSTMENT CONTROLLERS (Direct Column +/- adjusters)
// ==========================================================================

function quickAddHour(clientId) {
    const activePeriod = getActivePeriod();
    const client = activePeriod.clients.find(c => c.id === clientId);
    if (!client) return;

    const stats = getClientStats(client);
    if (stats.remaining <= 0) {
        showToastNotification(`No remaining hours left to log for "${client.name}"!`, 'error');
        return;
    }

    // Prefill date context based on period start/today
    const todayStr = '2026-05-21';
    let targetDate = activePeriod.start;
    if (todayStr >= activePeriod.start && todayStr <= activePeriod.end) {
        targetDate = todayStr;
    }

    // Find if there is an entry today by this client to append
    const todayEntry = stats.entries.find(e => e.date === targetDate);

    if (todayEntry) {
        todayEntry.hours += 1;
    } else {
        const newEntry = {
            id: 'e_' + Date.now(),
            clientId: client.id,
            date: targetDate,
            hours: 1,
            notes: 'Quick hours logged.'
        };
        activePeriod.entries.push(newEntry);
    }

    saveState();
    render();
    
    // If details modal is active for this client, refresh it
    if (activeDetailsClientId === client.id) {
        openClientDetailsModal(client.id);
    }

    showToastNotification(`Logged 1 hour to client "${client.name}"!`, 'success');
}

function quickRemoveHour(clientId) {
    const activePeriod = getActivePeriod();
    const client = activePeriod.clients.find(c => c.id === clientId);
    if (!client) return;

    const stats = getClientStats(client);
    
    // Total hours logged (used + planned) must be greater than 0 to remove
    const totalLoggedCount = (stats.used || 0) + (stats.planned || 0);
    if (totalLoggedCount <= 0) {
        showToastNotification(`No logged or planned hours to remove for "${client.name}"!`, 'error');
        return;
    }

    // Find the most recent entry for this client (sort by date descending)
    const sortedEntries = [...stats.entries].sort((a, b) => new Date(b.date) - new Date(a.date));
    const recentEntry = sortedEntries[0];

    if (recentEntry) {
        const entryInState = activePeriod.entries.find(e => e.id === recentEntry.id);
        if (entryInState) {
            entryInState.hours -= 1;
            
            // If hours reach 0, remove the entry completely
            const isPlanned = entryInState.type === 'planned';
            const labelText = isPlanned ? 'future plan' : 'used hour';
            
            if (entryInState.hours <= 0) {
                activePeriod.entries = activePeriod.entries.filter(e => e.id !== recentEntry.id);
                showToastNotification(`Removed ${labelText} for "${client.name}" as hours reached 0.`, 'success');
            } else {
                showToastNotification(`Removed 1 hour from "${client.name}"'s ${labelText}.`, 'success');
            }
            
            saveState();
            render();
            
            // If details modal is active for this client, refresh it
            if (activeDetailsClientId === client.id) {
                openClientDetailsModal(client.id);
            }
        }
    }
}

// ==========================================================================
// HIDDEN COLUMNS MANAGER
// ==========================================================================

function renderHiddenClientsManager() {
    const btnManage = document.getElementById('btn-manage-hidden');
    const countBadge = document.getElementById('hidden-count');
    const listContainer = document.getElementById('hidden-clients-list');
    
    if (!btnManage || !countBadge || !listContainer) return;

    const activePeriod = getActivePeriod();
    const hiddenClients = activePeriod.clients.filter(c => !c.hidden); // wait! actually, we want c.hidden is true!
    const actualHidden = activePeriod.clients.filter(c => c.hidden);
    countBadge.textContent = actualHidden.length;

    // Display button only if there are hidden columns
    if (actualHidden.length > 0) {
        btnManage.style.display = 'inline-flex';
    } else {
        btnManage.style.display = 'none';
        
        // Automatically close modal if empty
        const modalHidden = document.getElementById('modal-manage-hidden');
        if (modalHidden) modalHidden.classList.remove('active');
    }

    // Populate list rows
    listContainer.innerHTML = '';
    
    if (actualHidden.length === 0) {
        listContainer.innerHTML = '<div class="details-no-entries">No hidden columns.</div>';
    } else {
        actualHidden.forEach(client => {
            const item = document.createElement('div');
            item.className = 'details-entry-item';
            
            item.innerHTML = `
                <div class="details-entry-content">
                    <div class="details-entry-header">
                        <span class="details-entry-date" style="font-weight: 600; color: var(--fg-color);">${client.name}</span>
                        <span class="details-entry-badge">${client.hours} Hrs Assigned</span>
                    </div>
                </div>
                <button class="btn-delete-entry" title="Restore / Unhide Column" style="color: var(--primary-hover); background-color: rgba(251, 191, 36, 0.05);">
                    <i class="fa-solid fa-eye"></i>
                </button>
            `;

            const btnRestore = item.querySelector('.btn-delete-entry');
            btnRestore.addEventListener('click', () => {
                unhideClient(client.id);
            });

            listContainer.appendChild(item);
        });
    }
}

function hideClient(clientId) {
    const activePeriod = getActivePeriod();
    const client = activePeriod.clients.find(c => c.id === clientId);
    if (!client) return;

    client.hidden = true;
    saveState();
    render();

    // Close details modal
    const modalDetails = document.getElementById('modal-client-details');
    if (modalDetails) modalDetails.classList.remove('active');

    showToastNotification(`Column for "${client.name}" is now hidden in this period. Restore it from the header.`, 'success');
}

function unhideClient(clientId) {
    const activePeriod = getActivePeriod();
    const client = activePeriod.clients.find(c => c.id === clientId);
    if (!client) return;

    delete client.hidden; // remove key
    saveState();
    render();

    showToastNotification(`Restored column for "${client.name}" successfully!`, 'success');
}

function deleteClient(clientId) {
    const activePeriod = getActivePeriod();
    const client = activePeriod.clients.find(c => c.id === clientId);
    if (!client) return;

    const confirmDelete = confirm(`Are you sure you want to permanently delete client "${client.name}" and all of their logged entries in this period?\n\nThis will not affect other tracking periods.`);
    
    if (confirmDelete) {
        // Filter out client from active period
        activePeriod.clients = activePeriod.clients.filter(c => c.id !== clientId);
        // Filter out entries from active period
        activePeriod.entries = activePeriod.entries.filter(e => e.clientId !== clientId);
        
        saveState();
        render();

        // Close details modal
        const modalDetails = document.getElementById('modal-client-details');
        if (modalDetails) modalDetails.classList.remove('active');

        showToastNotification(`Permanently deleted client "${client.name}" from this period.`, 'success');
    }
}

function renderAssignedHoursManagerList() {
    const listContainer = document.getElementById('assigned-manager-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    const activePeriod = getActivePeriod();
    const visibleClients = activePeriod.clients.filter(c => !c.hidden);

    if (visibleClients.length === 0) {
        listContainer.innerHTML = '<div class="details-no-entries">No active client columns in this period.</div>';
        return;
    }

    visibleClients.forEach(client => {
        const stats = getClientStats(client);
        const row = document.createElement('div');
        row.className = 'details-entry-item';
        row.style.padding = '0.75rem 1rem';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        
        row.innerHTML = `
            <div style="flex: 1; display: flex; flex-direction: column; text-align: left;">
                <strong style="color: var(--fg-color); font-size: 0.875rem;">${client.name}</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${formatDisplayHours(stats.used)} hrs logged</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <button class="btn-hour-adjust btn-decrease-assigned" title="Decrease Assigned Hours" style="width: 28px; height: 28px; font-size: 0.6875rem; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer; border: 1px solid var(--muted-color); background-color: var(--card-bg); color: var(--fg-color); transition: all 120ms ease;">
                    <i class="fa-solid fa-minus"></i>
                </button>
                <span class="assigned-hours-display" style="font-weight: 700; font-size: 0.9375rem; color: var(--fg-color); min-width: 48px; text-align: center; display: inline-block;">
                    ${client.hours} Hrs
                </span>
                <button class="btn-hour-adjust btn-increase-assigned" title="Increase Assigned Hours" style="width: 28px; height: 28px; font-size: 0.6875rem; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer; border: 1px solid var(--muted-color); background-color: var(--card-bg); color: var(--fg-color); transition: all 120ms ease;">
                    <i class="fa-solid fa-plus"></i>
                </button>
            </div>
        `;

        // Decrease Button Listener
        const btnDec = row.querySelector('.btn-decrease-assigned');
        btnDec.addEventListener('click', () => {
            if (client.hours <= stats.used) {
                showToastNotification(`Cannot drop hours below currently used (${formatDisplayHours(stats.used)} Hrs)!`, 'error');
                return;
            }
            if (client.hours <= 1) {
                showToastNotification('Assigned hours limit must be at least 1 Hr.', 'error');
                return;
            }

            client.hours -= 1;
            saveState();
            render();
            renderAssignedHoursManagerList();
            showToastNotification(`Decreased "${client.name}" assigned hours limit to ${client.hours} Hrs.`, 'success');
        });

        // Increase Button Listener
        const btnInc = row.querySelector('.btn-increase-assigned');
        btnInc.addEventListener('click', () => {
            client.hours += 1;
            saveState();
            render();
            renderAssignedHoursManagerList();
            showToastNotification(`Increased "${client.name}" assigned hours limit to ${client.hours} Hrs!`, 'success');
        });

        listContainer.appendChild(row);
    });
}

// ==========================================================================
// INTERACTIVE EVENT LISTENERS & MODALS
// ==========================================================================

function setupEventListeners() {
    // Helper to calculate hours between two time inputs
    function autoCalculateTimeDiff(timeFromId, timeToId, hoursInputId) {
        const fromInput = document.getElementById(timeFromId);
        const toInput = document.getElementById(timeToId);
        const hoursInput = document.getElementById(hoursInputId);
        if (!fromInput || !toInput || !hoursInput) return;

        const recalculate = () => {
            const fromVal = fromInput.value;
            const toVal = toInput.value;

            if (fromVal && toVal) {
                const [fromH, fromM] = fromVal.split(':').map(Number);
                const [toH, toM] = toVal.split(':').map(Number);

                let diffMins = (toH * 60 + toM) - (fromH * 60 + fromM);
                if (diffMins < 0) {
                    // Handle overnight shift crossing midnight
                    diffMins += 24 * 60;
                }

                const calculatedHours = parseFloat((diffMins / 60).toFixed(2));
                hoursInput.value = calculatedHours;
                hoursInput.readOnly = true; // Set to read-only since it is auto-computed
                hoursInput.style.backgroundColor = 'var(--muted-color)';
                hoursInput.style.cursor = 'not-allowed';
            } else {
                hoursInput.readOnly = false; // Allow manual entry if one of the fields is empty
                hoursInput.style.backgroundColor = '';
                hoursInput.style.cursor = '';
            }
        };

        fromInput.addEventListener('input', recalculate);
        toInput.addEventListener('input', recalculate);
    }

    // Bind calculation listeners for both Add and Edit modals
    autoCalculateTimeDiff('entry-time-from', 'entry-time-to', 'entry-hours');
    autoCalculateTimeDiff('edit-entry-time-from', 'edit-entry-time-to', 'edit-entry-hours');

    // Setup interactive date weekday indicators next to form labels
    setupDateWeekdayHelper('entry-date', 'entry-date-weekday');
    setupDateWeekdayHelper('edit-entry-date', 'edit-entry-date-weekday');

    // Sync / Backup Modal Trigger & Setup Check
    const btnTriggerSync = document.getElementById('btn-trigger-sync');
    const modalSync = document.getElementById('modal-sync-data');
    if (btnTriggerSync && modalSync) {
        btnTriggerSync.addEventListener('click', () => {
            // Pre-fill configured or detected Sync Server IP/URL
            const inputSyncUrl = document.getElementById('input-sync-server-url');
            if (inputSyncUrl) {
                // If there's a stored URL, use it; otherwise show detected window.location.origin
                inputSyncUrl.value = localStorage.getItem('hour_tracker_sync_server_url') || window.location.origin;
            }
            checkSyncConnectionStatus();
            modalSync.classList.add('active');
        });
    }

    // Save Custom Sync Server URL & Test Connection
    const btnSaveSyncUrl = document.getElementById('btn-save-sync-url');
    const inputSyncUrlInput = document.getElementById('input-sync-server-url');
    if (btnSaveSyncUrl && inputSyncUrlInput) {
        btnSaveSyncUrl.addEventListener('click', () => {
            let targetUrl = inputSyncUrlInput.value.trim();
            if (!targetUrl) {
                showToastNotification('Please enter a valid server URL or IP address.', 'error');
                return;
            }

            // Ensure protocol is specified
            if (!/^https?:\/\//i.test(targetUrl)) {
                targetUrl = 'http://' + targetUrl;
                inputSyncUrlInput.value = targetUrl;
            }

            // Temporarily show spinner/loading feedback on the button
            const originalHTML = btnSaveSyncUrl.innerHTML;
            btnSaveSyncUrl.disabled = true;
            btnSaveSyncUrl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting';

            // Save in local storage
            localStorage.setItem('hour_tracker_sync_server_url', targetUrl);

            // Re-verify the connection with the new URL
            syncWithServer('url_test')
                .then(() => {
                    if (isServerOnline) {
                        showToastNotification(`Successfully connected & synchronized with sync server!`, 'success');
                    } else {
                        showToastNotification(`Could not reach server. Verify your PC is on and server is running.`, 'error');
                    }
                })
                .catch(() => {
                    showToastNotification(`Connection failed. Check network settings and try again.`, 'error');
                })
                .finally(() => {
                    btnSaveSyncUrl.disabled = false;
                    btnSaveSyncUrl.innerHTML = originalHTML;
                });
        });
    }

    // Export Backup File Handler
    const btnExportBackup = document.getElementById('btn-export-backup');
    if (btnExportBackup) {
        btnExportBackup.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 4));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `client_hours_backup_${new Date().toISOString().slice(0, 10)}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            showToastNotification('Database backup exported successfully!', 'success');
        });
    }

    // Import Backup File Handler
    const inputImportBackup = document.getElementById('input-import-backup');
    if (inputImportBackup) {
        inputImportBackup.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    const importedState = JSON.parse(evt.target.result);
                    
                    // Validation: check structure compatibility
                    if (!importedState || !Array.isArray(importedState.periods)) {
                        throw new Error("Invalid backup file structure");
                    }

                    // Save to state
                    state = importedState;
                    saveState();
                    render();

                    if (modalSync) modalSync.classList.remove('active');
                    showToastNotification('Database backup imported and restored successfully!', 'success');
                } catch (err) {
                    showToastNotification('Failed to import backup! Invalid or corrupted JSON file.', 'error');
                }
            };
            reader.readAsText(file);
            // Reset input file value to allow importing the same file again
            inputImportBackup.value = '';
        });
    }

    // Dropdown Selection listener to switch between period databases dynamically
    const periodDropdown = document.getElementById('period-select-dropdown');
    if (periodDropdown) {
        periodDropdown.addEventListener('change', (e) => {
            const selectedId = e.target.value;
            if (state.periods.some(p => p.id === selectedId)) {
                state.activePeriodId = selectedId;
                
                // Clear any active detail client references
                activeDetailsClientId = null;
                
                const period = state.periods.find(p => p.id === selectedId);
                if (period) {
                    calendarViewDate = new Date(period.start + 'T00:00:00');
                }

                saveState();
                prefillDefaultDate();
                render();
                showToastNotification('Switched tracking period worksheet!', 'success');
            }
        });
    }

    const calPeriodDropdown = document.getElementById('calendar-period-select');
    if (calPeriodDropdown) {
        calPeriodDropdown.addEventListener('change', (e) => {
            const selectedId = e.target.value;
            if (state.periods.some(p => p.id === selectedId)) {
                state.activePeriodId = selectedId;
                
                // Clear any active detail client references
                activeDetailsClientId = null;
                
                const period = state.periods.find(p => p.id === selectedId);
                if (period) {
                    calendarViewDate = new Date(period.start + 'T00:00:00');
                }

                saveState();
                prefillDefaultDate();
                render();
                showToastNotification('Switched tracking period worksheet!', 'success');
            }
        });
    }

    // Calendar Month Navigation Buttons
    const btnCalPrevMonth = document.getElementById('btn-calendar-prev-month');
    const btnCalNextMonth = document.getElementById('btn-calendar-next-month');

    if (btnCalPrevMonth) {
        btnCalPrevMonth.addEventListener('click', () => {
            const activePeriod = getActivePeriod();
            if (!calendarViewDate) {
                calendarViewDate = new Date(activePeriod.start + 'T00:00:00');
            }
            calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
            renderCalendar();
        });
    }

    if (btnCalNextMonth) {
        btnCalNextMonth.addEventListener('click', () => {
            const activePeriod = getActivePeriod();
            if (!calendarViewDate) {
                calendarViewDate = new Date(activePeriod.start + 'T00:00:00');
            }
            calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
            renderCalendar();
        });
    }

    // Add Client modal toggle
    const btnAddClient = document.getElementById('btn-add-client');
    const modalAddClient = document.getElementById('modal-add-client');
    
    if (btnAddClient && modalAddClient) {
        btnAddClient.addEventListener('click', () => {
            modalAddClient.classList.add('active');
        });
    }

    // Add Entry modal toggle
    const btnAddEntry = document.getElementById('btn-add-entry');
    const modalAddEntry = document.getElementById('modal-add-entry');
    
    if (btnAddEntry && modalAddEntry) {
        btnAddEntry.addEventListener('click', () => {
            const formAddEntry = document.getElementById('form-add-entry');
            if (formAddEntry) {
                formAddEntry.reset();
                prefillDefaultDate();
            }
            modalAddEntry.classList.add('active');
        });
    }

    // Change Period Modal Trigger & Setup
    const btnChangePeriod = document.getElementById('btn-change-period');
    const btnCalendarChangePeriod = document.getElementById('btn-calendar-change-period');
    const modalChangePeriod = document.getElementById('modal-change-period');
    
    function triggerChangePeriodModal() {
        if (!modalChangePeriod) return;
        const activePeriod = getActivePeriod();
        const startInput = document.getElementById('period-start');
        const endInput = document.getElementById('period-end');
        
        if (startInput && endInput) {
            startInput.value = activePeriod.start;
            endInput.value = activePeriod.end;
        }

        // Default to "Create New Period" radio selection
        const radioCreate = document.querySelector('input[name="period-action"][value="create"]');
        if (radioCreate) {
            radioCreate.checked = true;
            // Dispatch event manually to trigger UI label updates
            radioCreate.dispatchEvent(new Event('change'));
        }

        modalChangePeriod.classList.add('active');
    }

    if (btnChangePeriod) {
        btnChangePeriod.addEventListener('click', triggerChangePeriodModal);
    }
    if (btnCalendarChangePeriod) {
        btnCalendarChangePeriod.addEventListener('click', triggerChangePeriodModal);
    }

    // Period Modal Radio selection dynamically updates titles/prompts
    const radioActions = document.querySelectorAll('input[name="period-action"]');
    radioActions.forEach(radio => {
        radio.addEventListener('change', () => {
            const isCreate = (document.querySelector('input[name="period-action"]:checked').value === 'create');
            
            const elTitle = document.getElementById('modal-period-title');
            const elHelper = document.getElementById('period-create-helper');
            const elSubmit = document.getElementById('btn-submit-period');

            if (isCreate) {
                if (elTitle) elTitle.textContent = 'Create New Period';
                if (elHelper) elHelper.style.display = 'flex';
                if (elSubmit) elSubmit.textContent = 'Create Period';
            } else {
                if (elTitle) elTitle.textContent = 'Edit Period Dates';
                if (elHelper) elHelper.style.display = 'none';
                if (elSubmit) elSubmit.textContent = 'Apply Changes';
            }
        });
    });

    // Form Submission: Change Period (Create worksheets vs Edit range)
    const formChangePeriod = document.getElementById('form-change-period');
    if (formChangePeriod) {
        formChangePeriod.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const startInput = document.getElementById('period-start');
            const endInput = document.getElementById('period-end');
            if (!startInput || !endInput) return;

            const startVal = startInput.value;
            const endVal = endInput.value;

            // Validation: start date must be <= end date
            if (new Date(startVal) > new Date(endVal)) {
                showToastNotification('Start date cannot be after end date!', 'error');
                return;
            }

            const action = document.querySelector('input[name="period-action"]:checked').value;
            const newId = `${startVal}_${endVal}`;

            if (action === 'create') {
                // Check if a period with this identical range already exists
                if (state.periods.some(p => p.id === newId)) {
                    showToastNotification('A period worksheet with this identical date range already exists!', 'error');
                    return;
                }

                // Carry over currently active clients list to new period (with used hours and entries reset to 0!)
                const currentPeriod = getActivePeriod();
                const copiedClients = JSON.parse(JSON.stringify(currentPeriod.clients));
                
                // Clear any hidden and raw stats flags on copied clients
                copiedClients.forEach(c => {
                    delete c.hidden;
                });

                const newPeriod = {
                    id: newId,
                    start: startVal,
                    end: endVal,
                    clients: copiedClients,
                    entries: [] // Fresh entries list
                };

                state.periods.push(newPeriod);
                state.activePeriodId = newId;

                showToastNotification('Created new period worksheet with copied clients!', 'success');
            } else {
                // Editing existing period dates
                const activePeriod = getActivePeriod();
                
                // Verify the edited ID doesn't conflict with another period
                if (newId !== activePeriod.id && state.periods.some(p => p.id === newId)) {
                    showToastNotification('Another period worksheet with this date range already exists!', 'error');
                    return;
                }

                activePeriod.start = startVal;
                activePeriod.end = endVal;
                activePeriod.id = newId;
                state.activePeriodId = newId;

                showToastNotification('Applied new dates to this tracking period.', 'success');
            }

            saveState();
            render();

            modalChangePeriod.classList.remove('active');
        });
    }

    // Manage Assigned Hours Modal Trigger
    const cardAssignedTrigger = document.getElementById('card-assigned-trigger');
    const modalManageAssigned = document.getElementById('modal-manage-assigned');
    if (cardAssignedTrigger && modalManageAssigned) {
        cardAssignedTrigger.addEventListener('click', () => {
            renderAssignedHoursManagerList();
            modalManageAssigned.classList.add('active');
        });
    }

    // Manage Hidden Columns Modal
    const btnManageHidden = document.getElementById('btn-manage-hidden');
    const modalManageHidden = document.getElementById('modal-manage-hidden');
    if (btnManageHidden && modalManageHidden) {
        btnManageHidden.addEventListener('click', () => {
            modalManageHidden.classList.add('active');
        });
    }

    // Dynamic Modal Closes
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const modalId = btn.getAttribute('data-close');
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.remove('active');
        });
    });

    // Close on overlay clicking
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });

    // Force Update App (Clears cache and service workers, then hard reloads)
    const btnForceUpdate = document.getElementById('btn-force-update');
    if (btnForceUpdate) {
        btnForceUpdate.addEventListener('click', () => {
            if (confirm("Would you like to force-clear your device's cache and download the absolute latest app updates from the server?")) {
                showToastNotification('Clearing cache and updating app...', 'success');
                
                // 1. Unregister all active Service Workers
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(registrations => {
                        for (let registration of registrations) {
                            registration.unregister();
                        }
                    });
                }

                // 2. Clear all browser Caches
                if ('caches' in window) {
                    caches.keys().then(names => {
                        for (let name of names) {
                            caches.delete(name);
                        }
                    });
                }

                // 3. Clear session storage
                sessionStorage.clear();

                // 4. Force hard reload after a short delay
                setTimeout(() => {
                    window.location.reload(true);
                }, 800);
            }
        });
    }

    // Reset Sandbox Defaults
    const btnReset = document.getElementById('btn-reset-defaults');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            resetToDefaults(true);
        });
    }

    // Client Details: Manage Assigned Hours (Plus/Minus Buttons)
    const btnIncrease = document.getElementById('btn-increase-hours');
    if (btnIncrease) {
        btnIncrease.addEventListener('click', () => {
            if (!activeDetailsClientId) return;
            const activePeriod = getActivePeriod();
            const client = activePeriod.clients.find(c => c.id === activeDetailsClientId);
            if (!client) return;

            client.hours += 1;
            saveState();
            render();
            
            // Refresh modal
            openClientDetailsModal(client.id);
            showToastNotification(`Increased "${client.name}" assigned hours limit to ${client.hours} Hrs!`, 'success');
        });
    }

    const btnDecrease = document.getElementById('btn-decrease-hours');
    if (btnDecrease) {
        btnDecrease.addEventListener('click', () => {
            if (!activeDetailsClientId) return;
            const activePeriod = getActivePeriod();
            const client = activePeriod.clients.find(c => c.id === activeDetailsClientId);
            if (!client) return;

            const stats = getClientStats(client);

            // Validation: cannot drop below used hours
            if (client.hours <= stats.used) {
                showToastNotification(`Cannot drop hours below currently used (${formatDisplayHours(stats.used)} Hrs)!`, 'error');
                return;
            }

            if (client.hours <= 1) {
                showToastNotification('Assigned hours limit must be at least 1 Hr.', 'error');
                return;
            }

            client.hours -= 1;
            saveState();
            render();

            // Refresh modal
            openClientDetailsModal(client.id);
            showToastNotification(`Decreased "${client.name}" assigned hours limit to ${client.hours} Hrs.`, 'success');
        });
    }

    // Client Details: Save Client Name
    const btnSaveIdentity = document.getElementById('btn-save-client-identity');
    if (btnSaveIdentity) {
        btnSaveIdentity.addEventListener('click', () => {
            if (!activeDetailsClientId) return;

            const activePeriod = getActivePeriod();
            const client = activePeriod.clients.find(c => c.id === activeDetailsClientId);
            if (!client) return;

            const elNameInput = document.getElementById('details-edit-name');
            if (!elNameInput) return;

            const newName = elNameInput.value.trim();

            // Basic validation
            if (!newName) {
                showToastNotification('Client name cannot be empty!', 'error');
                return;
            }

            // Uniqueness validation check inside active period only
            const isTaken = activePeriod.clients.some(c => c.id !== client.id && c.name.toLowerCase() === newName.toLowerCase());
            if (isTaken) {
                showToastNotification(`A client with the name "${newName}" already exists!`, 'error');
                return;
            }

            const oldName = client.name;

            // Apply updates
            client.name = newName;

            saveState();
            render();

            // Close the Details modal
            const modalDetails = document.getElementById('modal-client-details');
            if (modalDetails) {
                modalDetails.classList.remove('active');
            }

            showToastNotification(`Updated client "${oldName}" details to "${client.name}" successfully!`, 'success');
        });
    }

    // Client Details: Danger actions (Hide & Delete)
    const btnHide = document.getElementById('btn-hide-client');
    if (btnHide) {
        btnHide.addEventListener('click', () => {
            if (activeDetailsClientId) {
                hideClient(activeDetailsClientId);
            }
        });
    }

    const btnDeleteCl = document.getElementById('btn-delete-client');
    if (btnDeleteCl) {
        btnDeleteCl.addEventListener('click', () => {
            if (activeDetailsClientId) {
                deleteClient(activeDetailsClientId);
            }
        });
    }

    // FORM SUBMISSION: Add Client
    const formAddClient = document.getElementById('form-add-client');
    if (formAddClient) {
        formAddClient.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const elName = document.getElementById('client-name');
            const elHours = document.getElementById('client-hours');
            if (!elName || !elHours) return;

            const name = elName.value.trim();
            const hours = parseInt(elHours.value);

            const activePeriod = getActivePeriod();

            // Validation checks: unique names in active period
            if (activePeriod.clients.some(c => c.name.toLowerCase() === name.toLowerCase())) {
                showToastNotification(`Client with name "${name}" already exists in this period!`, 'error');
                return;
            }

            const newClient = {
                id: 'c_' + Date.now(),
                name,
                hours
            };

            activePeriod.clients.push(newClient);
            saveState();
            render();
            
            formAddClient.reset();
            modalAddClient.classList.remove('active');
            
            showToastNotification(`Client "${name}" added to this period!`, 'success');
        });
    }

    // FORM SUBMISSION: Add Entry
    const formAddEntry = document.getElementById('form-add-entry');
    if (formAddEntry) {
        formAddEntry.addEventListener('submit', (e) => {
            e.preventDefault();

            const elClient = document.getElementById('entry-client');
            const elDate = document.getElementById('entry-date');
            const elHours = document.getElementById('entry-hours');
            const elNotes = document.getElementById('entry-notes');
            if (!elClient || !elDate || !elHours || !elNotes) return;

            const clientId = elClient.value;
            const date = elDate.value;
            const hours = parseFloat(elHours.value);
            const notes = elNotes.value.trim();

            if (isNaN(hours) || hours <= 0) {
                showToastNotification('Start time and End time cannot be the same!', 'error');
                return;
            }
            
            // Read selected time status (Used vs Planned)
            const entryTypeRadio = document.querySelector('input[name="entry-type"]:checked');
            const entryType = entryTypeRadio ? entryTypeRadio.value : 'actual';

            const elTimeFrom = document.getElementById('entry-time-from');
            const timeFrom = elTimeFrom ? elTimeFrom.value : '';

            const elTimeTo = document.getElementById('entry-time-to');
            const timeTo = elTimeTo ? elTimeTo.value : '';

            // Find appropriate period for this entry's date
            let targetPeriod = state.periods.find(p => date >= p.start && date <= p.end);
            let periodCreated = false;
            
            if (!targetPeriod) {
                // No period covers this date. Let's auto-create a monthly period for this date!
                const entryDateObj = new Date(date + 'T00:00:00');
                const yyyy = entryDateObj.getFullYear();
                const mm = (entryDateObj.getMonth() + 1).toString().padStart(2, '0');
                
                // Get last day of the month
                const lastDay = new Date(yyyy, entryDateObj.getMonth() + 1, 0).getDate();
                const startOfEntryMonth = `${yyyy}-${mm}-01`;
                const endOfEntryMonth = `${yyyy}-${mm}-${lastDay.toString().padStart(2, '0')}`;
                const newPeriodId = `${startOfEntryMonth}_${endOfEntryMonth}`;
                
                // Check if this month period already exists
                targetPeriod = state.periods.find(p => p.id === newPeriodId);
                
                if (!targetPeriod) {
                    // Carry over clients from current active period
                    const currentPeriod = getActivePeriod();
                    const copiedClients = JSON.parse(JSON.stringify(currentPeriod.clients));
                    copiedClients.forEach(c => {
                        delete c.hidden;
                    });
                    
                    targetPeriod = {
                        id: newPeriodId,
                        start: startOfEntryMonth,
                        end: endOfEntryMonth,
                        clients: copiedClients,
                        entries: []
                    };
                    state.periods.push(targetPeriod);
                    periodCreated = true;
                }
            }

            // Switch to the target period
            if (state.activePeriodId !== targetPeriod.id) {
                state.activePeriodId = targetPeriod.id;
            }

            // Make sure the entry is added to the target period's client matching clientId
            let client = targetPeriod.clients.find(c => c.id === clientId);
            if (!client) {
                // If the client ID does not match, try to match by name
                const origPeriod = state.periods.find(p => p.clients.some(c => c.id === clientId));
                const origClient = origPeriod ? origPeriod.clients.find(c => c.id === clientId) : null;
                if (origClient) {
                    client = targetPeriod.clients.find(c => c.name.toLowerCase() === origClient.name.toLowerCase());
                }
            }
            if (!client) {
                client = targetPeriod.clients[0];
            }
            if (!client) return;

            const stats = getClientStats(client, targetPeriod);

            // Validating remaining capacity
            if (hours > stats.remaining) {
                showToastNotification(`Overlimit! Client only has ${formatDisplayHours(stats.remaining)} hours left.`, 'error');
                return;
            }

            const elKms = document.getElementById('entry-kms');
            const kms = elKms ? parseFloat(elKms.value) || 0 : 0;

            const newEntry = {
                id: 'e_' + Date.now(),
                clientId: client.id,
                date,
                hours,
                notes,
                type: entryType,
                timeFrom: timeFrom,
                timeTo: timeTo,
                kms: kms
            };

            if (!targetPeriod.entries) targetPeriod.entries = [];
            targetPeriod.entries.push(newEntry);
            
            // Adjust the calendar month view date to follow the new entry's month!
            calendarViewDate = new Date(date + 'T00:00:00');

            saveState();
            render();

            formAddEntry.reset();
            
            // Restore default Used/Actual option in radio group
            const defaultRadio = document.querySelector('input[name="entry-type"][value="actual"]');
            if (defaultRadio) defaultRadio.checked = true;
            
            prefillDefaultDate();
            modalAddEntry.classList.remove('active');

            const textTypeLabel = entryType === 'planned' ? 'planned hours' : 'used hours';
            showToastNotification(`Successfully added ${hours} ${textTypeLabel} to client "${client.name}"!`, 'success');
        });
    }

    // FORM SUBMISSION: Edit Entry
    const formEditEntry = document.getElementById('form-edit-entry');
    if (formEditEntry) {
        formEditEntry.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const elId = document.getElementById('edit-entry-id');
            const elDate = document.getElementById('edit-entry-date');
            const elHours = document.getElementById('edit-entry-hours');
            const elNotes = document.getElementById('edit-entry-notes');
            if (!elId || !elDate || !elHours || !elNotes) return;

            const entryId = elId.value;
            const date = elDate.value;
            const hours = parseFloat(elHours.value);
            const notes = elNotes.value.trim();

            if (isNaN(hours) || hours <= 0) {
                showToastNotification('Start time and End time cannot be the same!', 'error');
                return;
            }
            
            // Read selected time status
            const entryTypeRadio = document.querySelector('input[name="edit-entry-type"]:checked');
            const entryType = entryTypeRadio ? entryTypeRadio.value : 'actual';

            const elTimeFrom = document.getElementById('edit-entry-time-from');
            const timeFrom = elTimeFrom ? elTimeFrom.value : '';

            const elTimeTo = document.getElementById('edit-entry-time-to');
            const timeTo = elTimeTo ? elTimeTo.value : '';

            const activePeriod = getActivePeriod();
            const entry = activePeriod.entries.find(e => e.id === entryId);
            if (!entry) return;

            const client = activePeriod.clients.find(c => c.id === entry.clientId);
            if (!client) return;

            const stats = getClientStats(client);
            
            // Validation: maximum allowed hours is remaining capacity plus this entry's current hours
            const maxAllowed = stats.remaining + entry.hours;

            if (hours > maxAllowed) {
                showToastNotification(`Overlimit! Maximum allowed for this entry is ${formatDisplayHours(maxAllowed)} Hrs.`, 'error');
                return;
            }

            if (hours <= 0) {
                showToastNotification('Hours must be greater than zero.', 'error');
                return;
            }

            const elKms = document.getElementById('edit-entry-kms');
            const kms = elKms ? parseFloat(elKms.value) || 0 : 0;

            // Update details
            entry.date = date;
            entry.hours = hours;
            entry.notes = notes;
            entry.type = entryType;
            entry.timeFrom = timeFrom;
            entry.timeTo = timeTo;
            entry.kms = kms;
            if ('time' in entry) {
                delete entry.time;
            }

            // If the date has changed to fall outside the current period
            if (date < activePeriod.start || date > activePeriod.end) {
                // Find target period for the new date
                let targetPeriod = state.periods.find(p => date >= p.start && date <= p.end);
                
                if (!targetPeriod) {
                    // No period covers this date. Let's auto-create a monthly period for this date!
                    const entryDateObj = new Date(date + 'T00:00:00');
                    const yyyy = entryDateObj.getFullYear();
                    const mm = (entryDateObj.getMonth() + 1).toString().padStart(2, '0');
                    
                    const lastDay = new Date(yyyy, entryDateObj.getMonth() + 1, 0).getDate();
                    const startOfEntryMonth = `${yyyy}-${mm}-01`;
                    const endOfEntryMonth = `${yyyy}-${mm}-${lastDay.toString().padStart(2, '0')}`;
                    const newPeriodId = `${startOfEntryMonth}_${endOfEntryMonth}`;
                    
                    targetPeriod = state.periods.find(p => p.id === newPeriodId);
                    
                    if (!targetPeriod) {
                        const copiedClients = JSON.parse(JSON.stringify(activePeriod.clients));
                        copiedClients.forEach(c => {
                            delete c.hidden;
                        });
                        
                        targetPeriod = {
                            id: newPeriodId,
                            start: startOfEntryMonth,
                            end: endOfEntryMonth,
                            clients: copiedClients,
                            entries: []
                        };
                        state.periods.push(targetPeriod);
                        showToastNotification(`Automatically created a new monthly period worksheet for ${formatDate(startOfEntryMonth).split(',')[1].trim().split(' ')[0]} ${yyyy}!`, 'success');
                    }
                }

                // Switch to the target period
                state.activePeriodId = targetPeriod.id;

                // Remove entry from the old period
                activePeriod.entries = activePeriod.entries.filter(e => e.id !== entry.id);

                // Make sure the client exists in targetPeriod
                let targetClient = targetPeriod.clients.find(c => c.id === entry.clientId);
                if (!targetClient) {
                    targetClient = targetPeriod.clients.find(c => c.name.toLowerCase() === client.name.toLowerCase());
                }
                if (!targetClient) {
                    targetClient = targetPeriod.clients[0];
                }
                if (targetClient) {
                    entry.clientId = targetClient.id;
                }

                // Push to targetPeriod
                if (!targetPeriod.entries) targetPeriod.entries = [];
                targetPeriod.entries.push(entry);
            }

            // Adjust calendarMonthView date to match the entry's date!
            calendarViewDate = new Date(date + 'T00:00:00');

            saveState();
            render();

            // Hide Modal
            document.getElementById('modal-edit-entry').classList.remove('active');

            // Refresh Details modal if active for this client
            if (activeDetailsClientId === client.id) {
                openClientDetailsModal(client.id);
            }

            showToastNotification(`Successfully updated entry for client "${client.name}"!`, 'success');
        });
    }
}

// ==========================================================================
// TOAST FEEDBACK NOTIFICATIONS
// ==========================================================================

function showToastNotification(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' 
        ? '<i class="fa-solid fa-circle-check"></i>' 
        : '<i class="fa-solid fa-triangle-exclamation"></i>';

    toast.innerHTML = `
        ${icon}
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Fade and remove toast after 3 seconds
    setTimeout(() => {
        toast.style.transition = 'opacity 300ms ease, transform 300ms ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-1rem)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Register Service Worker for PWA mobile installation
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('Service Worker registered successfully!', reg.scope))
            .catch(err => console.log('Service Worker registration failed:', err));
    });
}

// Initialize Application on Content Loaded
document.addEventListener('DOMContentLoaded', initApp);
