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
    return getOverallStatsForPeriod(getActivePeriod());
}

function getOverallStatsForPeriod(period) {
    if (!period) return { assigned: 0, used: 0, planned: 0, remaining: 0, kms: 0 };
    
    let totalAssigned = 0;
    let totalUsed = 0;
    let totalPlanned = 0;
    let totalKms = 0;

    const visibleClients = period.clients.filter(c => !c.hidden);

    visibleClients.forEach(client => {
        totalAssigned += client.hours;
        const stats = getClientStats(client, period);
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
    renderRecentActivity();
    renderClientsGrid();
    populateClientDropdowns();
    renderHiddenClientsManager();
    renderCalendar();

    // Refresh the profile page if it's currently active!
    const viewProfile = document.getElementById('view-profile');
    if (viewProfile && !viewProfile.classList.contains('hidden')) {
        renderProfilePage();
    }
}

function renderRecentActivity() {
    const activePeriod = getActivePeriod();
    const container = document.getElementById('recent-activity-timeline');
    if (!container) return;

    container.innerHTML = '';

    const allEntries = [];
    activePeriod.clients.forEach(client => {
        const stats = getClientStats(client, activePeriod);
        const entries = stats.entries || [];
        entries.forEach(entry => {
            allEntries.push({
                entry,
                client
            });
        });
    });

    // Sort entries descending: newest first
    allEntries.sort((a, b) => {
        if (a.entry.date !== b.entry.date) {
            return b.entry.date.localeCompare(a.entry.date);
        }
        const timeA = a.entry.timeFrom || '00:00';
        const timeB = b.entry.timeFrom || '00:00';
        return timeB.localeCompare(timeA);
    });

    const recentLogs = allEntries.slice(0, 5);

    if (recentLogs.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 2rem 0; width: 100%;">
                <i class="fa-solid fa-circle-info" style="font-size: 1.5rem; opacity: 0.3; margin-bottom: 0.5rem; display: block;"></i>
                No entries logged in this period.
            </div>
        `;
        return;
    }

    const now = new Date();

    recentLogs.forEach(log => {
        const entry = log.entry;
        const client = log.client;
        
        const split = getEntryHoursSplit(entry, now);
        const isCompleted = split.used > 0 && split.planned === 0;
        const isPlanned = split.planned > 0;
        
        // Extract initials (e.g. "Ryan B" -> "RB", "Jamie" -> "J")
        const initials = client.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        
        // Match client specific color class or default to fallback
        const colorClass = getClientColorClass(client.name) || 'client-fallback';
        
        let badgeClass = 'system';
        let badgeIcon = '&middot;';
        let text = '';

        if (entry.kms > 0) {
            badgeClass = 'kms';
            badgeIcon = '<i class="fa-solid fa-car"></i>';
            text = `<strong>${client.name}</strong>: Traveled ${entry.kms} Kms (${formatDisplayHours(entry.hours)}h logged)`;
        } else if (isCompleted) {
            badgeClass = 'completed';
            badgeIcon = '<i class="fa-solid fa-check"></i>';
            text = `<strong>${client.name}</strong>: Session completed - ${formatDisplayHours(entry.hours)}h`;
        } else if (isPlanned) {
            badgeClass = 'planned';
            badgeIcon = '<i class="fa-solid fa-calendar"></i>';
            text = `<strong>${client.name}</strong>: Scheduled session - ${formatDisplayHours(entry.hours)}h`;
        } else {
            badgeClass = 'completed';
            badgeIcon = '<i class="fa-solid fa-clock"></i>';
            text = `<strong>${client.name}</strong>: Logged ${formatDisplayHours(entry.hours)}h`;
        }

        if (entry.notes && entry.notes.trim()) {
            text += ` <span style="display: block; font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; font-style: italic;">"${entry.notes}"</span>`;
        }

        const dateStr = formatActivityDate(entry.date);

        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
            <div class="activity-avatar-container">
                <div class="activity-dot ${colorClass}">
                    ${initials}
                </div>
                <div class="activity-type-badge ${badgeClass}">
                    ${badgeIcon}
                </div>
            </div>
            <div class="activity-body">
                <span class="activity-text">${text}</span>
                <span class="activity-time">${dateStr} &middot; ${entry.timeFrom || '00:00'} - ${entry.timeTo || '00:00'}</span>
            </div>
        `;
        container.appendChild(item);
    });
}

function formatActivityDate(dateString) {
    const parts = dateString.split('-');
    if (parts.length !== 3) return dateString;
    
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    
    const entryDate = new Date(year, month, day);
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (entryDate.getTime() === today.getTime()) {
        return 'Today';
    } else if (entryDate.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    }
    
    return entryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Render dynamic periods dropdown select options
function renderPeriodDropdown() {
    const dropdown = document.getElementById('period-select-dropdown');
    const calDropdown = document.getElementById('calendar-period-select');
    const progressDropdown = document.getElementById('progress-period-select-dropdown');
    
    const dropdowns = [];
    if (dropdown) dropdowns.push(dropdown);
    if (calDropdown) dropdowns.push(calDropdown);
    if (progressDropdown) dropdowns.push(progressDropdown);
    
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

    // Calculate trend compared to the previous period
    const sortedPeriods = [...state.periods].sort((a, b) => new Date(a.start) - new Date(b.start));
    const activeIdx = sortedPeriods.findIndex(p => p.id === state.activePeriodId);
    const prevPeriod = activeIdx > 0 ? sortedPeriods[activeIdx - 1] : null;
    
    const trendAssigned = document.getElementById('trend-assigned');
    const trendUsed = document.getElementById('trend-used');
    const trendRemaining = document.getElementById('trend-remaining');
    const trendKms = document.getElementById('trend-kms');

    if (prevPeriod) {
        const prevStats = getOverallStatsForPeriod(prevPeriod);
        
        // 1. Assigned Hours Trend
        const assignedDiff = stats.assigned - prevStats.assigned;
        if (trendAssigned) {
            if (assignedDiff > 0) {
                trendAssigned.className = 'trend-badge up';
                trendAssigned.innerHTML = `<i class="fa-solid fa-arrow-up" style="font-size: 0.6rem;"></i> +${formatDisplayHours(assignedDiff)}`;
            } else if (assignedDiff < 0) {
                trendAssigned.className = 'trend-badge down';
                trendAssigned.innerHTML = `<i class="fa-solid fa-arrow-down" style="font-size: 0.6rem;"></i> -${formatDisplayHours(Math.abs(assignedDiff))}`;
            } else {
                trendAssigned.className = 'trend-badge neutral';
                trendAssigned.innerHTML = `<i class="fa-solid fa-minus" style="font-size: 0.6rem;"></i> 0`;
            }
        }

        // 2. Used Hours Trend (Percentage of Assigned)
        if (trendUsed) {
            const usedPct = stats.assigned > 0 ? Math.round((stats.used / stats.assigned) * 100) : 0;
            trendUsed.className = usedPct >= 75 ? 'trend-badge up' : (usedPct >= 40 ? 'trend-badge info' : 'trend-badge neutral');
            trendUsed.innerHTML = `<i class="fa-solid fa-chart-line" style="font-size: 0.6rem;"></i> ${usedPct}%`;
        }

        // 3. Remaining Hours Trend (Percentage of Assigned)
        if (trendRemaining) {
            const remainingPct = stats.assigned > 0 ? Math.round((stats.remaining / stats.assigned) * 100) : 0;
            trendRemaining.className = remainingPct > 25 ? 'trend-badge info' : (remainingPct > 0 ? 'trend-badge down' : 'trend-badge neutral');
            trendRemaining.innerHTML = `<i class="fa-solid fa-hourglass" style="font-size: 0.6rem;"></i> ${remainingPct}%`;
        }

        // 4. Kms Trend
        if (trendKms) {
            const kmsDiff = stats.kms - prevStats.kms;
            if (prevStats.kms > 0) {
                const kmsPct = Math.round((kmsDiff / prevStats.kms) * 100);
                if (kmsPct > 0) {
                    trendKms.className = 'trend-badge up';
                    trendKms.innerHTML = `<i class="fa-solid fa-arrow-up" style="font-size: 0.6rem;"></i> +${kmsPct}%`;
                } else if (kmsPct < 0) {
                    trendKms.className = 'trend-badge down';
                    trendKms.innerHTML = `<i class="fa-solid fa-arrow-down" style="font-size: 0.6rem;"></i> ${kmsPct}%`;
                } else {
                    trendKms.className = 'trend-badge neutral';
                    trendKms.innerHTML = `<i class="fa-solid fa-minus" style="font-size: 0.6rem;"></i> 0%`;
                }
            } else {
                trendKms.className = 'trend-badge info';
                trendKms.innerHTML = `<i class="fa-solid fa-circle-info" style="font-size: 0.6rem;"></i> new`;
            }
        }
    } else {
        // Fallbacks when no previous period exists
        if (trendAssigned) {
            trendAssigned.className = 'trend-badge info';
            trendAssigned.innerHTML = `<i class="fa-solid fa-star" style="font-size: 0.6rem;"></i> active`;
        }
        if (trendUsed) {
            const usedPct = stats.assigned > 0 ? Math.round((stats.used / stats.assigned) * 100) : 0;
            trendUsed.className = 'trend-badge info';
            trendUsed.innerHTML = `<i class="fa-solid fa-chart-line" style="font-size: 0.6rem;"></i> ${usedPct}%`;
        }
        if (trendRemaining) {
            const remainingPct = stats.assigned > 0 ? Math.round((stats.remaining / stats.assigned) * 100) : 0;
            trendRemaining.className = 'trend-badge info';
            trendRemaining.innerHTML = `<i class="fa-solid fa-hourglass" style="font-size: 0.6rem;"></i> ${remainingPct}%`;
        }
        if (trendKms) {
            trendKms.className = 'trend-badge info';
            trendKms.innerHTML = `<i class="fa-solid fa-car" style="font-size: 0.6rem;"></i> start`;
        }
    }

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
    const searchInput = document.getElementById('header-search-input');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const visibleClients = activePeriod.clients.filter(c => {
        if (c.hidden) return false;
        if (query) {
            return c.name.toLowerCase().includes(query);
        }
        return true;
    });

    if (visibleClients.length === 0) {
        if (query) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 4rem; color: var(--text-muted);">
                    <i class="fa-solid fa-magnifying-glass" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <p style="font-weight: 600;">No clients match "${query}".</p>
                </div>
            `;
        } else {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 4rem; color: var(--text-muted);">
                    <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <p style="font-weight: 600;">No active columns visible in this period.</p>
                    <p style="font-size: 0.875rem; margin-top: 4px;">Click "+ Add Client" or restore hidden columns from the header menu.</p>
                </div>
            `;
        }
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
                    &minus;
                </button>
                <button class="btn-quick-adjust btn-quick-plus" title="Add used/planned hours for this client">
                    +
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
    state.activeProfileClientId = clientId;
    activeDetailsClientId = clientId;
    handleTabSwitch('profile');
}

// Legacy modal binder (kept as fallback for compatibility)
function legacyOpenClientDetailsModal(clientId) {
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
                <button class="btn-hour-adjust btn-decrease-assigned" title="Decrease Assigned Hours" style="width: 28px; height: 28px; font-size: 0.75rem; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer; border: 1px solid var(--muted-color); background-color: var(--card-bg); color: var(--fg-color); transition: all 120ms ease;">
                    &minus;
                </button>
                <span class="assigned-hours-display" style="font-weight: 700; font-size: 0.9375rem; color: var(--fg-color); min-width: 48px; text-align: center; display: inline-block;">
                    ${client.hours} Hrs
                </span>
                <button class="btn-hour-adjust btn-increase-assigned" title="Increase Assigned Hours" style="width: 28px; height: 28px; font-size: 0.75rem; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 6px; cursor: pointer; border: 1px solid var(--muted-color); background-color: var(--card-bg); color: var(--fg-color); transition: all 120ms ease;">
                    +
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

    // 1. Navigation Tab Switching Event Listeners
    const tabButtons = document.querySelectorAll('.app-nav .nav-item');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            handleTabSwitch(tabName);
        });
    });

    const logoBtn = document.getElementById('nav-logo-btn');
    if (logoBtn) {
        logoBtn.addEventListener('click', () => {
            handleTabSwitch('dashboard');
        });
    }

    // 2. Real-time Search Input Listener
    const searchInput = document.getElementById('header-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderClientsGrid();
            const progressView = document.getElementById('view-progress');
            if (progressView && !progressView.classList.contains('hidden')) {
                renderProgressClientList();
            }
        });
    }

    // 3. Progress Period Dropdown Listener
    const progressPeriodDropdown = document.getElementById('progress-period-select-dropdown');
    if (progressPeriodDropdown) {
        progressPeriodDropdown.addEventListener('change', (e) => {
            const selectedId = e.target.value;
            if (state.periods.some(p => p.id === selectedId)) {
                state.activePeriodId = selectedId;
                activeDetailsClientId = null;
                const period = state.periods.find(p => p.id === selectedId);
                if (period) {
                    calendarViewDate = new Date(period.start + 'T00:00:00');
                }
                saveState();
                prefillDefaultDate();
                render();
                renderProgressPage();
                showToastNotification('Switched tracking period worksheet!', 'success');
            }
        });
    }

    // 4. Export Progress Report to CSV Listener
    const btnExportProgress = document.getElementById('btn-export-progress');
    if (btnExportProgress) {
        btnExportProgress.addEventListener('click', () => {
            const activePeriod = getActivePeriod();
            let csvContent = "data:text/csv;charset=utf-8,";
            csvContent += "Client,Assigned Hours,Used Hours,Planned Hours,Remaining Hours,Status\n";
            
            activePeriod.clients.filter(c => !c.hidden).forEach(client => {
                const stats = getClientStats(client);
                const badge = getProgressBadge(stats.used, client.hours);
                csvContent += `"${client.name}",${client.hours},${stats.used.toFixed(2)},${stats.planned.toFixed(2)},${stats.remaining.toFixed(2)},"${badge.text}"\n`;
            });
            
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `client_hours_progress_${activePeriod.id}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToastNotification('Progress CSV report exported!', 'success');
        });
    }

    const linkDetailedReport = document.getElementById('link-progress-detailed-report');
    if (linkDetailedReport) {
        linkDetailedReport.addEventListener('click', (e) => {
            e.preventDefault();
            if (btnExportProgress) {
                btnExportProgress.click();
            }
        });
    }

    // 5. Client Profile: Dropdown Client Selector
    const profileClientSelect = document.getElementById('profile-client-select-dropdown');
    if (profileClientSelect) {
        profileClientSelect.addEventListener('change', (e) => {
            state.activeProfileClientId = e.target.value;
            saveState();
            renderProfilePage();
        });
    }

    // 6. Client Profile: Tab Switching (Sessions, Goals, Notes)
    const profileTabItems = document.querySelectorAll('.profile-tab-item');
    profileTabItems.forEach(btn => {
        btn.addEventListener('click', () => {
            activeProfileSubTab = btn.getAttribute('data-subtab');
            renderProfilePage();
        });
    });

    // 7. Client Profile: Message Action
    const btnProfileMessage = document.getElementById('btn-profile-message');
    if (btnProfileMessage) {
        btnProfileMessage.addEventListener('click', () => {
            const activePeriod = getActivePeriod();
            const client = activePeriod.clients.find(c => c.id === state.activeProfileClientId);
            if (client) {
                showToastNotification(`Opened chat channel with ${client.name}'s care team!`, 'success');
            }
        });
    }

    // 8. Client Profile: Open Edit Profile modal
    const btnProfileEdit = document.getElementById('btn-profile-edit');
    const modalProfileEdit = document.getElementById('modal-edit-profile');
    if (btnProfileEdit && modalProfileEdit) {
        btnProfileEdit.addEventListener('click', () => {
            const activePeriod = getActivePeriod();
            const client = activePeriod.clients.find(c => c.id === state.activeProfileClientId);
            if (!client) return;

            migrateClientProfileState(client);

            document.getElementById('edit-profile-name').value = client.name;
            document.getElementById('edit-profile-support').value = client.supportType;
            document.getElementById('edit-profile-start-date').value = client.startDate;
            document.getElementById('edit-profile-status').value = client.status;
            document.getElementById('edit-profile-phone').value = client.phone;
            document.getElementById('edit-profile-email').value = client.email;
            document.getElementById('edit-profile-address').value = client.address;
            document.getElementById('edit-profile-em-name').value = client.emergencyContactName;
            document.getElementById('edit-profile-em-relation').value = client.emergencyContactRelation;
            document.getElementById('edit-profile-em-phone').value = client.emergencyContactPhone;

            modalProfileEdit.classList.add('active');
        });
    }

    // 9. Client Profile: Save Edit Profile
    const formProfileEdit = document.getElementById('form-edit-profile');
    if (formProfileEdit) {
        formProfileEdit.addEventListener('submit', (e) => {
            e.preventDefault();
            const activePeriod = getActivePeriod();
            const client = activePeriod.clients.find(c => c.id === state.activeProfileClientId);
            if (!client) return;

            client.name = document.getElementById('edit-profile-name').value.trim();
            client.supportType = document.getElementById('edit-profile-support').value.trim();
            client.startDate = document.getElementById('edit-profile-start-date').value;
            client.status = document.getElementById('edit-profile-status').value;
            client.phone = document.getElementById('edit-profile-phone').value.trim();
            client.email = document.getElementById('edit-profile-email').value.trim();
            client.address = document.getElementById('edit-profile-address').value.trim();
            client.emergencyContactName = document.getElementById('edit-profile-em-name').value.trim();
            client.emergencyContactRelation = document.getElementById('edit-profile-em-relation').value.trim();
            client.emergencyContactPhone = document.getElementById('edit-profile-em-phone').value.trim();

            saveState();
            render();
            renderProfilePage();

            modalProfileEdit.classList.remove('active');
            showToastNotification(`Profile for "${client.name}" updated successfully!`, 'success');
        });
    }

    // 10. Client Profile: Add Session (Log time)
    const btnProfileAddSession = document.getElementById('profile-btn-add-session');
    if (btnProfileAddSession && modalAddEntry) {
        btnProfileAddSession.addEventListener('click', () => {
            const formAddEntry = document.getElementById('form-add-entry');
            if (formAddEntry) {
                formAddEntry.reset();
            }
            prefillDefaultDate();

            const entryClientDropdown = document.getElementById('entry-client');
            if (entryClientDropdown) {
                entryClientDropdown.value = state.activeProfileClientId;
            }

            modalAddEntry.classList.add('active');
        });
    }

    // 11. Client Profile: Add Goal Modal open & submit
    const btnProfileAddGoal = document.getElementById('profile-btn-add-goal');
    const modalAddGoal = document.getElementById('modal-add-goal');
    if (btnProfileAddGoal && modalAddGoal) {
        btnProfileAddGoal.addEventListener('click', () => {
            const formAddGoal = document.getElementById('form-add-goal');
            if (formAddGoal) {
                formAddGoal.reset();
            }
            modalAddGoal.classList.add('active');
        });
    }

    const formAddGoal = document.getElementById('form-add-goal');
    if (formAddGoal) {
        formAddGoal.addEventListener('submit', (e) => {
            e.preventDefault();
            const activePeriod = getActivePeriod();
            const client = activePeriod.clients.find(c => c.id === state.activeProfileClientId);
            if (!client) return;

            const text = document.getElementById('goal-text').value.trim();
            if (!text) return;

            if (!client.goals) client.goals = [];
            client.goals.push({
                id: 'g_' + Date.now(),
                text: text,
                completed: false
            });

            saveState();
            renderProfilePage();

            modalAddGoal.classList.remove('active');
            showToastNotification('Care goal added successfully!', 'success');
        });
    }

    // 12. Client Profile: Add Note Modal open & submit
    const btnProfileAddNote = document.getElementById('profile-btn-add-note');
    const modalAddNote = document.getElementById('modal-add-note');
    if (btnProfileAddNote && modalAddNote) {
        btnProfileAddNote.addEventListener('click', () => {
            const formAddNote = document.getElementById('form-add-note');
            if (formAddNote) {
                formAddNote.reset();
            }
            modalAddNote.classList.add('active');
        });
    }

    const formAddNote = document.getElementById('form-add-note');
    if (formAddNote) {
        formAddNote.addEventListener('submit', (e) => {
            e.preventDefault();
            const activePeriod = getActivePeriod();
            const client = activePeriod.clients.find(c => c.id === state.activeProfileClientId);
            if (!client) return;

            const text = document.getElementById('note-text-area').value.trim();
            if (!text) return;

            const today = new Date();
            const dateStr = today.getFullYear() + '-' + 
                            String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                            String(today.getDate()).padStart(2, '0');

            if (!client.notes) client.notes = [];
            client.notes.push({
                id: 'n_' + Date.now(),
                date: dateStr,
                text: text
            });

            saveState();
            renderProfilePage();

            modalAddNote.classList.remove('active');
            showToastNotification('Care note added successfully!', 'success');
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
            .then(reg => {
                console.log('Service Worker registered successfully!', reg.scope);
                // Force check for updates on load
                reg.update();

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('New version detected! Auto-reloading page...');
                                window.location.reload();
                            }
                        });
                    }
                });
            })
            .catch(err => console.log('Service Worker registration failed:', err));
    });
}

