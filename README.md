# IT Profile for MeshCentral

IT Profile is a MeshCentral plugin that collects a Windows endpoint inventory and presents it as an editable, printable IT asset profile.

It is intended for device profiling, asset documentation, and handover records. The scan runs on the endpoint through the MeshCentral agent and does not require a separate agent install.

## Requirements

- MeshCentral `>= 1.1.54`
- Windows endpoints managed by the MeshCentral agent
- PowerShell and Windows CIM/WMI available on the endpoint

## Installation

1. Log in to your MeshCentral server as an Administrator.
2. Navigate to **My Server** -> **Plugins**.
3. Click the **Download Plugin** button.
4. Paste the raw URL of the `config.json` file from this repository:
[https://raw.githubusercontent.com/Tech-Werkz/ITProfile/refs/heads/main/config.json](https://raw.githubusercontent.com/Tech-Werkz/ITProfile/refs/heads/main/config.json)

5. Click **OK** to install.
6. Make sure the plugin is enabled (Green checkmark under the "Status" column).
7. **Important Server Restart:** You must restart the MeshCentral service to load the new UI components. Connect via SSH or terminal to your server and run:

    systemctl restart meshcentral
   ```text
   meshcentral-data/plugins/ITProfile/
   ```

8. Preserve the included directory structure:

   ```text
   ITProfile/
   ├── config.json
   ├── itprofile.js
   ├── modules_meshcore/
       └── itprofile.js
   ```

9. Restart MeshCentral.
10. Open a Windows device, select the **IT Profile** tab, and choose **Scan Device**.

> When updating the plugin, replace both `itprofile.js` files, restart MeshCentral, and run a new scan. The root file renders the tab; `modules_meshcore/itprofile.js` collects endpoint data.

## Inventory collected

### Hardware

- System unit/laptop manufacturer, model, BIOS, and serial number
- Processor and motherboard
- Individual RAM modules, including capacity, speed, manufacturer, available serial number, and **Built-in** or **Removable** status
- Individual storage devices, including model, capacity, media type, health, and serial number
- Video adapters, optical drives, keyboards, mice, monitors, printers, USB/external drives, webcams, and audio devices
- Manual asset rows for UPS, AVR/AVS, document scanner, barcode scanner, and cash drawer

Each detected physical device is shown on its own row so property number, acquisition date, and acquisition cost can be entered independently.

### System and network information

- Windows edition/version, architecture, product key status, image date, and restore-point date
- Computer name, logged-in user, local users, IP address, subnet mask, gateway, and DNS
- Available network interfaces shown as `WiFi`, `LAN`, or `WiFi / LAN`
- USB storage policy and installed software checklist

## RAM and storage details

RAM status is determined from SMBIOS/WMI form-factor and locator information:

- **Built-in** — firmware identifies a surface-mounted, soldered, embedded, or onboard module.
- **Removable** — no built-in indicator is reported.

RAM serial numbers are displayed only when firmware returns a usable value. Placeholder values such as `00000000`, `N/A`, `Unknown`, and `Default String` are omitted.

NVMe serial numbers are read directly from the Windows Storage API to avoid mismatching an NVMe device with a different controller index. As with all hardware inventory tools, the values ultimately depend on what the device firmware and driver expose to Windows.

## Troubleshooting

If a scan fails or returns incomplete information:

1. Confirm the device is online and running a current MeshCentral agent.
2. Restart MeshCentral after any plugin update.
3. Run `itprofile-debug.ps1` locally on the affected Windows endpoint as an administrator. It is a readable diagnostic version of the endpoint collection script and shows PowerShell errors directly.
4. Check that CIM/WMI queries such as `Get-CimInstance Win32_PhysicalMemory` and `Get-PhysicalDisk` work on the endpoint.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
