import express from "express";
import dotenv from "dotenv";
import { timingSafeEqual } from "crypto";
import { createPool } from "mysql2";
import {
	DBDevice,
	executeStatement,
	getFilters,
	hasTokened,
	isUnbound,
	maskDeviceToken,
	matchesPermission,
	NotificationFilter,
	parseDeviceToken,
	parseNotifyFilter,
	queryRows,
	RequestLog,
	RequestStatus,
} from "./utils.js";
import {
	SeerrNotification,
	sendStaticNotification,
	sendTypedNotification,
} from "./notification.js";
import { NotificationType } from "./seerr.js";
import {
	hasPermissionNotifications,
	hasTargettedNotifications,
} from "./config.js";

// MARK: - Database
dotenv.config();
const pool = createPool({
	host: process.env.HOST,
	user: process.env.USER,
	password: process.env.PASSWORD,
	database: process.env.DATABASE,
	connectionLimit: 10,
	waitForConnections: true,
	queueLimit: 0,
});

// MARK: - Express

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(express.json({ limit: "16kb" }));

// MARK: - General

const logs: RequestLog[] = [];
const serviceVersion: string = "1.2.0";

app.get("/", (req, res) => {
	if (!isAuthorized(req.headers.authorization)) {
		return res.status(403).json({ message: "Forbidden", success: false });
	}

	return res.status(200).json({
		success: true,
		message: "Hello from SeerrAPN",
		version: serviceVersion,
	});
});