// Initialize Application on Content Loaded
document.addEventListener('DOMContentLoaded', initApp);

// ==========================================================================
// SPA TAB SWITCHING & PROGRESS VIEW RENDER ENGINE
// ==========================================================================

function handleTabSwitch(tabName) {
    const viewDashboard = document.getElementById('view-dashboard');
    const viewProgress = document.getElementById('view-progress');
    const viewProfile = document.getElementById('view-profile');
    const navItems = document.querySelectorAll('.nav-item');
    
    // Clear active classes from nav items
    navItems.forEach(btn => btn.classList.remove('active'));

    if (tabName === 'dashboard') {
        if (viewDashboard) viewDashboard.classList.remove('hidden');
        if (viewProgress) viewProgress.classList.add('hidden');
        if (viewProfile) viewProfile.classList.add('hidden');
        const dashBtn = document.getElementById('nav-btn-dashboard');
        if (dashBtn) dashBtn.classList.add('active');
        render(); // render dashboard views
    } else if (tabName === 'progress') {
        if (viewDashboard) viewDashboard.classList.add('hidden');
        if (viewProgress) viewProgress.classList.remove('hidden');
        if (viewProfile) viewProfile.classList.add('hidden');
        const progBtn = document.getElementById('nav-btn-progress');
        if (progBtn) progBtn.classList.add('active');
        renderProgressPage();
    } else if (tabName === 'profile') {
        if (viewDashboard) viewDashboard.classList.add('hidden');
        if (viewProgress) viewProgress.classList.add('hidden');
        if (viewProfile) viewProfile.classList.remove('hidden');
        const profBtn = document.getElementById('nav-btn-profile');
        if (profBtn) profBtn.classList.add('active');
        renderProfilePage();
    } else if (tabName === 'log') {
        // Keep current tab active
        const activeTab = document.querySelector('.nav-item.active') || document.getElementById('nav-btn-dashboard');
        if (activeTab) activeTab.classList.add('active');
        // Open Add Entry modal
        const modalAddEntry = document.getElementById('modal-add-entry');
        if (modalAddEntry) {
            const formAddEntry = document.getElementById('form-add-entry');
            if (formAddEntry) {
                formAddEntry.reset();
                prefillDefaultDate();
            }
            modalAddEntry.classList.add('active');
        }
    }
}

