#!/bin/bash
# Notification hook - cross-platform notification when Claude needs input
# Supports macOS (osascript), Linux (notify-send), and WSL

TITLE="Claude Code"
MESSAGE="Awaiting your input"

# Detect platform and send notification
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  osascript -e "display notification \"$MESSAGE\" with title \"$TITLE\"" 2>/dev/null || true
elif command -v notify-send &> /dev/null; then
  # Linux with notify-send
  notify-send "$TITLE" "$MESSAGE" 2>/dev/null || true
elif grep -qi microsoft /proc/version 2>/dev/null; then
  # WSL - use PowerShell toast notification
  powershell.exe -Command "
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    \$template = '<toast><visual><binding template=\"ToastText02\"><text id=\"1\">$TITLE</text><text id=\"2\">$MESSAGE</text></binding></visual></toast>'
    \$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    \$xml.LoadXml(\$template)
    \$toast = [Windows.UI.Notifications.ToastNotification]::new(\$xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code').Show(\$toast)
  " 2>/dev/null || true
fi

exit 0