app.post("/token", async (req, res) => {
	if (!isAuthorized(req.headers.authorization)) {
		return res.status(403).json({ message: "Forbidden", success: false });
	}

	if (isUnbound(req.body)) {
		const err = "[POST /token] Request has no body";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	const deviceToken: string | null = parseDeviceToken(req.body.deviceToken);
	if (deviceToken == null) {
		const err = "[POST /token] Request is missing a valid device token";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request is missing valid data", success: false });
	}

	const notify: number =
		parseNotifyFilter(req.body.notify) ?? getDefaultNotifyFilter();
	const seerrId: number = req.body.seerrId ?? 1;
	const permissions: number = req.body.permissions ?? 0;

	try {
		if (await hasTokened(pool, deviceToken)) {
			// update

			await executeStatement(
				pool,
				"UPDATE apn SET seerrId = ?, permissions = ? WHERE deviceToken = ?",
				[seerrId, permissions, deviceToken],
			);

			const msg = `[POST /token] Updated info for token ${maskDeviceToken(deviceToken)} in database`;
			console.log(msg);
			logRequest(msg);

			return res.status(200).json({ success: true });
		} else {
			// first time

			await executeStatement(
				pool,
				"INSERT INTO apn (deviceToken, notify, seerrId, permissions) VALUES (?, ?, ?, ?)",
				[deviceToken, notify, seerrId, permissions],
			);

			const msg = `[POST /token] Added token ${maskDeviceToken(deviceToken)} to database`;
			console.log(msg);
			logRequest(msg);

			return res.status(200).json({ success: true });
		}
	} catch (error) {
		return respondWithError(res, error, "[POST /token]");
	}
});

app.delete("/token", async (req, res) => {
	if (!isAuthorized(req.headers.authorization)) {
		return res.status(403).json({ message: "Forbidden", success: false });
	}

	if (isUnbound(req.body)) {
		const err = "[DELETE /token] Request has no body";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	const deviceToken = parseDeviceToken(req.body.deviceToken);
	if (deviceToken == null) {
		const err = "[DELETE /token] Request is missing a valid device token";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request is missing valid data", success: false });
	}

	try {
		if (!(await hasTokened(pool, deviceToken))) {
			const err = "[DELETE /token] Token isn't tokened";
			console.log(err);
			logRequest(err, RequestStatus.FAIL);

			return res
				.status(400)
				.json({ message: "Token isn't tokened", success: false });
		}

		await executeStatement(pool, "DELETE FROM apn WHERE deviceToken = ?", [
			deviceToken,
		]);

		const msg = `[DELETE /token] Deleted ${maskDeviceToken(deviceToken)} token`;
		logRequest(msg);

		return res.status(200).json({ success: true });
	} catch (error) {
		return respondWithError(res, error, "[DELETE /token]");
	}
});

app.post("/notify", async (req, res) => {
	if (!isAuthorized(req.headers.authorization)) {
		return res.status(403).json({ message: "Forbidden", success: false });
	}

	if (isUnbound(req.body)) {
		const err = "[POST /notify] Request has no body";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	const deviceToken = parseDeviceToken(req.body.deviceToken);
	const notify = parseNotifyFilter(req.body.notify);
	if (deviceToken == null || notify == null) {
		const err = "[POST /notify] Request is missing valid data";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request is missing valid data", success: false });
	}

	try {
		if (!(await hasTokened(pool, deviceToken))) {
			const err = "[POST /notify] Token isn't tokened";
			console.log(err);
			logRequest(err, RequestStatus.FAIL);

			return res
				.status(400)
				.json({ message: "Token isn't tokened", success: false });
		}

		await executeStatement(
			pool,
			"UPDATE apn SET notify = ? WHERE deviceToken = ?",
			[notify, deviceToken],
		);

		const msg = `[POST /notify] Changed notification filter to ${notify} for ${maskDeviceToken(deviceToken)}`;
		logRequest(msg);

		return res.status(200).json({ success: true });
	} catch (error) {
		return respondWithError(res, error, "[POST /notify]");
	}
});

app.post("/notification", async (req, res) => {
	if (!isAuthorized(req.headers.authorization)) {
		return res.status(403).json({ message: "Forbidden", success: false });
	}

	if (isUnbound(req.body)) {
		const err = "[POST /notification] Request has no body";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	const badge = parseBadge(req.body.badge);
	const message = parseMessage(req.body.message);
	const deviceTokens = parseDeviceTokens(req.body.deviceTokens);
	if (badge == null || message == null || deviceTokens == null) {
		const err = "[POST /notification] Request is missing valid data";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request is missing valid data", success: false });
	}

	try {
		const result = await sendStaticNotification(deviceTokens, {
			badge,
			message,
		});

		if (result.failed.length > 0) {
			for (const failure of result.failed) {
				const err = `[POST /notification] Error ${maskDeviceToken(failure.device)}: ${failure.response?.reason ?? "Unknown error"}`;
				console.error(err);
				logRequest(err, RequestStatus.FAIL);
			}
		}

		const msg = `[POST /notification] Sent custom notification to ${result.sent.length} tokens`;
		console.log(msg);
		logRequest(msg);

		return res.status(200).json({ success: true, sent: result.sent.length });
	} catch (error) {
		return respondWithError(res, error, "[POST /notification]");
	}
});

// This is the URL that gets requested when a webhook is sent from Seerr
app.post("/apn", async (req, res) => {
	// sends notification to device (via SQL + cache)

	// Supported notification types:
	// - Request Pending Approval
	// - Request Available
	// - Request Declined

	if (!isAuthorized(req.headers.authorization)) {
		return res.status(403).json({ message: "Forbidden", success: false });
	}

	if (isUnbound(req.body)) {
		const err = "[POST /apn] Request has no body";
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	if (isUnbound(req.body.notification_type)) {
		logRequest(
			"[POST /apn] Request is probably not from Seerr",
			RequestStatus.FAIL,
		);
		return res
			.status(400)
			.json({ message: "Request is probably not from Seerr", success: false });
	}

	const bodytype = req.body as SeerrNotification;
	const typenotif = NotificationType.from(bodytype.notification_type);

	if (typenotif == null || !NotificationType.supported.includes(typenotif)) {
		const err = `[POST /apn] Unsupported notification (${bodytype.notification_type})`;
		console.log(err);
		logRequest(err, RequestStatus.FAIL);

		return res
			.status(400)
			.json({ message: "Unsupported notification type", success: false });
	}

	try {
		const devices = await queryRows<DBDevice>(
			pool,
			"SELECT id, deviceToken, notify, seerrId, permissions FROM apn",
		);
		const typefilter =
			NotificationFilter.from(typenotif) ?? NotificationFilter.none;
		const eligibleTokens = devices
			.filter((device) => {
				if (typenotif === NotificationType.TEST_NOTIFICATION) {
					return true;
				}

				return getFilters(device.notify).includes(typefilter);
			})
			.filter((device) => {
				if (hasPermissionNotifications) {
					return matchesPermission(typenotif, device.permissions);
				}
				return true;
			})
			.filter((device) => {
				if (hasTargettedNotifications && bodytype.request != undefined) {
					return bodytype.request!.request_id == `${device.seerrId}`;
				}
				return true;
			})
			.map((device) => device.deviceToken);

		if (eligibleTokens.length === 0) {
			const msg = `[POST /apn] No eligible tokens for ${typenotif}`;
			console.log(msg);
			logRequest(msg);

			return res.status(200).json({ success: true, sent: 0 });
		}

		const result = await sendTypedNotification(
			eligibleTokens,
			bodytype,
			typenotif,
		);
		if (result.failed.length > 0) {
			for (const failure of result.failed) {
				console.error(
					`[POST /apn] Error ${maskDeviceToken(failure.device)}: ${failure.response?.reason ?? "Unknown error"}`,
				);
			}
		}

		const msg = `[POST /apn] Sent ${typenotif} to ${result.sent.length} tokens`;
		console.log(msg);
		logRequest(msg);

		return res.status(200).json({ success: true, sent: result.sent.length });
	} catch (error) {
		return respondWithError(res, error, "[POST /apn]");
	}
});

app.get("/logs", (req, res) => {
	if (req.headers.authorization != process.env.AUTH_ADMIN) {
		return res.status(403).json({ message: "Forbidden", success: false });
	}

	let response: { success: RequestLog[]; errors: RequestLog[] } = {
		success: logs.filter((l) => l.status == RequestStatus.SUCCESS),
		errors: logs.filter((l) => l.status == RequestStatus.FAIL),
	};

	return res.status(200).json(response);
});

// MARK: - Events

app.listen(process.env.PORT, () => {
	console.log(`Hello SeerrAPN:${process.env.PORT} 👋`);
});

// MARK: - Functions

function isAuthorized(header: string | undefined): boolean {
	const configuredAuth = process.env.AUTH;
	if (typeof header !== "string" || typeof configuredAuth !== "string") {
		return false;
	}

	const headerBuffer = Buffer.from(header);
	const configuredBuffer = Buffer.from(configuredAuth);
	if (headerBuffer.length !== configuredBuffer.length) {
		return false;
	}

	return timingSafeEqual(headerBuffer, configuredBuffer);
}

function getDefaultNotifyFilter(): number {
	return (
		NotificationFilter.requestPending |
		NotificationFilter.requestAvailable |
		NotificationFilter.requestDeclined
	);
}

function parseBadge(value: unknown): number | null {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim().length > 0
				? Number(value)
				: NaN;

	if (!Number.isInteger(parsed) || parsed < 0) {
		return null;
	}

	return parsed;
}

function parseMessage(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim();
	if (normalized.length === 0) {
		return null;
	}

	return normalized;
}

function parseDeviceTokens(value: unknown): string | string[] | null {
	if (typeof value === "string") {
		return parseDeviceToken(value);
	}

	if (!Array.isArray(value) || value.length === 0) {
		return null;
	}

	const tokens = value
		.map((token) => parseDeviceToken(token))
		.filter((token): token is string => token != null);
	if (tokens.length !== value.length) {
		return null;
	}

	return [...new Set(tokens)];
}

function logRequest(
	content: string,
	status: RequestStatus = RequestStatus.SUCCESS,
): RequestLog {
	const newLog: RequestLog = { date: new Date(), result: content, status };
	const newLength = logs.push(newLog);
	if (newLength > 20) {
		logs.shift();
	}

	return newLog;
}

function respondWithError(
	res: express.Response,
	error: unknown,
	context: string,
) {
	const message =
		error instanceof Error ? error.message : "Internal server error";
	console.error(context, error);
	logRequest(`${context} ${message}`, RequestStatus.FAIL);

	return res.status(500).json({ message, success: false });
}

/**
 * MySQL:
 *  id          INT AUTO_INCREMENT PRIMARY KEY,
 *  deviceToken VARCHAR(255) NOT NULL,
 *  notify      TINYINT NOT NULL
 *  permission  TINYINT NOT NULL
 */
