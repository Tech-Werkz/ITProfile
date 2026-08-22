"use strict";

module.exports.itprofile = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;

    // Functions exposed to the frontend browser
    obj.exports = ['onDeviceRefreshEnd', 'loadInventoryData', 'loadInventoryError', 'buildPrintable'];

    obj.server_startup = function () {
        console.log('IT Profile plugin loaded on server.');
    };

    // ==========================================
    // Part 1: Client-Side Code (Injected into browser)
    // ==========================================

    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || currentNode == null) return;
        if (!currentNode.osdesc || currentNode.osdesc.toLowerCase().indexOf('windows') === -1) return;

        pluginHandler.registerPluginTab({ tabTitle: 'IT Profile', tabId: 'pluginItProfile' });

        var today = new Date().toISOString().slice(0, 10);

        var html = ''
            + '<div style="padding:12px;" id="itprofRoot">'
            + '  <div style="font-size:18px;font-weight:bold;margin-bottom:10px;">IT Inventory Profile</div>'
            + '  <div id="itprofStatus" style="margin-bottom:10px; opacity:0.7;">Ready.</div>'
            + '  <div style="margin-bottom:15px;">'
            + '    <button id="itprofRefreshBtn" class="btn btn-primary">Scan Device</button> '
            + '    <button id="itprofPrintBtn" class="btn btn-default" disabled>Print / Export Form</button>'
            + '  </div>'
            + '  <div style="margin-bottom:12px; font-size:14px; background: rgba(128,128,128,0.1); padding:12px; border-radius:5px; border:1px solid rgba(128,128,128,0.2);">'
            + '    <div style="font-weight:bold; margin-bottom:8px;">Record Details (manual)</div>'
            + '    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">'
            + '      <div>Date of Profiling: <input type="date" id="itprofDate" value="' + today + '" style="width:100%;"></div>'
            + '      <div>Control No.: <input type="text" id="itprofControlNo" style="width:100%;"></div>'
            + '      <div>Name of User: <input type="text" id="itprofUserName" style="width:100%;"></div>'
            + '      <div>Dept./Branch: <input type="text" id="itprofDept" style="width:100%;"></div>'
            + '    </div>'
            + '  </div>'
            + '  <div id="itprofSummary" style="margin-bottom:12px; font-size:13px; line-height:1.5; max-height:250px; overflow-y:auto; overflow-x:hidden;"></div>'
            + '</div>';

        QA('pluginItProfile', html);

        var btn = document.getElementById('itprofRefreshBtn');
