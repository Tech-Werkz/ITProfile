/**
 * @description MeshCentral IT Inventory Plugin - Agent Side
 * @note Runs in MeshCore (duktape) - ES5 compliant. All code and comments in English.
 */

"use strict";

var mesh;
var obj = this;

/**
 * Main consoleaction handler - receives commands routed from the server
 */
function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;

    var fnname = null;
    if (typeof args['_'] != 'undefined') {
        fnname = args['_'][1];
    } else if (args.pluginaction) {
        fnname = args.pluginaction;
    }

    if (fnname == null) {
        return;
    }

    var currentSessionid = args.sessionid || sessionid;

    switch (fnname) {
        case 'getInventory':
            doGetInventory(currentSessionid, args.nodeid);
            break;
        default:
            break;
    }
}

/**
 * Executes a PowerShell command synchronously using waitExit()
 */
function runPowerShell(command, callback) {
    var Xerr = null;
    var Xstdout = null;
    var Xstderr = null;

    try {
        var child = require('child_process').execFile(
            process.env['windir'] + '\\system32\\WindowsPowerShell\\v1.0\\powershell.exe',
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
            { cwd: process.env['TEMP'] || process.env['SystemRoot'] || null },
            function (err, stdout, stderr) {
                Xerr = err;
                Xstdout = stdout;
                Xstderr = stderr;
            }
        );

        if (child && child.stdout) {
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
        }

        child.waitExit();

        if (child && child.stdout && typeof child.stdout.str === 'string') {
            Xstdout = child.stdout.str.trim();
        }

        callback(Xerr, Xstdout, Xstderr);
    } catch (e) {
        callback(e, null, null);
    }
}

/**
 * Packages and sends the final result back to the server for routing
 */
function sendResult(action, success, data, message, sessionid, nodeid) {
    mesh.SendCommand({
        action: 'plugin',
        plugin: 'itinventory',
        pluginaction: action,
        success: success,
        data: data,
        message: message,
        sessionid: sessionid,
        nodeid: nodeid
    });
}

/**
 * Collects a full IT-asset inventory via PowerShell, matching the fields
 * used on the "IT Inventory Profile" (SIDC-SS-F-ICT-013) form as closely
 * as can be determined automatically. Fields that require a physical look
 * at the machine (UPS, AVR/AVS, barcode scanner, cash drawer, document
 * scanner, property tags, acquisition cost, etc.) are intentionally left
 * for the technician to fill in on the client side.
 */