function renderProgressPage() {
    const activePeriod = getActivePeriod();
    const sortedPeriods = [...state.periods].sort((a, b) => new Date(a.start) - new Date(b.start));
    const activeIdx = sortedPeriods.findIndex(p => p.id === state.activePeriodId);
    const prevPeriod = activeIdx > 0 ? sortedPeriods[activeIdx - 1] : null;
    
    // 1. Total Hours Logged (this year)
    const activeYear = new Date(activePeriod.start + 'T00:00:00').getFullYear();
    let totalLoggedYear = 0;
    state.periods.forEach(p => {
        const pYear = new Date(p.start + 'T00:00:00').getFullYear();
        if (pYear === activeYear && p.entries) {
            p.entries.forEach(e => {
                if (e.type !== 'planned') {
                    totalLoggedYear += e.hours;
                }
            });
        }
    });
    
    const totalLoggedEl = document.getElementById('progress-total-logged');
    if (totalLoggedEl) {
        totalLoggedEl.textContent = `${formatDisplayHours(totalLoggedYear)}h`;
    }
    
    // Trend for Logged
    let currentPeriodLogged = 0;
    activePeriod.entries.forEach(e => {
        if (e.type !== 'planned') currentPeriodLogged += e.hours;
    });
    
    let trendLoggedHtml = '';
    if (prevPeriod) {
        let prevPeriodLogged = 0;
        prevPeriod.entries.forEach(e => {
            if (e.type !== 'planned') prevPeriodLogged += e.hours;
        });
        const diff = currentPeriodLogged - prevPeriodLogged;
        if (prevPeriodLogged > 0) {
            const pct = Math.round((diff / prevPeriodLogged) * 100);
            if (pct > 0) {
                trendLoggedHtml = `<i class="fa-solid fa-arrow-trend-up"></i> +${pct}%`;
            } else if (pct < 0) {
                trendLoggedHtml = `<i class="fa-solid fa-arrow-trend-down"></i> ${pct}%`;
            } else {
                trendLoggedHtml = `<i class="fa-solid fa-minus"></i> 0%`;
            }
        } else {
            trendLoggedHtml = `<i class="fa-solid fa-plus"></i> New`;
        }
    } else {
        trendLoggedHtml = `<i class="fa-solid fa-minus"></i> --`;
    }
    
    // Set trend in card 1
    if (totalLoggedEl) {
        const trendEl = totalLoggedEl.parentElement.querySelector('.metric-trend');
        if (trendEl) {
            trendEl.innerHTML = trendLoggedHtml;
            trendEl.className = `metric-trend ${trendLoggedHtml.includes('down') ? 'down' : (trendLoggedHtml.includes('--') ? '' : 'up')}`;
        }
    }
    
    // 2. Active Clients
    const activeClientsCount = activePeriod.clients.filter(c => !c.hidden).length;
    const activeClientsEl = document.getElementById('progress-active-clients');
    if (activeClientsEl) {
        activeClientsEl.textContent = activeClientsCount;
    }
    
    let prevClientsCount = 0;
    if (prevPeriod) {
        prevClientsCount = prevPeriod.clients.filter(c => !c.hidden).length;
    }
    const clientDiff = activeClientsCount - prevClientsCount;
    let trendClientsHtml = '';
    if (prevPeriod) {
        if (clientDiff > 0) {
            trendClientsHtml = `<i class="fa-solid fa-plus"></i> +${clientDiff}`;
        } else if (clientDiff < 0) {
            trendClientsHtml = `<i class="fa-solid fa-minus"></i> -${Math.abs(clientDiff)}`;
        } else {
            trendClientsHtml = `<i class="fa-solid fa-minus"></i> 0`;
        }
    } else {
        trendClientsHtml = `<i class="fa-solid fa-minus"></i> --`;
    }
    
    if (activeClientsEl) {
        const trendEl = activeClientsEl.parentElement.querySelector('.metric-trend');
        if (trendEl) {
            trendEl.innerHTML = trendClientsHtml;
            trendEl.className = `metric-trend ${trendClientsHtml.includes('-') ? 'down' : (trendClientsHtml.includes('--') ? '' : 'up')}`;
        }
    }
    
    // 3. Avg Session Length
    const actualEntries = activePeriod.entries.filter(e => e.type !== 'planned');
    let avgSession = 0;
    if (actualEntries.length > 0) {
        const total = actualEntries.reduce((sum, e) => sum + e.hours, 0);
        avgSession = total / actualEntries.length;
    }
    const avgSessionEl = document.getElementById('progress-avg-session');
    if (avgSessionEl) {
        avgSessionEl.textContent = `${avgSession.toFixed(1)}h`;
    }
    
    let prevAvgSession = 0;
    if (prevPeriod) {
        const prevActual = prevPeriod.entries.filter(e => e.type !== 'planned');
        if (prevActual.length > 0) {
            prevAvgSession = prevActual.reduce((sum, e) => sum + e.hours, 0) / prevActual.length;
        }
    }
    const avgDiff = avgSession - prevAvgSession;
    let trendAvgHtml = '';
    if (prevPeriod) {
        if (avgDiff > 0) {
            trendAvgHtml = `<i class="fa-solid fa-arrow-trend-up"></i> +${avgDiff.toFixed(1)}h`;
        } else if (avgDiff < 0) {
            trendAvgHtml = `<i class="fa-solid fa-arrow-trend-down"></i> -${Math.abs(avgDiff).toFixed(1)}h`;
        } else {
            trendAvgHtml = `<i class="fa-solid fa-minus"></i> 0h`;
        }
    } else {
        trendAvgHtml = `<i class="fa-solid fa-minus"></i> --`;
    }
    
    if (avgSessionEl) {
        const trendEl = avgSessionEl.parentElement.querySelector('.metric-trend');
        if (trendEl) {
            trendEl.innerHTML = trendAvgHtml;
            trendEl.className = `metric-trend ${trendAvgHtml.includes('down') ? 'down' : (trendAvgHtml.includes('--') ? '' : 'up')}`;
        }
    }
    
    // 4. Goal Achievement
    const stats = getOverallStatsForPeriod(activePeriod);
    const goalPct = stats.assigned > 0 ? Math.round((stats.used / stats.assigned) * 100) : 0;
    const goalEl = document.getElementById('progress-goal-achievement');
    if (goalEl) {
        goalEl.textContent = `${goalPct}%`;
    }
    
    let prevGoalPct = 0;
    if (prevPeriod) {
        const prevStats = getOverallStatsForPeriod(prevPeriod);
        prevGoalPct = prevStats.assigned > 0 ? Math.round((prevStats.used / prevStats.assigned) * 100) : 0;
    }
    const goalDiff = goalPct - prevGoalPct;
    let trendGoalHtml = '';
    if (prevPeriod) {
        if (goalDiff > 0) {
            trendGoalHtml = `<i class="fa-solid fa-arrow-trend-up"></i> +${goalDiff}%`;
        } else if (goalDiff < 0) {
            trendGoalHtml = `<i class="fa-solid fa-arrow-trend-down"></i> -${Math.abs(goalDiff)}%`;
        } else {
            trendGoalHtml = `<i class="fa-solid fa-minus"></i> 0%`;
        }
    } else {
        trendGoalHtml = `<i class="fa-solid fa-minus"></i> --`;
    }
    
    if (goalEl) {
        const trendEl = goalEl.parentElement.querySelector('.metric-trend');
        if (trendEl) {
            trendEl.innerHTML = trendGoalHtml;
            trendEl.className = `metric-trend ${trendGoalHtml.includes('down') ? 'down' : (trendGoalHtml.includes('--') ? '' : 'up')}`;
        }
    }
    
    // 5. Render Monthly Progress List
    const monthlyList = document.getElementById('monthly-progress-list');
    if (monthlyList) {
        monthlyList.innerHTML = '';
        const last5Periods = sortedPeriods.slice(-5);
        last5Periods.forEach((p, idx) => {
            const pStats = getOverallStatsForPeriod(p);
            const pct = pStats.assigned > 0 ? Math.min(100, (pStats.used / pStats.assigned) * 100) : 0;
            
            // Extract month name or range name
            const startD = new Date(p.start + 'T00:00:00');
            const endD = new Date(p.end + 'T00:00:00');
            let periodLabel = '';
            
            if (startD.getMonth() === endD.getMonth() && startD.getFullYear() === endD.getFullYear()) {
                const monthName = startD.toLocaleDateString('en-US', { month: 'short' });
                if (startD.getDate() === 1 && endD.getDate() === new Date(startD.getFullYear(), startD.getMonth() + 1, 0).getDate()) {
                    periodLabel = `${monthName} ${startD.getFullYear()}`;
                } else {
                    periodLabel = `${monthName} ${startD.getDate()}–${endD.getDate()}`;
                }
            } else {
                const startM = startD.toLocaleDateString('en-US', { month: 'short' });
                const endM = endD.toLocaleDateString('en-US', { month: 'short' });
                periodLabel = `${startM} ${startD.getDate()} – ${endM} ${endD.getDate()}`;
            }
            
            const fillClass = idx % 2 === 0 ? 'blue' : 'teal';
            
            const item = document.createElement('div');
            item.className = 'monthly-progress-item';
            item.innerHTML = `
                <div class="monthly-label-row">
                    <span class="month-name">${periodLabel}</span>
                    <span class="month-hours">${formatDisplayHours(pStats.used)}h / ${pStats.assigned}h target</span>
                </div>
                <div class="monthly-progress-track">
                    <div class="monthly-progress-fill ${fillClass}" style="width: ${pct}%;"></div>
                </div>
            `;
            monthlyList.appendChild(item);
        });
    }
    
    // 6. Render Weekly Bar Chart
    let pivot = new Date();
    const activeStart = new Date(activePeriod.start + 'T00:00:00');
    const activeEnd = new Date(activePeriod.end + 'T23:59:59');
    if (pivot < activeStart || pivot > activeEnd) {
        pivot = activeStart;
    }
    const weekDays = getWeekDays(pivot);
    
    const dailyHours = [];
    let weeklyTotal = 0;
    weekDays.forEach(day => {
        const yyyy = day.getFullYear();
        const mm = (day.getMonth() + 1).toString().padStart(2, '0');
        const dd = day.getDate().toString().padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        
        let dayHours = 0;
        activePeriod.entries.forEach(e => {
            if (e.date === dateStr && e.type !== 'planned') {
                dayHours += e.hours;
            }
        });
        dailyHours.push({
            dateStr,
            dayName: day.toLocaleDateString('en-US', { weekday: 'short' }),
            hours: dayHours
        });
        weeklyTotal += dayHours;
    });
    
    const weeklyTotalBadge = document.getElementById('weekly-total-hours-badge');
    if (weeklyTotalBadge) {
        weeklyTotalBadge.textContent = `${formatDisplayHours(weeklyTotal)}h total`;
    }
    
    const barChart = document.getElementById('weekly-bar-chart');
    if (barChart) {
        barChart.innerHTML = '';
        const maxDailyHours = Math.max(8, ...dailyHours.map(d => d.hours));
        dailyHours.forEach(day => {
            const heightPercent = (day.hours / maxDailyHours) * 100;
            const col = document.createElement('div');
            col.className = 'weekly-bar-column';
            col.innerHTML = `
                <span class="weekly-day-val">${day.hours > 0 ? formatDisplayHours(day.hours) + 'h' : ''}</span>
                <div class="weekly-bar-wrapper" style="height: 120px;">
                    <div class="weekly-bar-fill" style="height: ${heightPercent}%;">
                        <div class="bar-tooltip">${day.dayName}, ${day.dateStr.split('-').slice(1).join('/')}: <strong>${formatDisplayHours(day.hours)}h</strong> logged</div>
                    </div>
                </div>
                <span class="weekly-day-label">${day.dayName}</span>
            `;
            barChart.appendChild(col);
        });
    }
    
    // 7. Render Client Hours Progress
    renderProgressClientList();
    
    // 8. Render Bottom Summary Cards
    const bottomAssignedEl = document.getElementById('progress-bottom-assigned');
    if (bottomAssignedEl) bottomAssignedEl.textContent = `${formatDisplayHours(stats.assigned)}h`;
    
    const bottomUsedEl = document.getElementById('progress-bottom-used');
    if (bottomUsedEl) bottomUsedEl.textContent = `${formatDisplayHours(stats.used)}h`;
    
    const bottomUsedPctEl = document.getElementById('progress-bottom-used-pct');
    if (bottomUsedPctEl) {
        bottomUsedPctEl.textContent = `${goalPct}% of total`;
    }
    
    const bottomRemainingEl = document.getElementById('progress-bottom-remaining');
    if (bottomRemainingEl) bottomRemainingEl.textContent = `${formatDisplayHours(stats.remaining)}h`;
    
    const bottomRemainingDaysEl = document.getElementById('progress-bottom-remaining-days');
    if (bottomRemainingDaysEl) {
        const endDate = new Date(activePeriod.end + 'T23:59:59');
        const now = new Date();
        const msDiff = endDate - now;
        const daysLeft = Math.max(0, Math.ceil(msDiff / (1000 * 60 * 60 * 24)));
        bottomRemainingDaysEl.textContent = daysLeft > 0 ? `${daysLeft} days left` : 'Period ended';
    }
}