// ==========================================
// Production-safe Scan Device button handler
// Uses event delegation because MeshCentral may
// render/re-render the plugin tab asynchronously.
// ==========================================
if (!document._itprofileRefreshHandlerInstalled) {

    document._itprofileRefreshHandlerInstalled = true;

    document.addEventListener('click', function (event) {

        event = event || window.event;

        var target = event.target || event.srcElement;

        if (!target) return;

        // Handle clicks on the button itself
        // or on an element inside the button.
        var scanButton = target;

        while (scanButton && scanButton !== document) {

            if (scanButton.id === 'itprofRefreshBtn') {
                break;
            }

            scanButton = scanButton.parentNode;
        }

        if (!scanButton || scanButton === document) return;

        if (event.preventDefault) {
            event.preventDefault();
        }

        // Make sure we still have a selected device.
        if (typeof currentNode === 'undefined' ||
            !currentNode ||
            !currentNode._id) {

            if (pluginHandler.itprofile &&
                pluginHandler.itprofile.loadInventoryError) {

                pluginHandler.itprofile.loadInventoryError(
                    null,
                    {
                        message: 'No device selected.'
                    }
                );
            }

            return;
        }

        var summary = document.getElementById('itprofSummary');
        var status = document.getElementById('itprofStatus');
        var printButton = document.getElementById('itprofPrintBtn');

        if (summary) {
            QH('itprofSummary', '');
        }

        if (status) {
            QH(
                'itprofStatus',
                'Scanning endpoint for inventory data... ' +
                '(first run may take longer while WMI/CIM queries complete.)'
            );
        }

        if (printButton) {
            printButton.disabled = true;
        }

        // Prevent accidental double-click scans.
        scanButton.disabled = true;

        try {

            var request = {
                action: 'plugin',
                plugin: 'itprofile',
                pluginaction: 'getInventory',
                nodeid: currentNode._id
            };

            // MeshCentral normally exposes meshserver.
            if (typeof meshserver !== 'undefined' &&
                meshserver !== null &&
                typeof meshserver.send === 'function') {

                if (status) {
                    QH(
                        'itprofStatus',
                        'Sending inventory request to MeshCentral server...'
                    );
                }

                meshserver.send(request);

            // Compatibility fallback.
            } else if (typeof server !== 'undefined' &&
                       server !== null &&
                       typeof server.send === 'function') {

                if (status) {
                    QH(
                        'itprofStatus',
                        'Sending inventory request to MeshCentral server...'
                    );
                }

                server.send(request);

            } else {

                throw new Error(
                    'MeshCentral WebSocket object not found.'
                );
            }

        } catch (err) {

            scanButton.disabled = false;

            if (pluginHandler.itprofile &&
                pluginHandler.itprofile.loadInventoryError) {

                pluginHandler.itprofile.loadInventoryError(
                    null,
                    {
                        message: 'WebSocket Error: ' +
                            (err && err.message ?
                                err.message :
                                String(err))
                    }
                );
            }

            return;
        }

        // Re-enable after a short delay.
        // The button can still be clicked again once
        // the previous request has been sent.
        setTimeout(function () {

            if (scanButton) {
                scanButton.disabled = false;
            }

        }, 1000);

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

        var statusEl = document.getElementById('itprofStatus');
        var summaryEl = document.getElementById('itprofSummary');

        if (statusEl) statusEl.innerText = 'Scan complete.';

        if (!msg || !msg.data) {
            if (summaryEl) summaryEl.innerHTML = '<span style="color:#d9534f; font-weight:bold;">No data returned from Agent.</span>';
            return;
        }

        var d = msg.data;

        if (d.error) {
            if (summaryEl) summaryEl.innerHTML = '<span style="color:#d9534f;"><b>Agent reported an error:</b> ' + esc(d.error) + '</span>';
            return;
        }

        // ---- Build Computer Hardware Information rows ----
        // Each detected physical device receives its own row.
        // This keeps its serial/property number, acquisition date and cost separate.

        var rows = [
            [d.builtType || 'System Unit', (d.manufacturer || '') + ' ' + (d.model || '') + (d.biosVersion ? (' | BIOS ' + d.biosVersion) : ''), d.serialNumber || '', false],
            ['Processor', d.cpu ? (d.cpu.name + ' (' + d.cpu.cores + 'C/' + d.cpu.logicalProcessors + 'T)') : '', '', false],
            ['Motherboard', d.motherboard ? ((d.motherboard.manufacturer || '') + ' ' + (d.motherboard.product || '')) : '', d.motherboard ? (d.motherboard.serialNumber || '') : '', false]
        ];

        // SMBIOS/WMI FormFactor 14 is an SMD (soldered) memory device. Some
        // systems report the same fact only through their slot/locator label.
        function getMemoryMountStatus(memoryModule) {
            var formFactor = memoryModule.formFactor;
            var formFactorNumber = parseInt(formFactor, 10);
            var formFactorText = String(formFactor).toLowerCase();
            var location = [memoryModule.deviceLocator, memoryModule.bankLabel, memoryModule.tag, memoryModule.slot, memoryModule.location].join(' ').toLowerCase();
            if (formFactorNumber === 14 || formFactorText === 'smd' || formFactorText === 'surface mount' || location.indexOf('onboard') >= 0 || location.indexOf('on-board') >= 0 || location.indexOf('soldered') >= 0 || location.indexOf('embedded') >= 0) return 'Built-in';
            return 'Removable';
        }

        if (d.memoryModules && d.memoryModules.length) {
            for (var memIdx = 0; memIdx < d.memoryModules.length; memIdx++) {
                var memoryModule = d.memoryModules[memIdx];
                rows.push([
                    'Memory (RAM)',
                    (memoryModule.capacityGB || '?') + 'GB @ ' + (memoryModule.speedMHz || '?') + 'MHz ' + (memoryModule.manufacturer || '') + ' (' + getMemoryMountStatus(memoryModule) + ')',
                    memoryModule.serialNumber || '',
                    false
                ]);
            }
        } else {
            rows.push(['Memory (RAM)', (d.memoryTotalGB || '?') + 'GB Total', '', false]);
        }

        if (d.storage && d.storage.length) {
            for (var storageIdx = 0; storageIdx < d.storage.length; storageIdx++) {
                var storageDevice = d.storage[storageIdx];
                rows.push([
                    'Storage Device',
                    (storageDevice.model || 'Unknown') + ' ' + (storageDevice.sizeGB || '?') + 'GB (' + (storageDevice.mediaType || '?') + ', ' + (storageDevice.healthStatus || '?') + ')',
                    storageDevice.serialNumber || '',
                    false
                ]);
            }
        } else {
            rows.push(['Storage Device', 'Not detected', '', false]);
        }

        function addDetectedRows(component, devices, noDeviceText, specification, serialNumber) {
            var deviceList, deviceIdx, device;
            if (!devices || devices.length === 0) {
                rows.push([component, noDeviceText, '', false]);
                return;
            }
            deviceList = Object.prototype.toString.call(devices) === '[object Array]' ? devices : [devices];
            for (deviceIdx = 0; deviceIdx < deviceList.length; deviceIdx++) {
                device = deviceList[deviceIdx];
                rows.push([component, specification(device), serialNumber ? serialNumber(device) : '', false]);
            }
        }

        addDetectedRows('Video Card', d.video, 'Not detected', function (video) {
            return (video.name || 'Unknown') + (video.vramGB ? (' (' + video.vramGB + 'GB)') : '');
        });
        addDetectedRows('CD / DVD-ROM', d.optical, 'Not detected', function (opticalDrive) {
            return opticalDrive || 'Unknown';
        });
        addDetectedRows('Keyboard', d.keyboard, 'Not detected', function (keyboard) {
            return keyboard || 'Unknown';
        });
        addDetectedRows('Mouse', d.pointingDevice, 'Not detected', function (pointingDevice) {
            return pointingDevice || 'Unknown';
        });
        addDetectedRows('Monitor', d.monitors, 'Not detected (needs active display/driver)', function (monitor) {
            return (monitor.manufacturer || '') + ' ' + (monitor.model || '');
        }, function (monitor) {
            return monitor.serialNumber || '';
        });

        rows = rows.concat([
            ['UPS', '', '', true],
            ['AVR / AVS', '', '', true],
            ['Document Scanner', '', '', true],
            ['Barcode Scanner', '', '', true],
            ['Cash Drawer', '', '', true]
        ]);

        addDetectedRows('Printer/s', d.printers, 'None detected', function (printer) {
            return printer || 'Unknown';
        });
        addDetectedRows('External / Flash Drive', d.externalDrives, 'None connected at scan time', function (externalDrive) {
            return (externalDrive.model || 'Unknown') + ' ' + (externalDrive.sizeGB || '?') + 'GB';
        }, function (externalDrive) {
            return externalDrive.serialNumber || '';
        });
        addDetectedRows('Webcam', d.webcam, 'Not detected', function (webcam) {
            return webcam || 'Unknown';
        });
        addDetectedRows('Speaker / Headset', d.audioDevices, 'Not detected', function (audioDevice) {
            return audioDevice || 'Unknown';
        });

        var hwRowsHtml = '';
        for (var r = 0; r < rows.length; r++) {
            var comp = rows[r][0], spec = rows[r][1], serial = rows[r][2], manualOnly = rows[r][3];
            hwRowsHtml += '<tr>'
                + '<td style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3);">' + esc(comp) + '</td>'
                + '<td style="padding:4px 6px; border:1px solid rgba(128,128,128,0.3);">' + (manualOnly ? '<input type="text" placeholder="Manual entry" style="width:100%;">' : '<span class="itprofEditableSpec" tabindex="0" title="Click to edit" style="display:block; min-height:16px; cursor:text;">' + esc(spec) + '</span>') + '</td>'
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

        var allSoftwareHtml = '<details class="itprofAllSoftware" style="margin-top:8px;"><summary style="cursor:pointer;">All detected installed programs (' + (d.installedSoftwareAll ? d.installedSoftwareAll.length : 0) + ')</summary>'
            + '<div class="itprofAllSoftwareList" style="max-height:180px; overflow-y:auto; font-size:12px; margin-top:6px;">';
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
            + '<div style="' + sectionStyle + '"><div style="font-weight:bold; margin-bottom:8px;">Computer Hardware Information</div>' + hwTableHtml + '</div>'
            + '<div style="' + sectionStyle + '"><div style="font-weight:bold; margin-bottom:8px;">System Information</div>' + sysInfoHtml + '</div>'
            + '<div style="' + sectionStyle + '"><div style="font-weight:bold; margin-bottom:8px;">Software Applications Installed</div>' + checklistHtml + allSoftwareHtml + '</div>'
            + '<div style="' + sectionStyle + '"><div style="font-weight:bold; margin-bottom:8px;">Sign-off</div>' + signoffHtml + '</div>'
            + '<div style="margin-top:10px; opacity:0.6; font-size:12px; text-align:right;"><i>Scanned at: ' + esc(d.collectedAt) + '</i></div>';

        if (summaryEl) summaryEl.innerHTML = summaryHtml;

        var pBtn = document.getElementById('itprofPrintBtn');
        if (pBtn) {
            pBtn.disabled = false;
            pBtn.onclick = function () { pluginHandler.itprofile.buildPrintable(d); };
        }

        if (summaryEl) {
            summaryEl.onclick = function (event) {
                var target = event ? (event.target || event.srcElement) : null;
                if (!target || target.className !== 'itprofEditableSpec') return;

                var oldValue = target.textContent || target.innerText || '';
                var editor = document.createElement(oldValue.length > 80 ? 'textarea' : 'input');
                editor.type = 'text';
                editor.value = oldValue;
                editor.style.width = '100%';
                editor.style.boxSizing = 'border-box';
                if (editor.tagName.toLowerCase() === 'textarea') {
                    editor.rows = 3;
                }

                function saveSpecification() {
                    if (!editor.parentNode) return;
                    var replacement = document.createElement('span');
                    replacement.className = 'itprofEditableSpec';
                    replacement.tabIndex = 0;
                    replacement.title = 'Click to edit';
                    replacement.style.display = 'block';
                    replacement.style.minHeight = '16px';
                    replacement.style.cursor = 'text';
                    replacement.appendChild(document.createTextNode(editor.value));
                    editor.parentNode.replaceChild(replacement, editor);
                }

                editor.onblur = saveSpecification;
                editor.onkeydown = function (keyEvent) {
                    keyEvent = keyEvent || window.event;
                    if (keyEvent.keyCode === 13 && editor.tagName.toLowerCase() !== 'textarea') {
                        if (keyEvent.preventDefault) keyEvent.preventDefault();
                        saveSpecification();
                    } else if (keyEvent.keyCode === 27) {
                        editor.value = oldValue;
                        saveSpecification();
                    }
                };

                target.parentNode.replaceChild(editor, target);
                editor.focus();
                if (editor.select) editor.select();
            };
        }

        pluginHandler.itprofile._lastScan = d;
    };

    obj.buildPrintable = function (dOverride) {
        var d = dOverride || (pluginHandler.itprofile && pluginHandler.itprofile._lastScan);
        if (!d) return;

        function esc(s) {
            if (s == null) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function val(id) {
            var el = document.getElementById(id);
            return el ? esc(el.value) : '';
        }

        var rowsForPrint = document.querySelectorAll('#itprofSummary table tbody tr');
        var hwRowsPrintHtml = '';
        for (var i = 0; i < rowsForPrint.length; i++) {
            var cells = rowsForPrint[i].querySelectorAll('td');
            var cellVals = [];
            for (var c = 0; c < cells.length; c++) {
                var inp = cells[c].querySelector('input, textarea');
                cellVals.push(esc(inp ? inp.value : cells[c].innerText));
            }
            hwRowsPrintHtml += '<tr><td>' + cellVals.join('</td><td>') + '</td></tr>';
        }

        var w = window.open('', '_blank');
        if (!w) return;

        var allSoftwarePrintHtml = '<div style="font-size:12px; margin-top:6px;"><b>All detected installed programs (' + (d.installedSoftwareAll ? d.installedSoftwareAll.length : 0) + ')</b>';
        if (d.installedSoftwareAll) {
            for (var asPrintIdx = 0; asPrintIdx < d.installedSoftwareAll.length; asPrintIdx++) {
                var printSw = d.installedSoftwareAll[asPrintIdx];
                allSoftwarePrintHtml += '<div>' + esc(printSw.name) + (printSw.version ? (' <span style="opacity:0.6;">v' + esc(printSw.version) + '</span>') : '') + '</div>';
            }
        }
        allSoftwarePrintHtml += '</div>';

        var softwareChecklistHtml = '';
        if (d.installedSoftwareChecklist) {
            var printChecklistKeys = Object.keys(d.installedSoftwareChecklist);
            softwareChecklistHtml = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 12px;">';
            for (var printCk = 0; printCk < printChecklistKeys.length; printCk++) {
                var printChecklistName = printChecklistKeys[printCk];
                var printFound = d.installedSoftwareChecklist[printChecklistName];
                softwareChecklistHtml += '<div>' + (printFound ? '&#9745;' : '&#9744;') + ' ' + esc(printChecklistName) + (printFound ? (' <span style="opacity:0.6;">(' + esc(printFound) + ')</span>') : '') + '</div>';
            }
            softwareChecklistHtml += '</div>';
        }

        var printHtml = '<!DOCTYPE html><html><head><title>IT Inventory Profile - ' + esc(d.computerName) + '</title>'
            + '<style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px;} table{width:100%;border-collapse:collapse;margin-bottom:16px;} '
            + 'td,th{border:1px solid #333;padding:4px 6px;text-align:left;} h1{font-size:18px;} h2{font-size:14px;margin-top:20px;}</style></head><body>'
            + '<h1>IT Inventory Profile (SIDC-SS-F-ICT-013)</h1>'
            + '<table><tr><td><b>Date of Profiling:</b> ' + val('itprofDate') + '</td><td><b>Control No.:</b> ' + val('itprofControlNo') + '</td></tr>'
            + '<tr><td><b>Name of User:</b> ' + val('itprofUserName') + '</td><td><b>Dept./Branch:</b> ' + val('itprofDept') + '</td></tr></table>'
            + '<h2>Computer Hardware Information</h2>'
            + '<table><thead><tr><th>Component</th><th>Specifications</th><th>Property No./Serial</th><th>Acquisition Date</th><th>Acquisition Cost</th></tr></thead>'
            + '<tbody>' + hwRowsPrintHtml + '</tbody></table>'
            + '<h2>System Information</h2>' + document.getElementById('itprofSummary').children[1].innerHTML
            + '<h2>Software Applications Installed</h2>' + softwareChecklistHtml + allSoftwarePrintHtml
            + '<h2>Sign-off</h2>' + document.getElementById('itprofSummary').children[3].innerHTML
            + '<script>window.onload = function(){ window.print(); };<\/script>'
            + '</body></html>';

        w.document.open();
        w.document.write(printHtml);
        w.document.close();
    };

    obj.loadInventoryError = function (serverObj, msg) {
        var statusEl = document.getElementById('itprofStatus');
        var summaryEl = document.getElementById('itprofSummary');

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
        if (command.plugin !== 'itprofile') return;

        var sessionid = null;
        try {
            sessionid = myparent.ws.sessionId;
        } catch (e) {}

        var currentSessionid = command.sessionid || sessionid;

        switch (command.pluginaction) {

            case 'getInventory':

    console.log(
        '[IT Profile] getInventory request received. Node:',
        command.nodeid,
        'Session:',
        currentSessionid
    );

    var agent = obj.meshServer.webserver.wsagents[command.nodeid];

    if (agent != null) {

        console.log(
            '[IT Profile] Sending inventory request to agent:',
            command.nodeid
        );

        agent.send(JSON.stringify({
            action: 'plugin',
            plugin: 'itprofile',
            pluginaction: 'getInventory',
            sessionid: currentSessionid,
            nodeid: command.nodeid
        }));

    } else {

        console.log(
            '[IT Profile] Agent not connected:',
            command.nodeid
        );

        if (currentSessionid &&
            obj.meshServer.webserver.wssessions2 &&
            obj.meshServer.webserver.wssessions2[currentSessionid]) {

            obj.meshServer.webserver.wssessions2[currentSessionid].send(
                JSON.stringify({
                    action: 'plugin',
                    plugin: 'itprofile',
                    method: 'loadInventoryError',
                    message: 'Agent is offline or disconnected.',
                    nodeid: command.nodeid
                })
            );
        }
    }

    break;

            case 'inventoryData':
            case 'inventoryError':
                var targetSessionid = command.sessionid;
                var response = {
                    action: 'plugin',
                    plugin: 'itprofile',
                    method: command.pluginaction === 'inventoryData' ? 'loadInventoryData' : 'loadInventoryError',
                    data: command.data,
                    message: command.message,
                    nodeid: command.nodeid
                };

                if (targetSessionid && obj.meshServer.webserver.wssessions2 && obj.meshServer.webserver.wssessions2[targetSessionid]) {
                    try {
                        obj.meshServer.webserver.wssessions2[targetSessionid].send(JSON.stringify(response));
                    } catch (e) {
                        console.log('IT Profile routing error:', e);
                    }
                }
                break;
        }
    };

    return obj;
};
