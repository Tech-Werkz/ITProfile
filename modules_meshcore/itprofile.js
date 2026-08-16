/**
 * @description MeshCentral IT Profile Plugin - Agent Side
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
    var Xstdout = '';
    var Xstderr = '';

    try {
        var child = require('child_process').execFile(
            process.env['windir'] +
            '\\system32\\WindowsPowerShell\\v1.0\\powershell.exe',

            [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                '-'
            ]
        );

        if (child && child.stdout) {
            child.stdout.str = '';

            child.stdout.on('data', function (chunk) {
                this.str += chunk.toString();
            });
        }

        if (child && child.stderr) {
            child.stderr.str = '';

            child.stderr.on('data', function (chunk) {
                this.str += chunk.toString();
            });
        }

        /*
         * Send the complete PowerShell script through stdin.
         *
         * Using "-" with -Command tells PowerShell to read
         * the command/script from standard input.
         */
        if (child && child.stdin) {
            child.stdin.write(command);
            child.stdin.write('\r\nexit\r\n');
        }

        /*
         * MeshCore uses waitExit() for synchronous child execution.
         */
        child.waitExit();

        if (child &&
            child.stdout &&
            typeof child.stdout.str === 'string') {

            Xstdout = child.stdout.str.trim();
        }

        if (child &&
            child.stderr &&
            typeof child.stderr.str === 'string') {

            Xstderr = child.stderr.str.trim();
        }

        if (child &&
            typeof child.exitCode === 'number' &&
            child.exitCode !== 0) {

            Xerr = child.exitCode;
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
        plugin: 'itprofile',
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
 *
 * Individual queries use -ErrorAction SilentlyContinue so one missing
 * WMI class (e.g. no monitor EDID) doesn't blank out the rest of the
 * report; the outer try/catch is only a last-resort safety net.
 */
function doGetInventory(sessionid, nodeid) {
    if (process.platform !== 'win32') {
        sendResult('inventoryError', false, null, 'Platform not supported. Windows only.', sessionid, nodeid);
        return;
    }

    var psCommand =
    "$ProgressPreference = 'SilentlyContinue'; " +
    "$WarningPreference = 'SilentlyContinue'; " +
    "$ErrorActionPreference = 'SilentlyContinue'; " +
    "try { " +

    "$cs = Get-CimInstance Win32_ComputerSystem; " +
    "$bios = Get-CimInstance Win32_BIOS; " +
    "$enclosure = Get-CimInstance Win32_SystemEnclosure; " +
    "$baseboard = Get-CimInstance Win32_BaseBoard; " +
    "$os = Get-CimInstance Win32_OperatingSystem; " +

    "$laptopChassis = @(8,9,10,11,12,14,18,21,30,31,32); " +
    "$isLaptop = $false; " +
    "foreach ($ct in $enclosure.ChassisTypes) { if ($laptopChassis -contains $ct) { $isLaptop = $true } }; " +
    "$builtType = if ($isLaptop) { 'Laptop' } else { 'System Unit' }; " +

    "$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; " +

    "$cleanSerial = { param($value) $serial = ($value -as [string]).Trim(); if (-not $serial -or $serial -match '^(?i:0+|N/?A|UNKNOWN|NONE|DEFAULT STRING|TO BE FILLED BY O\\.E\\.M\\.)$') { return $null }; return $serial }; " +
    "$memModules = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [PSCustomObject]@{ capacityGB = [math]::Round($_.Capacity/1GB,2); speedMHz = $_.Speed; manufacturer = ($_.Manufacturer -as [string]).Trim(); partNumber = ($_.PartNumber -as [string]).Trim(); serialNumber = & $cleanSerial $_.SerialNumber; bankLabel = $_.BankLabel; deviceLocator = $_.DeviceLocator; tag = $_.Tag; formFactor = $_.FormFactor } }); " +
    "$memTotalGB = if ($os -and $os.TotalVisibleMemorySize) { [math]::Round(($os.TotalVisibleMemorySize/1MB),2) } else { $null }; " +

    "$diskDriveSerials = @{}; try { Get-CimInstance Win32_DiskDrive | ForEach-Object { $diskSerial = & $cleanSerial $_.SerialNumber; if ($diskSerial) { $diskDriveSerials[[string]$_.Index] = $diskSerial } } } catch {} ; " +
    "$storage = @(Get-PhysicalDisk | ForEach-Object { $physicalDiskSerial = & $cleanSerial $_.SerialNumber; $serial = if ($_.BusType -eq 'NVMe' -or -not $diskDriveSerials.ContainsKey([string]$_.DeviceId)) { $physicalDiskSerial } else { $diskDriveSerials[[string]$_.DeviceId] }; [PSCustomObject]@{ model = $_.FriendlyName; sizeGB = [math]::Round($_.Size/1GB,2); serialNumber = $serial; mediaType = $_.MediaType; busType = $_.BusType; healthStatus = $_.HealthStatus } }); " +

    "$video = @(Get-CimInstance Win32_VideoController | ForEach-Object { [PSCustomObject]@{ name = $_.Name; vramGB = if ($_.AdapterRAM) { [math]::Round($_.AdapterRAM/1GB,2) } else { $null } } }); " +

    "$optical = @(Get-CimInstance Win32_CDROMDrive | ForEach-Object { $_.Caption }); " +

    "$keyboard = (Get-CimInstance Win32_Keyboard | Select-Object -First 1).Description; " +
    "$pointing = (Get-CimInstance Win32_PointingDevice | Select-Object -First 1).Description; " +

    "$monitors = @(); " +
    "try { $edids = @(Get-CimInstance WmiMonitorID -Namespace root\\wmi); foreach ($m in $edids) { $mfg = -join ($m.ManufacturerName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }); $nm = -join ($m.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }); $sn = -join ($m.SerialNumberID | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }); $monitors += [PSCustomObject]@{ manufacturer = $mfg; model = $nm; serialNumber = $sn } } } catch {} ; " +

    "$printers = @(Get-CimInstance Win32_Printer | ForEach-Object { $_.Name }); " +

    "$externalDrives = @(); " +
    "try { Get-Disk | Where-Object { $_.BusType -eq 'USB' } | ForEach-Object { $externalDrives += [PSCustomObject]@{ model = $_.FriendlyName; sizeGB = [math]::Round($_.Size/1GB,2); serialNumber = & $cleanSerial $_.SerialNumber } } } catch {} ; " +

    "$webcam = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match 'camera|webcam' } | ForEach-Object { $_.Name } | Select-Object -Unique); " +
    "$audioDevices = @(Get-CimInstance Win32_SoundDevice | ForEach-Object { $_.Name }); " +

    "$builtCategory = if ($os -and $os.ProductType -eq 1) { 'Terminal' } else { 'Server' }; " +
    "$procArch = if ([Environment]::Is64BitOperatingSystem) { '64-based' } else { '86-based' }; " +
    "$osSystemType = if ($os) { $os.OSArchitecture } else { $null }; " +

    "$productKey = $null; " +
    "try { $sls = Get-CimInstance -Query 'SELECT * FROM SoftwareLicensingService' -ErrorAction Stop; $productKey = $sls.OA3xOriginalProductKey } catch {} ; " +
    "if (-not $productKey) { $productKey = 'Not retrievable - check Settings > Activation' } ; " +

    "$physicalAdapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue); $hasWifi = @($physicalAdapters | Where-Object { $_.NdisPhysicalMedium -eq 9 -or $_.Name -match 'wi-?fi|wireless' -or $_.InterfaceDescription -match 'wi-?fi|wireless' }).Count -gt 0; $hasLan = @($physicalAdapters | Where-Object { ($_.MediaType -eq '802.3' -or $_.NdisPhysicalMedium -eq 14) -and $_.Name -notmatch 'wi-?fi|wireless' -and $_.InterfaceDescription -notmatch 'wi-?fi|wireless' }).Count -gt 0; $connectionTypes = @(); if ($hasWifi) { $connectionTypes += 'WiFi' }; if ($hasLan) { $connectionTypes += 'LAN' }; $connType = if ($connectionTypes.Count) { $connectionTypes -join ' / ' } else { 'Not detected' }; " +
    "$activeAdapter = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1; " +
    "$ipv4 = $null; $gateway = $null; $dns = $null; $subnet = $null; " +
    "if ($activeAdapter) { $ipv4 = ($activeAdapter.IPv4Address | Select-Object -First 1).IPAddress; $gateway = ($activeAdapter.IPv4DefaultGateway | Select-Object -First 1).NextHop; $dns = ($activeAdapter.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | Select-Object -First 1).ServerAddresses -join ', '; $prefixLen = ($activeAdapter.IPv4Address | Select-Object -First 1).PrefixLength; if ($prefixLen) { $subnet = ([System.Net.IPAddress]([math]::Pow(2,32) - [math]::Pow(2,32-$prefixLen))).IPAddressToString } } ; " +

    "$loginName = if ($cs) { $cs.UserName } else { $null }; " +
    "if (-not $loginName) { $loginName = $env:USERNAME } ; " +

    "$localUsers = @(); " +
    "try { $admins = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction Stop | ForEach-Object { $_.Name }); Get-LocalUser | Where-Object { $_.Enabled -eq $true } | ForEach-Object { $isAdmin = $admins -contains ($env:COMPUTERNAME + '\\' + $_.Name); $localUsers += [PSCustomObject]@{ name = $_.Name; isAdmin = $isAdmin } } } catch {} ; " +

    "$usbStorage = 'Enabled'; " +
    "try { $usbStart = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\USBSTOR' -Name Start -ErrorAction Stop).Start; if ($usbStart -eq 4) { $usbStorage = 'Disabled' } } catch {} ; " +

    "$windowsImageDate = if ($os -and $os.InstallDate) { $os.InstallDate.ToString('yyyy-MM-dd') } else { $null } ; " +
    "$restorePointDate = $null; " +
    "try { $rp = Get-ComputerRestorePoint | Sort-Object CreationTime -Descending | Select-Object -First 1; if ($rp) { $restorePointDate = $rp.ConvertToDateTime($rp.CreationTime).ToString('yyyy-MM-dd HH:mm:ss') } } catch {} ; " +

    "$uninstallPaths = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); " +
    "$installedRaw = @(); " +
    "foreach ($p in $uninstallPaths) { try { $items = Get-ItemProperty $p -ErrorAction SilentlyContinue; foreach ($i in $items) { if ($i.DisplayName) { $installedRaw += [PSCustomObject]@{ name = [string]$i.DisplayName; version = [string]$i.DisplayVersion } } } } catch {} } ; " +
    "$installedRaw = @($installedRaw | Sort-Object name -Unique); " +

    "$checklist = @('VB Runtime','Symantec','WPS Office','WinASO','Firefox','Fortinet','Windows Media Player','Rustdesk','Foxit Reader','MySQL Connector','Access Database Engine','One Touch','MySQL Connector Net','CRRuntime','7-Zip','HWiNFO','Liteshow','SIDC POS','Koopinoy','SAP','MySQL Server','Google Drive','PCloud','Hamachi'); " +
    "$checklistResult = @{}; " +
    "foreach ($item in $checklist) { $found = $installedRaw | Where-Object { $_.name -match [Regex]::Escape($item) } | Select-Object -First 1; $checklistResult[$item] = if ($found) { $found.version } else { $null } } ; " +

    "$result = @{ " +
    "builtType = $builtType; " +
    "manufacturer = if ($cs) { $cs.Manufacturer } else { $null }; " +
    "model = if ($cs) { $cs.Model } else { $null }; " +
    "serialNumber = if ($bios) { $bios.SerialNumber } else { $null }; " +
    "biosVersion = if ($bios) { $bios.SMBIOSBIOSVersion } else { $null }; " +
    "motherboard = @{ manufacturer = if ($baseboard) { $baseboard.Manufacturer } else { $null }; product = if ($baseboard) { $baseboard.Product } else { $null }; serialNumber = if ($baseboard) { $baseboard.SerialNumber } else { $null } }; " +
    "cpu = @{ name = if ($cpu) { $cpu.Name } else { $null }; manufacturer = if ($cpu) { $cpu.Manufacturer } else { $null }; cores = if ($cpu) { $cpu.NumberOfCores } else { $null }; logicalProcessors = if ($cpu) { $cpu.NumberOfLogicalProcessors } else { $null } }; " +
    "memoryModules = $memModules; " +
    "memoryTotalGB = $memTotalGB; " +
    "storage = $storage; " +
    "video = $video; " +
    "optical = $optical; " +
    "keyboard = $keyboard; " +
    "pointingDevice = $pointing; " +
    "monitors = $monitors; " +
    "printers = $printers; " +
    "externalDrives = $externalDrives; " +
    "webcam = $webcam; " +
    "audioDevices = $audioDevices; " +
    "builtCategory = $builtCategory; " +
    "processorType = $procArch; " +
    "operatingSystem = if ($os) { $os.Caption } else { $null }; " +
    "osVersion = if ($os) { $os.Version } else { $null }; " +
    "productKey = $productKey; " +
    "systemType = $osSystemType; " +
    "ipv4Address = $ipv4; " +
    "subnetMask = $subnet; " +
    "defaultGateway = $gateway; " +
    "preferredDNS = $dns; " +
    "connectionType = $connType; " +
    "computerName = if ($cs) { $cs.Name } else { $null }; " +
    "loginName = $loginName; " +
    "localUsers = $localUsers; " +
    "usbStorage = $usbStorage; " +
    "windowsImageDate = $windowsImageDate; " +
    "restorePointDate = $restorePointDate; " +
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
