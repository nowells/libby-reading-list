import { useState, useEffect, useCallback } from "react";
import {
  getNotificationSettings,
  setNotificationSettings,
  type NotificationSettings,
} from "~/lib/storage";
import {
  requestNotificationPermission,
  getNotificationPermission,
  clearBadge,
} from "~/lib/notifications";

export function NotificationSettingsPanel() {
  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  const handleToggleEnabled = useCallback(async () => {
    if (!settings.enabled) {
      const granted = await requestNotificationPermission();
      setPermission(getNotificationPermission());
      if (!granted) return;

      const next = { ...settings, enabled: true };
      setSettings(next);
      setNotificationSettings(next);
    } else {
      const next = { ...settings, enabled: false };
      setSettings(next);
      setNotificationSettings(next);
    }
  }, [settings]);

  const handleToggleBadge = useCallback(() => {
    const next = { ...settings, badgeEnabled: !settings.badgeEnabled };
    setSettings(next);
    setNotificationSettings(next);
    if (!next.badgeEnabled) clearBadge();
  }, [settings]);

  const isUnsupported = permission === "unsupported";
  const isDenied = permission === "denied";
  const [badgeSupported, setBadgeSupported] = useState(false);

  useEffect(() => {
    setBadgeSupported("setAppBadge" in navigator);
  }, []);

  return (
    <div className="space-y-4">
      {/* Badge — only shown when Badging API is available (installed PWA) */}
      {badgeSupported && (
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h4 className="text-sm font-medium text-gray-900 dark:text-white">App Badge</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Show the number of available books on the app icon.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.badgeEnabled}
            onClick={handleToggleBadge}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
              settings.badgeEnabled ? "bg-amber-600" : "bg-gray-200 dark:bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                settings.badgeEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      )}

      {/* Notifications — requires permission */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white">
            Availability Notifications
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Get notified when books on your list become newly available at your library.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          disabled={isUnsupported || isDenied}
          onClick={handleToggleEnabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
            settings.enabled ? "bg-amber-600" : "bg-gray-200 dark:bg-gray-600"
          } ${isUnsupported || isDenied ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              settings.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {isDenied && (
        <p className="text-xs text-red-500 dark:text-red-400">
          Notifications are blocked by your browser. Please allow notifications for this site in
          your browser settings.
        </p>
      )}

      {isUnsupported && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Notifications are not supported in this browser.
        </p>
      )}
    </div>
  );
}
