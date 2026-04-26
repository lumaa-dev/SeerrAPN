import { readdirSync } from "fs";
import { resolve } from "path";
import {
	Notification,
	Provider,
	Responses,
	ResponseSent,
	ResponseFailure,
} from "@parse/node-apn";
import { Pool, QueryResult, ResultSetHeader, RowDataPacket } from "mysql2";

let provider: Provider | null = null;
const DEFAULT_APP_BUNDLE = "fr.lumaa.Swiftseerr";
const DEVICE_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/;

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
		return NotificationType.allCases.find((type) => type === string);
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

export interface DBDevice extends RowDataPacket {
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
	let total = 0;
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

	const total: NotificationFilter[] = [];
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
export async function hasTokened(pool: Pool, token: string): Promise<boolean> {
	const rows = await queryRows<Pick<DBDevice, "id">>(
		pool,
		"SELECT id FROM apn WHERE deviceToken = ? LIMIT 1",
		[token],
	);

	return rows.length > 0;
}

export async function queryRows<T>(
	pool: Pool,
	query: string,
	values: unknown[] = [],
): Promise<T[]> {
	const result = await runQuery(pool, query, values);
	return result as T[];
}

export async function executeStatement(
	pool: Pool,
	query: string,
	values: unknown[] = [],
): Promise<ResultSetHeader> {
	const result = await runQuery(pool, query, values);
	return result as ResultSetHeader;
}

function runQuery(
	pool: Pool,
	query: string,
	values: unknown[],
): Promise<QueryResult> {
	return new Promise((resolve, reject) => {
		pool.execute(query, values, (err, result) => {
			if (err != null) {
				reject(err);
				return;
			}

			resolve(result);
		});
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
	requestAutoApproved = 8,
}

export namespace NotificationFilter {
	export const allCases: NotificationFilter[] = [
		NotificationFilter.none,
		NotificationFilter.requestPending,
		NotificationFilter.requestAvailable,
		NotificationFilter.requestDeclined,
		NotificationFilter.requestAutoApproved,
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
				return NotificationFilter.requestAutoApproved;

			default:
				return;
		}
	}
}

const MAX_NOTIFY_FILTER =
	NotificationFilter.requestPending |
	NotificationFilter.requestAvailable |
	NotificationFilter.requestDeclined |
	NotificationFilter.requestAutoApproved;

// MARK: - Notification Utils

export async function sendTypedNotification(
	deviceToken: string | string[],
	data: SeerrNotification,
	type: NotificationType,
): Promise<Responses<ResponseSent, ResponseFailure>> {
	let key: string;
	let params: string[] = [];
	let badge = 0;
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
 * Send a push notification to a device using its device token
 * @param deviceToken The device token of the receiver
 * @param content The content of the notification that will be sent to the user
 * @returns The response(s) given back from Apple's servers
 */
export async function sendStaticNotification(
	deviceToken: string | string[],
	content: { badge: number; message: string },
): Promise<Responses<ResponseSent, ResponseFailure>> {
	const notificationProvider = getProvider();
	const notif = new Notification();

	notif.badge = content.badge;
	notif.sound = "default";
	notif.alert = content.message;
	notif.topic = process.env.APP_BUNDLE ?? DEFAULT_APP_BUNDLE;

	return await notificationProvider.send(notif, deviceToken);
}

/**
 * Send a localized push notification to a device using its device token
 * @param deviceToken The device token of the receiver
 * @param content The content of the notification that will be sent to the user
 * @returns The response(s) given back from Apple's servers
 */
async function sendLocalizedNotification(
	deviceToken: string | string[],
	content: { badge: number; key: string; params?: string[] } = {
		badge: 0,
		key: "error.unknown",
		params: undefined,
	},
): Promise<Responses<ResponseSent, ResponseFailure>> {
	const notificationProvider = getProvider();
	const notif = new Notification();

	notif.badge = content.badge;
	notif.sound = "default";
	notif.aps.alert = { "loc-key": content.key, "loc-args": content.params };
	notif.topic = process.env.APP_BUNDLE ?? DEFAULT_APP_BUNDLE;

	return await notificationProvider.send(notif, deviceToken);
}

function getProvider(): Provider {
	if (provider == null) {
		provider = new Provider({
			production: false,
			token: {
				key: findP8file() ?? `AuthKey_${process.env.KEY_ID ?? ""}.p8`,
				keyId: process.env.KEY_ID ?? "",
				teamId: process.env.TEAM_ID ?? "",
			},
		});
	}

	return provider;
}

function findP8file(): string | undefined {
	try {
		const keyDirectory = process.env.KEY_DIR ?? ".";
		const projectRoot = resolve(process.cwd(), keyDirectory);
		const files = readdirSync(projectRoot);
		const p8files = files.filter((file) => file.endsWith(".p8"));

		if (p8files.length === 0) {
			return;
		}

		if (p8files.length > 1) {
			console.warn(
				`Warning: Multiple .p8 files found: ${p8files.join(
					", ",
				)}. Using the first one now.`,
			);
		}

		return resolve(projectRoot, p8files[0]);
	} catch (err) {
		console.error("Error:", err);
		return;
	}
}

// MARK: - General Utils

export function isUnbound(variable: unknown): boolean {
	return typeof variable === "undefined" || variable == null;
}

export function parseDeviceToken(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.replace(/[<>\s]/g, "").trim();
	if (!DEVICE_TOKEN_PATTERN.test(normalized)) {
		return null;
	}

	return normalized;
}

export function parseNotifyFilter(value: unknown): number | null {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim().length > 0
				? Number(value)
				: NaN;

	if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_NOTIFY_FILTER) {
		return null;
	}

	return parsed;
}

export function maskDeviceToken(token: string): string {
	if (token.length <= 10) {
		return token;
	}

	return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export enum RequestStatus {
	SUCCESS = "success",
	FAIL = "fail",
}

export interface RequestLog {
	date: Date;
	result: unknown;
	status: RequestStatus;
}
