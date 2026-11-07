// Desktop notification when a long wait finishes. Best effort: macOS via osascript,
// Linux via notify-send, Windows via a PowerShell toast; silent if none works.
const { execFile } = require('child_process');

function notify(title, message) {
  const t = String(title).replace(/["\\]/g, ''), m = String(message).replace(/["\\]/g, '');
  const done = () => {};
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', `display notification "${m}" with title "${t}" sound name "Glass"`], done);
  } else if (process.platform === 'linux') {
    execFile('notify-send', [t, m], done);
  } else if (process.platform === 'win32') {
    const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $n=$x.GetElementsByTagName('text'); $n.Item(0).AppendChild($x.CreateTextNode('${t}'))|Out-Null; $n.Item(1).AppendChild($x.CreateTextNode('${m}'))|Out-Null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('ZPA Shield Deployer').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], done);
  }
}

module.exports = { notify };
