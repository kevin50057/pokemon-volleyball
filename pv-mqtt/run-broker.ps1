while ($true) {
    & 'C:\Program Files\mosquitto\mosquitto.exe' -c 'C:\mosquitto-pv\mosquitto.conf'
    Start-Sleep -Seconds 5
}
