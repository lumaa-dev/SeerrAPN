// MARK: - Permissions

export enum SeerrPermission {
	NONE = 0,
	ADMIN = 2,
	MANAGE_SETTINGS = 4,
	MANAGE_USERS = 8,
	MANAGE_REQUESTS = 16,
	REQUEST = 32,
	VOTE = 64,
	AUTO_APPROVE = 128,
	AUTO_APPROVE_MOVIE = 256,
	AUTO_APPROVE_TV = 512,
	REQUEST_4K = 1024,
	REQUEST_4K_MOVIE = 2048,
	REQUEST_4K_TV = 4096,
	REQUEST_ADVANCED = 8192,
	REQUEST_VIEW = 16384,
	AUTO_APPROVE_4K = 32768,
	AUTO_APPROVE_4K_MOVIE = 65536,
	AUTO_APPROVE_4K_TV = 131072,
	REQUEST_MOVIE = 262144,
	REQUEST_TV = 524288,
	MANAGE_ISSUES = 1048576,
	VIEW_ISSUES = 2097152,
	CREATE_ISSUES = 4194304,
	AUTO_REQUEST = 8388608,
	AUTO_REQUEST_MOVIE = 16777216,
	AUTO_REQUEST_TV = 33554432,
	RECENT_VIEW = 67108864,
	WATCHLIST_VIEW = 134217728,
	MANAGE_BLOCKLIST = 268435456,
	VIEW_BLOCKLIST = 1073741824,
}

export interface PermissionCheckOptions {
	type: "and" | "or";
}

/**
 * Takes a Permission and the users permission value and determines
 * if the user has access to the permission provided. If the user has
 * the admin permission, true will always be returned from this check!
 *
 * @param permissions Single permission or array of permissions
 * @param value users current permission value
 * @param options Extra options to control permission check behavior (mainly for arrays)
 */
export const hasPermission = (
	permissions: SeerrPermission | SeerrPermission[],
	value: number,
	options: PermissionCheckOptions = { type: "and" },
): boolean => {
	let total = 0;

	// If we are not checking any permissions, bail out and return true
	if (permissions === 0) {
		return true;
	}

	if (Array.isArray(permissions)) {
		if (value & SeerrPermission.ADMIN) {
			return true;
		}
		switch (options.type) {
			case "and":
				return permissions.every((permission) => !!(value & permission));
			case "or":
				return permissions.some((permission) => !!(value & permission));
		}
	} else {
		total = permissions;
	}

	return !!(value & SeerrPermission.ADMIN) || !!(value & total);
};

// MARK: - Notification

export enum NotificationType {
	NONE = "NONE",
	MEDIA_PENDING = "MEDIA_PENDING",
	MEDIA_APPROVED = "MEDIA_APPROVED",
	MEDIA_AVAILABLE = "MEDIA_AVAILABLE",
	MEDIA_FAILED = "MEDIA_FAILED",
	TEST_NOTIFICATION = "TEST_NOTIFICATION",
	MEDIA_DECLINED = "MEDIA_DECLINED",
	MEDIA_AUTO_APPROVED = "MEDIA_AUTO_APPROVED",
	ISSUE_CREATED = "ISSUE_CREATED",
	ISSUE_COMMENT = "ISSUE_COMMENT",
	ISSUE_RESOLVED = "ISSUE_RESOLVED",
	ISSUE_REOPENED = "ISSUE_REOPENED",
	MEDIA_AUTO_REQUESTED = "MEDIA_AUTO_REQUESTED",
}

export namespace NotificationType {
	export const allCases: NotificationType[] = [
		NotificationType.NONE,
		NotificationType.MEDIA_PENDING,
		NotificationType.MEDIA_APPROVED,
		NotificationType.MEDIA_AVAILABLE,
		NotificationType.MEDIA_FAILED,
		NotificationType.TEST_NOTIFICATION,
		NotificationType.MEDIA_DECLINED,
		NotificationType.MEDIA_AUTO_APPROVED,
		NotificationType.ISSUE_CREATED,
		NotificationType.ISSUE_COMMENT,
		NotificationType.ISSUE_RESOLVED,
		NotificationType.ISSUE_REOPENED,
		NotificationType.MEDIA_AUTO_REQUESTED,
	];

	export const supported: NotificationType[] = [
		NotificationType.MEDIA_PENDING,
		NotificationType.MEDIA_APPROVED,
		NotificationType.MEDIA_AUTO_APPROVED,
		NotificationType.MEDIA_AVAILABLE,
		NotificationType.MEDIA_DECLINED,
		NotificationType.TEST_NOTIFICATION,
	];

	export function from(string: string): NotificationType | undefined {
		return NotificationType.allCases.find((type) => type === string);
	}
}