function renderProgressClientList() {
    const progressClientList = document.getElementById('progress-client-list');
    if (!progressClientList) return;

    progressClientList.innerHTML = '';
    
    const activePeriod = getActivePeriod();
    const searchInput = document.getElementById('header-search-input');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const visibleClients = activePeriod.clients.filter(c => {
        if (c.hidden) return false;
        if (query) {
            return c.name.toLowerCase().includes(query);
        }
        return true;
    });

    if (visibleClients.length === 0) {
        progressClientList.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 2rem;">
                No matching clients found.
            </div>
        `;
        return;
    }

    visibleClients.forEach(client => {
        const stats = getClientStats(client);
        const colors = getClientColorValues(client.name);
        
        // Calculate progress percentage
        const pct = client.hours > 0 ? Math.min(100, (stats.used / client.hours) * 100) : 0;
        
        // Determine status badge
        const badge = getProgressBadge(stats.used, client.hours);
        
        // Avatar initials
        const initials = client.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        
        // Check recent logs
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const hasRecentLogs = stats.entries.some(e => {
            if (e.type === 'planned') return false;
            const entryDate = new Date(e.date + 'T00:00:00');
            return entryDate >= sevenDaysAgo;
        });
        
        const statusText = hasRecentLogs ? 'Active' : 'Idle';
        const statusClass = hasRecentLogs ? 'increasing' : 'stable';
        const statusIcon = hasRecentLogs ? '<i class="fa-solid fa-arrow-trend-up"></i>' : '<i class="fa-solid fa-minus"></i>';

        const row = document.createElement('div');
        row.className = 'progress-client-row';
        row.addEventListener('click', () => {
            openClientDetailsModal(client.id);
        });

        row.innerHTML = `
            <div class="progress-client-info">
                <div class="client-progress-avatar" style="background-color: ${colors.plannedBg}; color: ${colors.filled}; border-color: ${colors.plannedBorder};">
                    ${initials}
                </div>
                <div class="client-progress-meta">
                    <span class="client-progress-name">${client.name}</span>
                    <span class="badge ${badge.class}">${badge.text}</span>
                </div>
            </div>
            <div class="client-progress-track-wrapper">
                <div class="client-progress-track">
                    <div class="client-progress-fill" style="width: ${pct}%; background-color: ${colors.filled};"></div>
                </div>
                <span class="client-progress-hours">${formatDisplayHours(stats.used)}h / ${client.hours}h</span>
            </div>
            <span class="client-progress-status ${statusClass}">
                ${statusIcon} ${statusText}
            </span>
        `;
        progressClientList.appendChild(row);
    });
}

function getWeekDays(pivotDate) {
    const d = new Date(pivotDate);
    const day = d.getDay(); // 0 (Sun) to 6 (Sat)
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    
    const week = [];
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(monday);
        dayDate.setDate(monday.getDate() + i);
        week.push(dayDate);
    }
    return week;
}

function getProgressBadge(used, assigned) {
    if (used >= assigned) {
        return { text: 'Target Met', class: 'badge-green' };
    } else if (used >= 0.8 * assigned) {
        return { text: 'Near Limit', class: 'badge-orange' };
    } else {
        return { text: 'On Track', class: 'badge-blue' };
    }
}

// ==========================================================================
// CARETRACK CLIENT PROFILE TAB ENGINE
// ==========================================================================
let activeProfileSubTab = 'sessions';

function migrateClientProfileState(client) {
    if (!client.phone) client.phone = '(555) 123-4567';
    if (!client.email) client.email = `${client.name.toLowerCase().replace(/\s+/g, '.')}@email.com`;
    if (!client.address) client.address = '123 Oak Street, Portland, OR 97201';
    if (!client.emergencyContactName) client.emergencyContactName = 'Tom Mitchell';
    if (!client.emergencyContactRelation) client.emergencyContactRelation = 'Spouse';
    if (!client.emergencyContactPhone) client.emergencyContactPhone = '(555) 987-6543';
    if (!client.supportType) client.supportType = 'Daily Living Support';
    if (!client.startDate) client.startDate = '2024-03-15';
    if (!client.status) client.status = 'Active';
    if (!client.goals) client.goals = [
        { id: 'g1', text: 'Improve daily mobility and walking exercises', completed: false },
        { id: 'g2', text: 'Monitor daily medication intake', completed: true },
        { id: 'g3', text: 'Assist with grocery shopping and meal preparation', completed: false }
    ];
    if (!client.notes) client.notes = [
        { id: 'n1', date: '2026-05-20', text: 'Completed grocery shopping. Client walked for 15 minutes in the garden.' },
        { id: 'n2', date: '2026-05-17', text: 'Assisted with light housekeeping and laundry. Medication was organized.' }
    ];
}

function renderProfilePage() {
    const activePeriod = getActivePeriod();
    if (!state.activeProfileClientId && activePeriod.clients.length > 0) {
        state.activeProfileClientId = activePeriod.clients[0].id;
    }

    // Populate the selector dropdown
    const selectDropdown = document.getElementById('profile-client-select-dropdown');
    if (selectDropdown) {
        selectDropdown.innerHTML = '';
        activePeriod.clients.forEach(c => {
            if (c.hidden) return;
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            opt.selected = (c.id === state.activeProfileClientId);
            selectDropdown.appendChild(opt);
        });
    }

    const client = activePeriod.clients.find(c => c.id === state.activeProfileClientId);
    if (!client) {
        const profileView = document.getElementById('view-profile');
        if (profileView) {
            profileView.innerHTML = `
                <div style="text-align: center; padding: 4rem; color: var(--text-muted);">
                    <i class="fa-solid fa-user-slash" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <p style="font-weight: 600;">No active clients available.</p>
                </div>
            `;
        }
        return;
    }

    migrateClientProfileState(client);

    const stats = getClientStats(client);
    const colors = getClientColorValues(client.name);
    const initials = client.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    
    // Bind Hero Card
    const avatarDisplay = document.getElementById('profile-avatar-display');
    if (avatarDisplay) {
        avatarDisplay.textContent = initials;
        avatarDisplay.style.backgroundColor = colors.filled;
        avatarDisplay.style.borderColor = 'var(--card-bg)';
        avatarDisplay.style.color = '#ffffff';
    }

    const nameDisplay = document.getElementById('profile-name-display');
    if (nameDisplay) nameDisplay.textContent = client.name;

    const statusDisplay = document.getElementById('profile-status-display');
    if (statusDisplay) {
        statusDisplay.textContent = client.status;
        statusDisplay.className = `badge ${client.status === 'Active' ? 'badge-green' : 'badge-grey'}`;
    }

    const subtitleDisplay = document.getElementById('profile-subtitle-display');
    if (subtitleDisplay) {
        const dateStr = client.startDate ? new Date(client.startDate + 'T00:00:00').toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }) : 'March 15, 2024';
        subtitleDisplay.innerHTML = `${client.supportType} &middot; Client since ${dateStr}`;
    }

    // Bind Metrics
    const assignedHours = document.getElementById('profile-assigned-hours');
    if (assignedHours) assignedHours.textContent = `${formatDisplayHours(client.hours)}h`;

    const usedHours = document.getElementById('profile-used-hours');
    if (usedHours) usedHours.textContent = `${formatDisplayHours(stats.used)}h`;

    const remainingHours = document.getElementById('profile-remaining-hours');
    if (remainingHours) remainingHours.textContent = `${formatDisplayHours(stats.remaining)}h`;

    const pct = client.hours > 0 ? Math.min(100, Math.round((stats.used / client.hours) * 100)) : 0;
    const progressPercent = document.getElementById('profile-progress-percent');
    if (progressPercent) progressPercent.textContent = `${pct}%`;

    const progressFill = document.getElementById('profile-progress-fill');
    if (progressFill) {
        progressFill.style.width = `${pct}%`;
        progressFill.style.backgroundColor = colors.filled;
    }

    // Bind Contact Card
    const phoneDisplay = document.getElementById('profile-phone-display');
    if (phoneDisplay) phoneDisplay.textContent = client.phone;

    const emailDisplay = document.getElementById('profile-email-display');
    if (emailDisplay) emailDisplay.textContent = client.email;

    const addressDisplay = document.getElementById('profile-address-display');
    if (addressDisplay) addressDisplay.textContent = client.address;

    const emergencyName = document.getElementById('profile-emergency-name');
    if (emergencyName) emergencyName.textContent = client.emergencyContactName;

    const emergencyRelation = document.getElementById('profile-emergency-relation');
    if (emergencyRelation) emergencyRelation.textContent = client.emergencyContactRelation;

    const emergencyPhone = document.getElementById('profile-emergency-phone');
    if (emergencyPhone) emergencyPhone.textContent = client.emergencyContactPhone;

    // Bind Panes
    const sessionsPane = document.getElementById('pane-sessions');
    const goalsPane = document.getElementById('pane-goals');
    const notesPane = document.getElementById('pane-notes');
    
    sessionsPane.classList.add('hidden');
    goalsPane.classList.add('hidden');
    notesPane.classList.add('hidden');

    document.querySelectorAll('.profile-tab-item').forEach(btn => btn.classList.remove('active'));

    if (activeProfileSubTab === 'sessions') {
        sessionsPane.classList.remove('hidden');
        const tabBtn = document.getElementById('tab-btn-sessions');
        if (tabBtn) tabBtn.classList.add('active');
        renderProfileSessions(client, stats);
    } else if (activeProfileSubTab === 'goals') {
        goalsPane.classList.remove('hidden');
        const tabBtn = document.getElementById('tab-btn-goals');
        if (tabBtn) tabBtn.classList.add('active');
        renderProfileGoals(client);
    } else if (activeProfileSubTab === 'notes') {
        notesPane.classList.remove('hidden');
        const tabBtn = document.getElementById('tab-btn-notes');
        if (tabBtn) tabBtn.classList.add('active');
        renderProfileNotes(client);
    }
}

function renderProfileSessions(client, stats) {
    const container = document.getElementById('profile-sessions-list');
    if (!container) return;

    container.innerHTML = '';
    
    const sortedEntries = [...stats.entries].sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        return (b.timeFrom || '').localeCompare(a.timeFrom || '');
    });

    if (sortedEntries.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.875rem;">
                No sessions logged in this period.
            </div>
        `;
        return;
    }

    sortedEntries.forEach(entry => {
        let durationStr = `${formatDisplayHours(entry.hours)}h`;
        const hoursPart = Math.floor(entry.hours);
        const minsPart = Math.round((entry.hours - hoursPart) * 60);
        if (hoursPart > 0 && minsPart > 0) {
            durationStr = `${hoursPart}h ${minsPart}min`;
        } else if (hoursPart === 0 && minsPart > 0) {
            durationStr = `${minsPart}min`;
        }

        const dateObj = new Date(entry.date + 'T00:00:00');
        const dateFormatted = dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const row = document.createElement('div');
        row.className = 'profile-session-row';
        row.addEventListener('click', () => {
            const modalEditEntry = document.getElementById('modal-edit-entry');
            if (modalEditEntry) {
                document.getElementById('edit-entry-header-title').textContent = 'Edit Time Entry';
                document.getElementById('edit-entry-client-subtitle').textContent = client.name;
                
                const editIdInput = document.getElementById('edit-entry-id');
                if (editIdInput) editIdInput.value = entry.id;

                const editDateInput = document.getElementById('edit-entry-date');
                if (editDateInput) editDateInput.value = entry.date;
                
                const editFromInput = document.getElementById('edit-entry-time-from');
                if (editFromInput) editFromInput.value = entry.timeFrom || '';

                const editToInput = document.getElementById('edit-entry-time-to');
                if (editToInput) editToInput.value = entry.timeTo || '';

                const editKmsInput = document.getElementById('edit-entry-kms');
                if (editKmsInput) editKmsInput.value = entry.kms || '';

                const editNotesInput = document.getElementById('edit-entry-notes');
                if (editNotesInput) editNotesInput.value = entry.notes || '';

                const editTypeRadios = document.getElementsByName('edit-entry-type');
                editTypeRadios.forEach(radio => {
                    radio.checked = (radio.value === entry.type);
                });

                const formEditEntry = document.getElementById('form-edit-entry');
                if (formEditEntry) {
                    formEditEntry.dataset.entryId = entry.id;
                    formEditEntry.dataset.clientId = client.id;
                }

                modalEditEntry.classList.add('active');
            }
        });

        const badgeClass = entry.type === 'planned' ? 'badge-grey' : 'badge-blue';
        const badgeText = entry.type === 'planned' ? 'Future Plan' : 'Home Visit';

        row.innerHTML = `
            <div class="session-row-left">
                <div class="session-icon">
                    <i class="fa-solid fa-clock"></i>
                </div>
                <div class="session-meta">
                    <div class="session-date-row">
                        <span class="session-date-text">${dateFormatted}</span>
                        <span class="badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <span class="session-desc">${entry.notes || 'No session details provided.'}</span>
                </div>
            </div>
            <div class="session-row-right">
                <span class="session-duration">${durationStr}</span>
                <i class="fa-solid fa-chevron-right session-chevron"></i>
            </div>
        `;
        container.appendChild(row);
    });
}

