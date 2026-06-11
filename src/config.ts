/**
 * When set to true, some notifications will be sent to the users who have the correct permissions.
 * 
 * Can be set to true by setting `PERM_NOTIF` to `true` in the environment file.
 * 
 * * * *
 * 
 * Example (when activated): `NotificationType.MEDIA_PENDING` is sent out to all users with `SeerrPermission.MANAGE_REQUESTS`
 */
export const hasPermissionNotifications: boolean = process.env.PERM_NOTIF == "true";

/**
 * When set to true, notifications will be sent only to the concerned persons
 * 
 * Can be set to true by setting `TARGET_NOTIF` to `true` in the environment file.
 * 
 * * * *
 * 
 * Example (when activated): `NotificationType.MEDIA_DECLINED` is sent out to the user who initially made the request
 */
export const hasTargettedNotifications: boolean = process.env.TARGET_NOTIF == "true";