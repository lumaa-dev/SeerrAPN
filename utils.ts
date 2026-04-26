import { readdirSync } from "fs";
import { resolve } from "path";
import {
	Notification,
	Provider,
	Responses,
	ResponseSent,
	ResponseFailure,
} from "@parse/node-apn";
import { Pool, QueryError, QueryResult } from "mysql2";

var provider: Provider | null = null;

// MARK: - Seerr Utils

export enum MediaStatus {
	UNKNOWN = 1,
	PENDING,
	PROCESSING,
	PARTIALLY_AVAILABLE,
	AVAILABLE,
	BLACKLISTED,
	DELETED,
}

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
		NotificationType.MEDIA_AUTO_APPROVED,
		NotificationType.MEDIA_AVAILABLE,
		NotificationType.MEDIA_DECLINED,
		NotificationType.TEST_NOTIFICATION,
	];

	export function from(string: string): NotificationType | undefined {
		return NotificationType.allCases.filter((type) => type == string)[0];
	}
}

/**
 * A Seerr [webhook notification](https://docs.overseerr.dev/using-overseerr/notifications/webhooks), only for supported types:
 * - Request Pending Approval
 * - Request Available
 * - Request Declined
 */
export interface SeerrNotification {
	notification_type: string;
	event: string;
	subject: string;
	message: string;
	image?: string;
	media?: SeerrNotificationMedia;
	request?: SeerrNotificationRequest;
}

interface SeerrNotificationMedia {
	media_type: string;
	media_tmdbid: string;
	media_tvdbid: string;
	media_status: MediaStatus;
	media_status4k: MediaStatus;
}

interface SeerrNotificationRequest {
	request_id: string;
	requestedBy_username: string;
	requestedBy_email: string;
	requestedBy_avatar: string;
	requestedBy_settings_discordId: number;
	requestedBy_settings_telegramChatId: string;
}

// MARK: - Database Utils

export interface DBDevice {
	/** The MySQL auto-incrementing identifier, shouldn't be used elsewhere than in the database */
	id: number;
	/** The iOS device token for notifications */
	deviceToken: string;
	/** The notification filter integer */
	notify: number;
}

/**
 * Get the notification filter integer for the selected ``NotificationFilter``s
 * @returns {number}
 */
export function getFilter(filters: NotificationFilter[]): number {
	var total: number = 0;
	for (const filter of filters) {
		total += filter;
	}

	return total;
}

/**
 * Get the notification filters from the integer in the database
 * @returns {number}
 */
export function getFilters(from: number): NotificationFilter[] {
	if (from <= 0) return [];

	var total: NotificationFilter[] = [];
	for (const filter of NotificationFilter.allCases) {
		if ((from & filter) !== 0) {
			total.push(filter);
		}
	}

	return total;
}

/**
 * Use this only if you want to add a device token in the database, this prevents duplicates
 * @param pool The MySQL connection pool
 * @param token The device token that wants to get tokened
 * @returns `true` if it's tokened, otherwise `false`
 */
export function hasTokened(pool: Pool, token: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		pool.query(
			`SELECT id FROM apn WHERE deviceToken = '${token}'`,
			(err: QueryError, result: QueryResult) => {
				if (err) {
					reject(err);
				}

				if (result) {
					resolve((result as any).length > 0);
				} else {
					reject();
				}
			}
		);
	});
}

/**
 * A Seerr [webhook notification](https://docs.overseerr.dev/using-overseerr/notifications/webhooks) filter, only for supported types:
 * - Request Pending Approval
 * - Request Available
 * - Request Declined
 * - Request Auto Approved
 *
 * This allows users to get notifications for only specific types. It should go from 0 to 7 (normally)
 */
export enum NotificationFilter {
	none = 0,
	requestPending = 1,
	requestAvailable = 2,
	requestDeclined = 4,
	requestAutoApproved = 8
}

export namespace NotificationFilter {
	export const allCases: NotificationFilter[] = [
		NotificationFilter.none,
		NotificationFilter.requestPending,
		NotificationFilter.requestAvailable,
		NotificationFilter.requestDeclined,
		NotificationFilter.requestAutoApproved
	];

