import { useState } from "preact/hooks";
import { savePref } from "../utils/preferences";
import { readUserData } from "../game/util";
import type { UserPreferences } from "../game/types";
import {
  osNotificationsEnabled,
  toggleOsNotifications,
} from "../utils/os-notifications";

type NotifRow = {
  label: string;
  appKey: keyof UserPreferences;
  emailKey: keyof UserPreferences;
  appDefault: boolean;
};

const ROWS: NotifRow[] = [
  {
    label: "Your turn",
    appKey: "notify_your_turn_app",
    emailKey: "notify_your_turn_email",
    appDefault: true,
  },
  {
    label: "Your turn (correspondence)",
    appKey: "notify_your_turn_corr_app",
    emailKey: "notify_your_turn_corr_email",
    appDefault: true,
  },
  {
    label: "New challenge",
    appKey: "notify_challenge_app",
    emailKey: "notify_challenge_email",
    appDefault: true,
  },
  {
    label: "New message",
    appKey: "notify_message_app",
    emailKey: "notify_message_email",
    appDefault: true,
  },
];

function isNotifSupported(): boolean {
  return "Notification" in window;
}

export function NotificationSettings({ hasEmail }: { hasEmail: boolean }) {
  const userData = readUserData();
  const prefs = userData?.preferences ?? {};

  const [values, setValues] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const row of ROWS) {
      init[row.appKey] =
        (prefs[row.appKey] as boolean | undefined) ?? row.appDefault;
      init[row.emailKey] =
        (prefs[row.emailKey] as boolean | undefined) ?? false;
    }
    return init;
  });

  function toggle(key: keyof UserPreferences) {
    const next = !values[key];
    setValues((v) => ({ ...v, [key]: next }));
    savePref(key, next);
  }

  return (
    <div class="notification-settings">
      {isNotifSupported() && (
        <label class="notif-os-toggle">
          <input
            type="checkbox"
            checked={osNotificationsEnabled.value}
            onChange={toggleOsNotifications}
          />
          OS notifications
          {Notification.permission === "denied" && (
            <span class="notif-hint"> (blocked by browser)</span>
          )}
        </label>
      )}
      <table class="notif-table">
        <thead>
          <tr>
            <th></th>
            <th>In-app</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.appKey}>
              <td>{row.label}</td>
              <td>
                <input
                  type="checkbox"
                  checked={values[row.appKey]}
                  onChange={() => toggle(row.appKey)}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={values[row.emailKey]}
                  disabled={!hasEmail}
                  onChange={() => toggle(row.emailKey)}
                  title={
                    hasEmail ? undefined : "Set an email address to enable"
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!hasEmail && (
        <p class="notif-hint">
          Add an email address above to enable email notifications.
        </p>
      )}
    </div>
  );
}
