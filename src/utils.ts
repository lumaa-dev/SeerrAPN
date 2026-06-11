import {
	ExecuteValues,
	Pool,
	QueryResult,
	ResultSetHeader,
	RowDataPacket,
} from "mysql2";
import { hasPermission, NotificationType, SeerrPermission } from "./seerr.js";

const DEVICE_TOKEN_PATTERN = /^[0-9a-fA-F]{64,160}$/;

// MARK: - Database Utils

export interface DBDevice extends RowDataPacket {
	/** The MySQL auto-incrementing identifier, shouldn't be used elsewhere than in the database */
	id: number;
	/** The iOS device token for notifications */
	deviceToken: string;
	/** The notification filter integer */
	notify: number;
	/** User's Seerr identifier */
	seerrId: number;
	/** User's Seerr permissions */
	permissions: number;
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

export function matchesPermission(type: NotificationType, permissions: number): boolean {
	switch (type) {
		case NotificationType.MEDIA_PENDING:
			return hasPermission(SeerrPermission.MANAGE_REQUESTS, permissions)
		default:
			return true;
	}
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
	values: ExecuteValues = [],
): Promise<T[]> {
	const result = await runQuery(pool, query, values);
	return result as T[];
}

export async function executeStatement(
	pool: Pool,
	query: string,
	values: ExecuteValues = [],
): Promise<ResultSetHeader> {
	const result = await runQuery(pool, query, values);
	return result as ResultSetHeader;
}

function runQuery(
	pool: Pool,
	query: string,
	values: ExecuteValues,
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
	requestApproved = 16
}

export namespace NotificationFilter {
	export const allCases: NotificationFilter[] = [
		NotificationFilter.none,
		NotificationFilter.requestPending,
		NotificationFilter.requestAvailable,
		NotificationFilter.requestDeclined,
		NotificationFilter.requestAutoApproved,
		NotificationFilter.requestApproved,
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
			
			case NotificationType.MEDIA_APPROVED:
				return NotificationFilter.requestApproved

			default:
				return;
		}
	}
}

const MAX_NOTIFY_FILTER =
	NotificationFilter.requestPending |
	NotificationFilter.requestAvailable |
	NotificationFilter.requestDeclined |
	NotificationFilter.requestAutoApproved |
	NotificationFilter.requestApproved;

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