	export function from(type: NotificationType): NotificationFilter | undefined {
		switch (type) {
			case NotificationType.NONE:
				return NotificationFilter.none;

			case NotificationType.MEDIA_PENDING:
				return NotificationFilter.requestPending;

			case NotificationType.MEDIA_AVAILABLE:
				return NotificationFilter.requestAvailable;

			case NotificationType.MEDIA_DECLINED:
				return NotificationFilter.requestDeclined;
			
			case NotificationType.MEDIA_AUTO_APPROVED:
				return NotificationFilter.requestAutoApproved

			default:
				return;
		}
	}
}

// MARK: - General Utils

export function isUnbound(variable: any): boolean {
	return typeof variable == "undefined" || variable == null;
}

export async function sendTypedNotification(
	deviceToken: string,
	data: SeerrNotification,
	type: NotificationType
): Promise<Responses<ResponseSent, ResponseFailure>> {
	var key: string;
	var params: string[] = [];
	var badge: number = 0;
	switch (type) {
		case NotificationType.TEST_NOTIFICATION:
			key = "notification.test";
			break;
		case NotificationType.MEDIA_PENDING:
			key = "notification.media_pending-%1$@.%2$@"; // 1 is user, 2 is media
			params = [data.request?.requestedBy_username ?? "User", data.subject];
			break;
		case NotificationType.MEDIA_AVAILABLE:
			key = "notification.media_available-%@"; // media
			badge = 1;
			params = [data.subject];
			break;
		case NotificationType.MEDIA_DECLINED:
			key = "notification.media_declined-%@"; // media
			params = [data.subject];
			break;
		case NotificationType.MEDIA_AUTO_APPROVED:
			key = "notification.media_auto_approved-%1$@.%2$@"; // 1 is user, 2 is media
			params = [data.request?.requestedBy_username ?? "User", data.subject];
			break;
		default:
			key = "error.unknown";
			break;
	}

	return await sendLocalizedNotification(deviceToken, {
		badge,
		key,
		params,
	});
}

/**
 * Send a localized push notification to a device using its device token
 * @param deviceToken The device token of the receiver
 * @param content The content of the notification that will be sent to the user
 * @returns The response(s) given back from Apple's servers
 */
async function sendLocalizedNotification(
	deviceToken: string,
	content: { badge: number; key: string; params?: string[] } = {
		badge: 0,
		key: "error.unknown",
		params: undefined,
	}
): Promise<Responses<ResponseSent, ResponseFailure>> {
	if (provider == null) {
		provider = new Provider({
			production: false,
			token: {
				key: findP8file() ?? "AuthKey_" + process.env.KEY_ID + ".p8",
				keyId: process.env.KEY_ID ?? "",
				teamId: process.env.TEAM_ID ?? "",
			},
		});
	}
	let notif = new Notification();

	notif.badge = content.badge;
	notif.sound = "default";
	if (content.params && Array.isArray(content.params)) {
		notif.aps.alert = { "loc-key": content.key, "loc-args": content.params };
	} else {
		notif.aps.alert = { "loc-key": content.key, "loc-args": content.params };
	}
	notif.topic = process.env.APP_BUNDLE ?? "fr.lumaa.Swiftseerr"; // App Bundle

	let result = await provider.send(notif, deviceToken);
	return result;
}

function findP8file(): string | undefined {
	try {
		const projectRoot = resolve(process.cwd() + process.env.KEY_DIR); // Current working directory (project root when run via CLI)
		const files = readdirSync(projectRoot);

		const p8files = files.filter((file) => file.endsWith(".p8"));

		if (p8files.length === 1) {
			return p8files[0];
		}

		// warn use first
		if (p8files.length > 1) {
			console.warn(
				`Warning: Multiple .p8 files found: ${p8files.join(
					", "
				)}. Using the first one now.`
			);
		}

		return p8files[0];
	} catch (err) {
		console.error("Error:", err);
		return;
	}
}
