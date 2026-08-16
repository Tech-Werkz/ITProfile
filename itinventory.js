"use strict";

module.exports.itinventory = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;

    // Functions exposed to the frontend browser
    obj.exports = ['onDeviceRefreshEnd', 'loadInventoryData', 'loadInventoryError', 'buildPrintable'];

    obj.server_startup = function () {
        console.log('IT Inventory plugin loaded on server.');
    };

    // ==========================================
    // Part 1: Client-Side Code (Injected into browser)
    // ==========================================

    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || currentNode == null) return;
        if (!currentNode.osdesc || currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;

        pluginHandler.registerPluginTab({ tabTitle: 'IT Inventory', tabId: 'pluginItInventory' });

        var today = new Date().toISOString().slice(0, 10);

        // Header fields are the parts of the paper form that identify the record
        // (nobody can auto-detect who is filling it out or the asset's control number).
        var html = ''
            + '<div style="padding:12px;" id="itinvRoot">'
            + '  <div style="font-size:18px;font-weight:bold;margin-bottom:10px;">IT Inventory Profile</div>'
            + '  <div id="itinvStatus" style="margin-bottom:10px; opacity:0.7;">Ready.</div>'
            + '  <div style="margin-bottom:15px;">'
            + '    <button type="button" id="itinvRefreshBtn" class="btn btn-primary">Scan Device</button> '
            + '    <button type="button" id="itinvPrintBtn" class="btn btn-default" disabled>Print</button>'
            + '  </div>'
            + '  <div style="margin-bottom:12px; font-size:14px; background: rgba(128,128,128,0.1); padding:12px; border-radius:5px; border:1px solid rgba(128,128,128,0.2);">'
            + '    <div style="font-weight:bold; margin-bottom:8px;">Record Details (manual)</div>'
            + '    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">'
            + '      <div>Date of Profiling: <input type="date" id="itinvDate" value="' + today + '" style="width:100%;"></div>'
            + '      <div>Control No.: <input type="text" id="itinvControlNo" style="width:100%;"></div>'
            + '      <div>Name of User: <input type="text" id="itinvUserName" style="width:100%;"></div>'
            + '      <div>Dept./Branch: <input type="text" id="itinvDept" style="width:100%;"></div>'
            + '    </div>'
            + '  </div>'
            + '  <div id="itinvSummary" style="margin-bottom:12px; font-size:13px; line-height:1.5; max-height:480px; overflow-y:auto; overflow-x:hidden;"></div>'
            + '</div>';

        QA('pluginItInventory', html);

        if (!pluginHandler.itinventory) pluginHandler.itinventory = {};
        pluginHandler.itinventory._lastScan = null;

        var btn = document.getElementById('itinvRefreshBtn');
        if (btn) {
            btn.type = 'button';
            btn.onclick = null;
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) {
                    if (pluginHandler.itinventory && pluginHandler.itinventory.loadInventoryError) {
                        pluginHandler.itinventory.loadInventoryError(null, { message: 'No device selected.' });
                    }
                    return;
                }

                QH('itinvSummary', '');
                QH('itinvStatus', 'Scanning endpoint for inventory data... (first run may take longer while WMI/CIM queries complete.)');
                var pBtn = document.getElementById('itinvPrintBtn');
                if (pBtn) pBtn.disabled = true;

                try {
                    if (typeof meshserver !== 'undefined' && meshserver != null) {
                        meshserver.send({ action: 'plugin', plugin: 'itinventory', pluginaction: 'getInventory', nodeid: currentNode._id });
                    } else if (typeof server !== 'undefined' && server != null) {
                        server.send({ action: 'plugin', plugin: 'itinventory', pluginaction: 'getInventory', nodeid: currentNode._id });
                    } else {
                        throw new Error("WebSocket object not found.");
                    }
                } catch (err) {
                    if (pluginHandler.itinventory && pluginHandler.itinventory.loadInventoryError) {
                        pluginHandler.itinventory.loadInventoryError(null, { message: 'WebSocket Error: ' + err.message });
                    }
                }
            }, false);
        }
    };

    obj.loadInventoryData = function (serverObj, msg) {
        function esc(s) {
            if (s == null) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        function joinList(arr, fallback) {
            if (!arr || arr.length === 0) return fallback;
            return arr.join(', ');
        }

        var statusEl = document.getElementById('itinvStatus');
        var summaryEl = document.getElementById('itinvSummary');

        if (statusEl) statusEl.innerText = 'Scan complete.';

        if (!msg || !msg.data) {
            if (summaryEl) summaryEl.innerHTML = '<span style="color:#d9534f; font-weight:bold;">No data returned from Agent.</span>';
            return;
        }

        var d = msg.data;

        // ---- Build Computer Hardware Information rows ----
        var memSpecParts = [], memSerials = [];
        if (d.memoryModules) {
            for (var i = 0; i < d.memoryModules.length; i++) {
                var m = d.memoryModules[i];
                memSpecParts.push(m.capacityGB + 'GB @ ' + m.speedMHz + 'MHz ' + (m.manufacturer || ''));
                if (m.serialNumber) memSerials.push(m.serialNumber);
            }
        }

        var stoSpecParts = [], stoSerials = [];
        if (d.storage) {
            for (var j = 0; j < d.storage.length; j++) {
                var s = d.storage[j];
                stoSpecParts.push((s.model || 'Unknown') + ' ' + s.sizeGB + 'GB (' + (s.mediaType || '?') + ', ' + (s.healthStatus || '?') + ')');
                if (s.serialNumber) stoSerials.push(s.serialNumber);
            }
        }

        var vidParts = [];
        if (d.video) {
            for (var k = 0; k < d.video.length; k++) {
                var v = d.video[k];
                vidParts.push(v.name + (v.vramGB ? (' (' + v.vramGB + 'GB)') : ''));
            }
        }

        var monParts = [], monSerials = [];
        if (d.monitors) {
            for (var mIdx = 0; mIdx < d.monitors.length; mIdx++) {
                var mon = d.monitors[mIdx];
                if (mon.manufacturer || mon.model) monParts.push((mon.manufacturer || '') + ' ' + (mon.model || ''));
                if (mon.serialNumber) monSerials.push(mon.serialNumber);
            }
        }

        var extParts = [], extSerials = [];
        if (d.externalDrives) {
            for (var eIdx = 0; eIdx < d.externalDrives.length; eIdx++) {
                var ext = d.externalDrives[eIdx];
                extParts.push((ext.model || 'Unknown') + ' ' + ext.sizeGB + 'GB');
                if (ext.serialNumber) extSerials.push(ext.serialNumber);
            }
        }

        // Component rows: [Component, Auto-detected Spec, Auto-detected Serial, manualOnly]
        var rows = [
            [d.builtType || 'System Unit', (d.manufacturer || '') + ' ' + (d.model || '') + (d.biosVersion ? (' | BIOS ' + d.biosVersion) : ''), d.serialNumber || '', false],
            ['Processor', d.cpu ? (d.cpu.name + ' (' + d.cpu.cores + 'C/' + d.cpu.logicalProcessors + 'T)') : '', '', false],
            ['Motherboard', d.motherboard ? ((d.motherboard.manufacturer || '') + ' ' + (d.motherboard.product || '')) : '', d.motherboard ? (d.motherboard.serialNumber || '') : '', false],
            ['Memory (RAM)', (d.memoryTotalGB || '?') + 'GB Total [' + memSpecParts.join(' + ') + ']', memSerials.join(', '), false],
            ['Storage Device', stoSpecParts.join(' | '), stoSerials.join(', '), false],
            ['Video Card', vidParts.join(', '), '', false],
            ['CD / DVD-ROM', joinList(d.optical, 'Not detected'), '', false],
            ['Keyboard', d.keyboard || 'Not detected', '', false],
            ['Mouse', d.pointingDevice || 'Not detected', '', false],
            ['Monitor', monParts.length ? monParts.join(', ') : 'Not detected (needs active display/driver)', monSerials.join(', '), false],
            ['UPS', '', '', true],
            ['AVR / AVS', '', '', true],
            ['Printer/s', joinList(d.printers, 'None detected'), '', false],
            ['Document Scanner', '', '', true],
            ['Barcode Scanner', '', '', true],
            ['Cash Drawer', '', '', true],
            ['External / Flash Drive', extParts.length ? extParts.join(', ') : 'None connected at scan time', extSerials.join(', '), false],
            ['Webcam', joinList(d.webcam, 'Not detected'), '', false],
            ['Speaker / Headset', joinList(d.audioDevices, 'Not detected'), '', false]
        ];

        var hwRowsHtml = '';
        for (var r = 0; r < rows.length; r++) {
            var comp = rows[r][0], spec = rows[r][1], serial = rows[r][2], manualOnly = rows[r][3];
            hwRowsHtml += '<tr>'
                + '<td style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3);">' + esc(comp) + '</td>'
                + '<td style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3);">' + (manualOnly ? '<input type="text" placeholder="Manual entry" style="width:100%;">' : esc(spec)) + '</td>'
                + '<td style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3);"><input type="text" value="' + esc(serial) + '" placeholder="Property No." style="width:100%;"></td>'
                + '<td style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3);"><input type="date" style="width:100%;"></td>'
                + '<td style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3);"><input type="text" placeholder="Cost" style="width:100%;"></td>'
                + '</tr>';
        }

        var hwTableHtml = '<table style="width:100%; border-collapse:collapse; font-size:12px;">'
            + '<thead><tr>'
            + '<th style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3); text-align:left;">Component</th>'
            + '<th style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3); text-align:left;">Specifications</th>'
            + '<th style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3); text-align:left;">Property No./Serial</th>'
            + '<th style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3); text-align:left;">Acquisition Date</th>'
            + '<th style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3); text-align:left;">Acquisition Cost</th>'
            + '</tr></thead><tbody>' + hwRowsHtml + '</tbody></table>';

        // ---- System Information ----
        var localUsersStr = '';
        if (d.localUsers) {
            var uParts = [];
            for (var uIdx = 0; uIdx < d.localUsers.length; uIdx++) {
                uParts.push(d.localUsers[uIdx].name + (d.localUsers[uIdx].isAdmin ? ' (Admin)' : ''));
            }
            localUsersStr = uParts.join(', ');
        }

        var sysInfoPairs = [
            ['Built Category', esc(d.builtCategory)],
            ['Processor Type', esc(d.processorType)],
            ['Operative System', esc(d.operatingSystem) + ' (' + esc(d.osVersion) + ')'],
            ['Product Key', esc(d.productKey)],
            ['Connection', esc(d.connectionType)],
            ['System Type', esc(d.systemType)],
            ['IPv4 Address', esc(d.ipv4Address)],
            ['Computer Name', esc(d.computerName)],
            ['Subnet Mask', esc(d.subnetMask)],
            ['Login Name', esc(d.loginName)],
            ['Default Gateway', esc(d.defaultGateway)],
            ['User Accounts', esc(localUsersStr)],
            ['Preferred DNS', esc(d.preferredDNS)],
            ['Windows Image Date', esc(d.windowsImageDate)],
            ['USB Storage', esc(d.usbStorage)],
            ['Windows Restore Point Date', esc(d.restorePointDate) || 'None found']
        ];

        var sysInfoHtml = '<div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px 16px;">';
        for (var sp = 0; sp < sysInfoPairs.length; sp++) {
            sysInfoHtml += '<div><b>' + sysInfoPairs[sp][0] + ':</b> ' + (sysInfoPairs[sp][1] || '<i style="opacity:0.6;">Not available</i>') + '</div>';
        }
        sysInfoHtml += '</div>';

        // ---- Software checklist ----
        var checklistHtml = '<div style="display:grid; grid-template-columns: 1fr 1fr; gap:2px 12px;">';
        if (d.installedSoftwareChecklist) {
            var keys = Object.keys(d.installedSoftwareChecklist);
            for (var ck = 0; ck < keys.length; ck++) {
                var found = d.installedSoftwareChecklist[keys[ck]];
                checklistHtml += '<div>'
                    + '<input type="checkbox" ' + (found ? 'checked' : '') + ' disabled> '
                    + esc(keys[ck]) + (found ? (' <span style="opacity:0.6;">(' + esc(found) + ')</span>') : '')
                    + '</div>';
            }
        }
        checklistHtml += '</div>';

        var allSoftwareHtml = '<details style="margin-top:8px;"><summary style="cursor:pointer;">All detected installed programs (' + (d.installedSoftwareAll ? d.installedSoftwareAll.length : 0) + ')</summary>'
            + '<div style="max-height:180px; overflow-y:auto; font-size:12px; margin-top:6px;">';
        if (d.installedSoftwareAll) {
            for (var asIdx = 0; asIdx < d.installedSoftwareAll.length; asIdx++) {
                var sw = d.installedSoftwareAll[asIdx];
                allSoftwareHtml += '<div>' + esc(sw.name) + (sw.version ? (' <span style="opacity:0.6;">v' + esc(sw.version) + '</span>') : '') + '</div>';
            }
        }
        allSoftwareHtml += '</div></details>';

        // ---- Sign-off (always manual) ----
        var signoffHtml = '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px; margin-top:8px;">'
            + '<div>Profiled by: <input type="text" style="width:100%;" placeholder="Technician in-charge"></div>'
            + '<div>Accepted by: <input type="text" style="width:100%;" placeholder="User / Accountable Person"></div>'
            + '<div>Evaluated by: <input type="text" style="width:100%;" placeholder="InfoSec Team"></div>'
            + '</div>';

        var sectionStyle = 'margin-bottom:12px; background: rgba(128,128,128,0.1); padding:12px; border-radius:5px; border:1px solid rgba(128,128,128,0.2);';

        var summaryHtml = ''
            + '<div id="itinvHardwareSection" style="' + sectionStyle + '"><div style="font-weight:bold; margin-bottom:8px;">Computer Hardware Information</div>' + hwTableHtml + '</div>'
            + '<div id="itinvSystemSection" style="' + sectionStyle + '"><div style="font-weight:bold; margin-bottom:8px;">System Information</div>' + sysInfoHtml + '</div>'
            + '<div id="itinvSoftwareSection" style="' + sectionStyle + '"><div style="font-weight:bold; margin-bottom:8px;">Software Applications Installed</div>' + checklistHtml + allSoftwareHtml + '</div>'
            + '<div id="itinvSignoffSection" style="' + sectionStyle + '"><div style="font-weight:bold; margin-bottom:8px;">Sign-off</div>' + signoffHtml + '</div>'
            + '<div style="margin-top:10px; opacity:0.6; font-size:12px; text-align:right;"><i>Scanned at: ' + esc(d.collectedAt) + '</i></div>';

        if (summaryEl) summaryEl.innerHTML = summaryHtml;

        var pBtn = document.getElementById('itinvPrintBtn');
        if (pBtn) {
            pBtn.disabled = false;
            pBtn.onclick = null;
            pBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof obj !== 'undefined' && typeof obj.buildPrintable === 'function') {
                    obj.buildPrintable(d);
                } else if (typeof window !== 'undefined' && typeof window.itinventoryBuildPrintable === 'function') {
                    window.itinventoryBuildPrintable(d);
                }
            }, false);
        }

        // Stash the last scan on the plugin object so the print/copy handlers can reach it
        // even though they were bound with a stale closure across re-scans.
        pluginHandler.itinventory._lastScan = d;
    };

    // Opens a separate print-friendly window laid out like the paper form, combining
    // auto-detected data with whatever the technician typed into the manual fields.
    obj.buildPrintable = function (dOverride) {
        var d = dOverride || (pluginHandler.itinventory && pluginHandler.itinventory._lastScan);
        if (!d) return;

        function esc(s) {
            if (s == null) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function val(id) {
            var el = document.getElementById(id);
            return el ? esc(el.value) : '';
        }

        var hardwareSection = document.getElementById('itinvHardwareSection');
        var systemSection = document.getElementById('itinvSystemSection');
        var softwareSection = document.getElementById('itinvSoftwareSection');
        var signoffSection = document.getElementById('itinvSignoffSection');

        var rowsForPrint = document.querySelectorAll('#itinvHardwareSection table tbody tr');
        var hwRowsPrintHtml = '';
        for (var i = 0; i < rowsForPrint.length; i++) {
            var cells = rowsForPrint[i].querySelectorAll('td');
            var cellVals = [];
            for (var c = 0; c < cells.length; c++) {
                var inp = cells[c].querySelector('input');
                cellVals.push(esc(inp ? inp.value : cells[c].innerText));
            }
            hwRowsPrintHtml += '<tr><td>' + cellVals.join('</td><td>') + '</td></tr>';
        }

        var printHtml = '<!DOCTYPE html><html><head><title>IT Inventory Profile - ' + esc(d.computerName) + '</title>'
            + '<style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;} table{width:100%;border-collapse:collapse;margin-bottom:16px;} '
            + 'td,th{border:1px solid #333;padding:4px 6px;text-align:left;} h1{font-size:18px;} h2{font-size:14px;margin-top:20px;}</style></head><body>'
            + '<h1>IT Inventory Profile (SIDC-SS-F-ICT-013)</h1>'
            + '<table><tr><td><b>Date of Profiling:</b> ' + val('itinvDate') + '</td><td><b>Control No.:</b> ' + val('itinvControlNo') + '</td></tr>'
            + '<tr><td><b>Name of User:</b> ' + val('itinvUserName') + '</td><td><b>Dept./Branch:</b> ' + val('itinvDept') + '</td></tr></table>'
            + '<h2>Computer Hardware Information</h2>'
            + '<table><thead><tr><th>Component</th><th>Specifications</th><th>Property No./Serial</th><th>Acquisition Date</th><th>Acquisition Cost</th></tr></thead>'
            + '<tbody>' + hwRowsPrintHtml + '</tbody></table>'
            + '<h2>System Information</h2>' + (systemSection ? systemSection.innerHTML : '')
            + '<h2>Software Applications Installed</h2>' + (softwareSection ? softwareSection.innerHTML : '')
            + '<h2>Sign-off</h2>' + (signoffSection ? signoffSection.innerHTML : '')
            + '</body></html>';

        var statusEl = document.getElementById('itinvStatus');
        if (statusEl) statusEl.innerText = 'Opening print dialog...';

        try {
            // Open a normal popup. Do not use "noopener" because some
            // browsers return null when it is specified.
            var w = window.open('', '_blank', 'width=1000,height=800,scrollbars=yes');

            if (!w) {
                if (statusEl) {
                    statusEl.innerText =
                        'Print window was blocked. Please allow pop-ups for this site and click Print again.';
                }
                return;
            }

            w.document.open();
            w.document.write(printHtml);
            w.document.close();

            var doPrint = function () {
                try {
                    w.focus();
                    w.print();
                } catch (e) {
                    if (statusEl) {
                        statusEl.innerText =
                            'Print dialog could not be opened: ' + e.message;
                    }
                }
            };

            // Print after the new document has loaded.
            if (w.document.readyState === 'complete') {
                setTimeout(doPrint, 100);
            } else {
                w.onload = doPrint;

                // Fallback for browsers where onload is unreliable.
                setTimeout(doPrint, 1000);
            }

            return;

        } catch (e) {
            if (statusEl) {
                statusEl.innerText =
                    'Print form failed to open: ' + e.message;
            }
        }
    };

    obj.loadInventoryError = function (serverObj, msg) {
        var statusEl = document.getElementById('itinvStatus');
        var summaryEl = document.getElementById('itinvSummary');

        if (statusEl) statusEl.innerText = 'Failed to load inventory data.';

        if (summaryEl) {
            var errorText = (msg && msg.message) ? msg.message : 'Unknown error occurred.';
            summaryEl.innerHTML = '<span style="color:#d9534f;"><b>Error:</b> ' + String(errorText).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
        }
    };

    // ==========================================
    // Part 2: Server-Side Code (Message Routing)
    // ==========================================

    obj.serveraction = function (command, myparent, grandparent) {
        if (command.plugin !== 'itinventory') return;

        var sessionid = null;
        try {
            sessionid = myparent.ws.sessionId;
        } catch (e) {}

        var currentSessionid = command.sessionid || sessionid;

        switch (command.pluginaction) {

            // Route request from Admin UI to Remote Agent
            case 'getInventory':
                var agent = obj.meshServer.webserver.wsagents[command.nodeid];
                if (agent != null) {
                    agent.send(JSON.stringify({
                        action: 'plugin',
                        plugin: 'itinventory',
                        pluginaction: 'getInventory',
                        sessionid: currentSessionid,
                        nodeid: command.nodeid
                    }));
                } else {
                    if (currentSessionid && obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[currentSessionid]) {
                        obj.meshServer.webserver.wssessions2[currentSessionid].send(JSON.stringify({
                            action: 'plugin',
                            plugin: 'itinventory',
                            method: 'loadInventoryError',
                            message: 'Agent is offline or disconnected.',
                            nodeid: command.nodeid
                        }));
                    }
                }
                break;

            // Route response from Remote Agent back to Admin UI
            case 'inventoryData':
            case 'inventoryError':
                var targetSessionid = command.sessionid;
                var response = {
                    action: 'plugin',
                    plugin: 'itinventory',
                    method: command.pluginaction === 'inventoryData' ? 'loadInventoryData' : 'loadInventoryError',
                    data: command.data,
                    message: command.message,
                    nodeid: command.nodeid
                };

                if (targetSessionid && obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[targetSessionid]) {
                    try {
                        obj.meshServer.webserver.wssessions2[targetSessionid].send(JSON.stringify(response));
                    } catch (e) {
                        console.log('IT Inventory routing error:', e);
                    }
                }
                break;
        }
    };

    return obj;
};