function renderProfileGoals(client) {
    const container = document.getElementById('profile-goals-list');
    if (!container) return;

    container.innerHTML = '';

    if (!client.goals || client.goals.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.875rem;">
                No goals added yet. Click "+ Add Goal" above.
            </div>
        `;
        return;
    }

    client.goals.forEach(goal => {
        const row = document.createElement('div');
        row.className = `goal-item-row ${goal.completed ? 'completed' : ''}`;
        
        row.innerHTML = `
            <div class="goal-item-left">
                <input type="checkbox" class="goal-checkbox" ${goal.completed ? 'checked' : ''} title="Mark goal status">
                <span class="goal-text">${goal.text}</span>
            </div>
            <button class="btn-delete-item" title="Delete Goal"><i class="fa-solid fa-trash-can"></i></button>
        `;

        const chk = row.querySelector('.goal-checkbox');
        chk.addEventListener('change', () => {
            goal.completed = chk.checked;
            saveState();
            renderProfilePage();
            showToastNotification(`Goal status updated!`, 'success');
        });

        const btnDelete = row.querySelector('.btn-delete-item');
        btnDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            client.goals = client.goals.filter(g => g.id !== goal.id);
            saveState();
            renderProfilePage();
            showToastNotification(`Goal removed.`, 'success');
        });

        container.appendChild(row);
    });
}

function renderProfileNotes(client) {
    const container = document.getElementById('profile-notes-list');
    if (!container) return;

    container.innerHTML = '';

    if (!client.notes || client.notes.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.875rem;">
                No notes logged yet. Click "+ Add Note" above.
            </div>
        `;
        return;
    }

    const sortedNotes = [...client.notes].sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedNotes.forEach(note => {
        const row = document.createElement('div');
        row.className = 'note-item-row';
        
        const dateObj = new Date(note.date + 'T00:00:00');
        const dateFormatted = dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        row.innerHTML = `
            <div class="note-item-header">
                <span class="note-date">${dateFormatted}</span>
                <button class="btn-delete-item" title="Delete Note"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <div class="note-content">${note.text}</div>
        `;

        const btnDelete = row.querySelector('.btn-delete-item');
        btnDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            client.notes = client.notes.filter(n => n.id !== note.id);
            saveState();
            renderProfilePage();
            showToastNotification(`Note removed.`, 'success');
        });

        container.appendChild(row);
    });
}

// Initialize Application on Content Loaded
document.addEventListener('DOMContentLoaded', initApp);