function doGetInventory(sessionid, nodeid) {
    if (process.platform !== 'win32') {
        sendResult('inventoryError', false, null, 'Platform not supported. Windows only.', sessionid, nodeid);
        return;
    }

    var psCommand =
    "$ProgressPreference = 'SilentlyContinue'; " +
    "$WarningPreference = 'SilentlyContinue'; " +
    "$ErrorActionPreference = 'Stop'; " +
    "try { " +
    "$cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue; " +
    "$bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue; " +
    "$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue; " +
    "$cpu = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1; " +
    "$memTotalGB = if ($os -and $os.TotalVisibleMemorySize) { [math]::Round(($os.TotalVisibleMemorySize/1MB),2) } else { $null }; " +
    "$uninstallPaths = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); " +
    "$installedRaw = @(); " +
    "foreach ($p in $uninstallPaths) { try { $items = Get-ItemProperty $p -ErrorAction SilentlyContinue; foreach ($i in $items) { if ($i.DisplayName) { $installedRaw += [PSCustomObject]@{ name = [string]$i.DisplayName; version = [string]$i.DisplayVersion } } } } catch {} }; " +
    "$installedRaw = @($installedRaw | Sort-Object name -Unique); " +
    "$checklist = @('VB Runtime','Symantec','WPS Office','WinASO','Firefox','Fortinet','Windows Media Player','Rustdesk','Foxit Reader','MySQL Connector','Access Database Engine','One Touch','MySQL Connector Net','CRRuntime','7-Zip','HWiNFO','Liteshow','SIDC POS','Koopinoy','SAP','MySQL Server','Google Drive','PCloud','Hamachi'); " +
    "$checklistResult = @{}; " +
    "foreach ($item in $checklist) { $found = $installedRaw | Where-Object { $_.name -match [Regex]::Escape($item) } | Select-Object -First 1; $checklistResult[$item] = if ($found) { $found.version } else { $null } }; " +
    "$result = @{ " +
    "builtType = 'System Unit'; " +
    "manufacturer = if ($cs) { $cs.Manufacturer } else { $null }; " +
    "model = if ($cs) { $cs.Model } else { $null }; " +
    "serialNumber = if ($bios) { $bios.SerialNumber } else { $null }; " +
    "biosVersion = if ($bios) { $bios.SMBIOSBIOSVersion } else { $null }; " +
    "cpu = @{ name = if ($cpu) { $cpu.Name } else { $null }; manufacturer = if ($cpu) { $cpu.Manufacturer } else { $null }; cores = if ($cpu) { $cpu.NumberOfCores } else { $null }; logicalProcessors = if ($cpu) { $cpu.NumberOfLogicalProcessors } else { $null } }; " +
    "memoryTotalGB = $memTotalGB; " +
    "storage = @(); " +
    "video = @(); " +
    "optical = @(); " +
    "keyboard = $null; " +
    "pointingDevice = $null; " +
    "printers = @(); " +
    "webcam = @(); " +
    "audioDevices = @(); " +
    "builtCategory = if ($os -and $os.ProductType -eq 1) { 'Terminal' } else { 'Server' }; " +
    "processorType = if ([Environment]::Is64BitOperatingSystem) { '64-based' } else { '86-based' }; " +
    "operatingSystem = if ($os) { $os.Caption } else { $null }; " +
    "osVersion = if ($os) { $os.Version } else { $null }; " +
    "productKey = 'Not retrievable - check Settings > Activation'; " +
    "systemType = if ($os) { $os.OSArchitecture } else { $null }; " +
    "ipv4Address = $null; " +
    "subnetMask = $null; " +
    "defaultGateway = $null; " +
    "preferredDNS = $null; " +
    "connectionType = 'Unknown'; " +
    "computerName = if ($cs) { $cs.Name } else { $null }; " +
    "loginName = if ($cs) { $cs.UserName } else { $env:USERNAME }; " +
    "localUsers = @(); " +
    "usbStorage = 'Enabled'; " +
    "windowsImageDate = if ($os -and $os.InstallDate) { $os.InstallDate.ToString('yyyy-MM-dd') } else { $null }; " +
    "restorePointDate = $null; " +
    "installedSoftwareChecklist = $checklistResult; " +
    "installedSoftwareAll = $installedRaw; " +
    "collectedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') " +
    "}; " +
    "$result | ConvertTo-Json -Compress -Depth 6; " +
    "} catch { " +
    "$errorResult = @{ error = $_.Exception.Message; collectedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }; " +
    "$errorResult | ConvertTo-Json -Compress -Depth 6; " +
    "exit 0; " +
    "}";

    runPowerShell(psCommand, function (err, stdout, stderr) {
        var data = null;
        var isSuccess = false;

        if (stdout && stdout.length > 0) {
            try {
                data = JSON.parse(stdout);
                isSuccess = !!(data && !data.error);
            } catch (e) {
                // Parsing failed
            }
        }

        if (isSuccess) {
            sendResult('inventoryData', true, data, null, sessionid, nodeid);
        } else {
            var errorDetails = 'PowerShell Execution Failed. ';
            if (err) errorDetails += 'Exit Code: ' + err + ' | ';
            if (stderr) errorDetails += 'StdErr: ' + stderr + ' | ';
            if (stdout) errorDetails += 'StdOut: ' + stdout;

            sendResult('inventoryError', false, null, errorDetails, sessionid, nodeid);
        }
    });
}

// Expose functions to the MeshCore engine
module.exports = { consoleaction: consoleaction };
