import { createPool, QueryError, QueryResult } from "mysql2";
import {
	DBDevice,
	isUnbound,
	SeerrNotification,
	NotificationType,
	sendTypedNotification,
	NotificationFilter,
	getFilters,
	hasTokened,
} from "./utils.js";
import express from "express";
import dotenv from "dotenv";

// MARK: - Setup
dotenv.config();
const pool = createPool({
	host: process.env.HOST,
	user: process.env.USER,
	password: process.env.PASSWORD,
	database: process.env.DATABASE,
});

// MARK: - Express
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
	if (req.headers.authorization != process.env.AUTH)
		return res.status(403).json({ message: "Forbidden", success: false });
	else
		return res.status(200).json({
			success: true,
			message: "Hello from SeerrAPN",
			version: "1.0.0",
		});
});

app.post("/token", async (req, res) => {
	if (req.headers.authorization != process.env.AUTH)
		return res.status(403).json({ message: "Forbidden", success: false });

	if (isUnbound(req.body)) {
		console.log(`[POST /token] Request has no body`);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	if (!isUnbound(req.body.deviceToken)) {
		let bodytype: DBDevice = req.body as DBDevice; // it's `DBDevice` but without `id`

		if (await hasTokened(pool, bodytype.deviceToken)) {
			console.log(`[POST /token] Already tokened`);

			return res
				.status(400)
				.json({ message: "Already tokened", success: false });
		}

		pool.query(
			`INSERT INTO apn (deviceToken, notify) VALUES ('${
				bodytype.deviceToken
			}', ${bodytype.notify ?? 7});`,
			(err: QueryError | null, result: QueryResult) => {
				if (err) {
					console.error(err);
					return res.status(400).json({ message: err.message, success: false });
				}

				if (result) {
					console.log(`[POST /apn] Added token to database`);
					return res.status(200).json({ success: true });
				}
			}
		);
	} else {
		console.log(`[POST /token] Request is missing data`);

		return res
			.status(400)
			.json({ message: "Request is missing data", success: false });
	}
});

app.delete("/token", async (req, res) => {
	if (req.headers.authorization != process.env.AUTH)
		return res.status(403).json({ message: "Forbidden", success: false });

	if (isUnbound(req.body)) {
		console.log(`[DELETE /apn] Request has no body`);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	if (!isUnbound(req.body.deviceToken)) {
		let bodytype: DBDevice = req.body as DBDevice; // it's `DBDevice` but without `id`

		if (await hasTokened(pool, bodytype.deviceToken)) {
			pool.query(
				`DELETE FROM apn WHERE deviceToken = '${bodytype.deviceToken}';`,
				(err: QueryError | null, result: QueryResult) => {
					if (err) {
						console.error(err);
						return res
							.status(400)
							.json({ message: err.message, success: false });
					}

					if (result) {
						return res.status(200).json({ success: true });
					}
				}
			);
		} else {
			console.log(`[DELETE /apn] Token isn't tokened`);

			return res
				.status(400)
				.json({ message: "Token isn't tokened", success: false });
		}
	} else {
		return res
			.status(400)
			.json({ message: "Request is missing data", success: false });
	}
});

app.post("/notify", async (req, res) => {
	if (req.headers.authorization != process.env.AUTH)
		return res.status(403).json({ message: "Forbidden", success: false });

	if (isUnbound(req.body)) {
		console.log(`[POST /notify] Reques has no body`);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	if (!isUnbound(req.body.deviceToken) && !isUnbound(req.body.notify)) {
		let bodytype: DBDevice = req.body as DBDevice; // it's `DBDevice` but without `id`

		if (await hasTokened(pool, bodytype.deviceToken)) {
			pool.query(
				`UPDATE apn SET notify = ${bodytype.notify} WHERE deviceToken = '${bodytype.deviceToken}';`,
				(err: QueryError, result: QueryResult) => {
					if (err) {
						console.error(err);
						return res
							.status(400)
							.json({ message: err.message, success: false });
					}

					if (result) {
						return res.status(200).json({ success: true });
					}
				}
			);
		} else {
			console.log("[POST /notify] Token isn't tokened");

			return res
				.status(400)
				.json({ message: "Token isn't tokened", success: false });
		}
	} else {
		return res
			.status(400)
			.json({ message: "Request is missing data", success: false });
	}
});

// This is the URL that gets requested when a webhook is sent from Seerr
app.post("/apn", (req, res) => {
	// sends notification to device (via SQL + cache)

	// Supported notification types:
	// - Request Pending Approval
	// - Request Available
	// - Request Declined

	if (req.headers.authorization != process.env.AUTH)
		return res.status(403).json({ message: "Forbidden", success: false });

	if (isUnbound(req.body)) {
		console.log(`[POST /apn] Reques has no body`);

		return res
			.status(400)
			.json({ message: "Request has no body", success: false });
	}

	if (!isUnbound(req.body.notification_type)) {
		let bodytype: SeerrNotification = req.body as SeerrNotification;
		const isSupported = NotificationType.supported
			.map((s) => s.toString())
			.includes(bodytype.notification_type);

		if (isSupported) {
			pool.query(
				`SELECT * FROM apn`,
				async (err: QueryError, result: QueryResult) => {
					if (err) {
						console.error(err);
						return res
							.status(400)
							.json({ message: err.message, success: false });
					}

					if (result) {
						let typeresult: DBDevice[] = result as any;
						let typenotif: NotificationType =
							NotificationType.from(bodytype.notification_type) ??
							NotificationType.NONE;
						let typefilter: NotificationFilter =
							NotificationFilter.from(typenotif) ?? NotificationFilter.none;

						for (const seerr of typeresult) {
							if (
								getFilters(seerr.notify).includes(typefilter) ||
								typenotif == NotificationType.TEST_NOTIFICATION
							) {
								await sendTypedNotification(
									seerr.deviceToken,
									bodytype,
									typenotif
								);
							}
						}

						console.log(
							`[POST /apn] Sent ${typenotif} to ${typeresult.length} tokens`
						);
						return res.status(200).json({ success: true });
					}
				}
			);
		} else {
			console.log(
				`[POST /apn] Non-supported notification (${bodytype.notification_type})`
			);
			return res
				.status(400)
				.json({ message: "Unsupported notification type", success: false });
		}
	} else {
		return res
			.status(400)
			.json({ message: "Request is probably not from Seerr", success: false });
	}
});

// MARK: - Events

app.listen(process.env.PORT, () => {
	console.log(`Hello SeerrAPN:${process.env.PORT} 👋`);
});

/**
 * MySQL:
 *  id          INT AUTO_INCREMENT PRIMARY KEY,
 *  deviceToken VARCHAR(255) NOT NULL,
 *  notify      TINYINT NOT NULL
 */
