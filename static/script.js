function formatDuration(seconds, short = false) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
    const hours = Math.floor(minutes / 60);
    if (short) return `${hours}h ${minutes % 60}m`;
    return `${hours}h ${minutes % 60}m`;
}

function formatDate(isoString) {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function timeAgo(isoString) {
    if (!isoString) return 'No incidents recorded';
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} mins ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

function getStatusMood(durationSeconds) {
    // Minimalist style: Colored text with dot, no background badges
    let colorClass = "text-green-500";
    let icon = "●";
    let text = "Pleasant";

    if (durationSeconds < 3600) {
        colorClass = "text-[#4ade80]"; // Green
        text = "Pleasant";
    } else if (durationSeconds < 7200) {
        colorClass = "text-blue-400";
        text = "Good";
    } else if (durationSeconds < 18000) {
        colorClass = "text-yellow-400";
        text = "Normal";
    } else if (durationSeconds < 28800) {
        colorClass = "text-orange-400";
        text = "Not Great";
    } else if (durationSeconds < 43200) {
        colorClass = "text-red-400";
        text = "Horror";
    } else {
        colorClass = "text-red-600 font-bold";
        icon = "☠️";
        text = "SKULL";
    }

    return `<span class="inline-flex items-center gap-1.5 ${colorClass} text-xs tracking-wide">
        <span class="opacity-80">${icon}</span> ${text}
    </span>`;
}

async function fetchData(limit = 10) {
    try {
        // Fetch Stats
        const statsRes = await fetch('/api/stats');
        const stats = await statsRes.json();

        // Update Stats Cards
        updateStatCard('today', stats.today);
        updateStatCard('week', stats.week);
        updateStatCard('month', stats.month);
        updateStatCard('total', stats.total);

        // Update Main Card
        document.getElementById('total-incidents').textContent = stats.total.count;
        if (stats.last_outage) {
            document.getElementById('last-outage-ts').textContent = formatDate(stats.last_outage) + " (" + timeAgo(stats.last_outage) + ")";
        }

        // Calculate simplified "Uptime" for today (just 24h - downtime today)
        const secondsInDay = 86400;
        const uptimeSeconds = Math.max(0, secondsInDay - stats.today.duration);
        const uptimePct = ((uptimeSeconds / secondsInDay) * 100).toFixed(1);
        document.getElementById('total-uptime-pct').textContent = `${uptimePct}%`;


        // Fetch Log
        const logRes = await fetch(`/api/outages?limit=${limit}`);
        const outages = await logRes.json();

        // Calculate "Power On" duration before each outage (inter-outage uptime)
        // outages are typically sorted DESC (newest first). 
        // So uptime before outages[i] is (outages[i].start - outages[i+1].end)
        for (let i = 0; i < outages.length - 1; i++) {
            const currentStart = new Date(outages[i].start_time);
            const prevEnd = new Date(outages[i + 1].end_time);
            const diffSeconds = (currentStart - prevEnd) / 1000;
            if (diffSeconds >= 0) {
                outages[i].uptimeBefore = diffSeconds;
            }
        }

        const tbody = document.getElementById('outage-list');
        tbody.innerHTML = '';

        if (outages.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-muted">No outages recorded yet.</td></tr>';
            return;
        }

        // Group outages by day
        const grouped = {};
        outages.forEach(outage => {
            const dateObj = new Date(outage.start_time);
            const dateKey = dateObj.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            if (!grouped[dateKey]) {
                grouped[dateKey] = {
                    date: dateObj, // Keep for sorting if needed
                    items: [],
                    totalDuration: 0
                };
            }
            grouped[dateKey].items.push(outage);
            grouped[dateKey].totalDuration += outage.duration;
        });

        // Render grouped data
        Object.keys(grouped).forEach(dateKey => {
            const group = grouped[dateKey];

            // Create Day Header Row (Visual Frame Header)
            const headerTr = document.createElement('tr');
            headerTr.className = 'bg-[#1a1a1a] border-b border-[#222]';
            headerTr.innerHTML = `
                <td colspan="4" class="py-3 px-4">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            <span class="font-bold text-[#eee] text-sm tracking-wide">${dateKey}</span>
                        </div>
                        <div class="flex gap-4 text-xs items-center">
                            <div class="flex items-center gap-2 text-muted">
                                <span>Count: <span class="text-[#ddd] font-medium">${group.items.length}</span></span>
                                <span class="w-1 h-1 rounded-full bg-[#333]"></span>
                                <span>Total: <span class="text-orange-400 font-mono font-medium">${formatDuration(group.totalDuration)}</span></span>
                            </div>
                            <div class="w-px h-3 bg-[#333]"></div>
                            ${getStatusMood(group.totalDuration)}
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(headerTr);

            // Render individual outage rows
            group.items.forEach(outage => {
                const tr = document.createElement('tr');
                tr.className = 'group hover:bg-[#1a1a1a] transition-colors border-b border-[#222] last:border-0';

                const startTime = new Date(outage.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const endTime = new Date(outage.end_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                // Determine what to show in the last column
                let metaHtml = '';
                if (outage.uptimeBefore) {
                    // Cleaner "Power On" display
                    metaHtml = `
                        <div class="flex items-center justify-end gap-2 text-xs">
                            <span class="text-[#444] font-medium uppercase tracking-wider text-[10px]">Power On</span>
                            <span class="font-mono text-[#4ade80] opacity-80">${formatDuration(outage.uptimeBefore, true)}</span>
                        </div>
                    `;
                } else {
                    // Fallback to Time of Day visualization
                    const h = new Date(outage.start_time).getHours();
                    let t = { i: '🌑', l: 'Night', c: 'text-blue-400/60' };
                    if (h >= 5 && h < 12) t = { i: '🌅', l: 'Morning', c: 'text-yellow-400/60' };
                    else if (h >= 12 && h < 17) t = { i: '☀️', l: 'Afternoon', c: 'text-orange-400/60' };
                    else if (h >= 17 && h < 22) t = { i: '🌆', l: 'Evening', c: 'text-purple-400/60' };

                    metaHtml = `
                        <div class="flex items-center justify-end gap-2 opacity-50 hover:opacity-100 transition-opacity" title="Started in the ${t.l}">
                            <span class="text-xs text-muted">${t.l}</span>
                            <span class="text-sm ${t.c}">${t.i}</span>
                        </div>
                    `;
                }

                tr.innerHTML = `
                    <td class="py-3 px-4 pl-10 flex items-center gap-3 text-muted text-sm">
                        <div class="w-1.5 h-1.5 rounded-full bg-red-500/50 group-hover:bg-red-500 transition-colors"></div>
                        <span class="text-[#888] group-hover:text-[#ccc] transition-colors">${startTime}</span>
                    </td>
                    <td class="py-3 px-4 font-mono text-orange-400/80 group-hover:text-orange-400 text-sm transition-colors">${formatDuration(outage.duration)}</td>
                    <td class="py-3 px-4 text-muted text-sm group-hover:text-[#888] transition-colors">${endTime}</td>
                     <td class="py-3 px-4 text-right">
                        ${metaHtml}
                     </td>
                `;
                tbody.appendChild(tr);
            });
        });

    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

// Button handler
document.getElementById('load-more-btn').addEventListener('click', function () {
    this.textContent = 'Loading...';
    this.disabled = true;
    fetchData(1000).then(() => {
        this.style.display = 'none'; // Hide button after loading
    });
});

function updateStatCard(period, data) {
    document.getElementById(`stat-${period}-count`).textContent = data.count;
    const durationEl = document.getElementById(`stat-${period}-duration`);
    durationEl.textContent = formatDuration(data.duration, true);

    // Style adjustments if bad
    if (data.count > 0) {
        durationEl.classList.add('text-red-400');
        durationEl.classList.remove('text-muted');
    } else {
        durationEl.classList.add('text-muted');
        durationEl.classList.remove('text-red-400');
    }
}

// Initial Load
fetchData();

// Auto refresh every minute
setInterval(fetchData, 60000);
