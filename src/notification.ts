import { readdirSync } from "fs";
import { resolve } from "path";
import {
	Notification,
	Provider,
	Responses,
	ResponseSent,
	ResponseFailure,
} from "@parse/node-apn";
import { NotificationType } from "./seerr.js";

let provider: Provider | null = null;
const DEFAULT_APP_BUNDLE = "fr.lumaa.Swiftseerr";

// MARK: - Seerr stuff

export enum MediaStatus {
	UNKNOWN = 1,
	PENDING,
	PROCESSING,
	PARTIALLY_AVAILABLE,
	AVAILABLE,
	BLACKLISTED,
	DELETED,
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

// MARK: - Notification Methods

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
		case NotificationType.MEDIA_APPROVED:
			key = "notification.media_approved-%@"; // media
			params = [data.subject];
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
