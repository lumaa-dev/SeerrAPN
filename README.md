# SeerrAPN

SeerrAPN is an [APN](https://d.lumaa.fr/AosqMi) service for [Seerr](https://github.com/seerr-team/seerr).

## Features

# Events supported

- New Request
- Request Denied
- Movie/Show Available

# Filters

You can make it so that users have only specific notifications:

- None: `0`
- New Request: `1`
- Request Denied: `2`
- Movie/Show Available: `4`

## Running

To make SeerrAPN work follow these steps:

1. Rename the `EXAMPLE.env` file to `.env` file
2. Generate an APN [Certificate](https://developer.apple.com/account/resources/certificates/list)
3. Change the `.env` file to your wish
4. Run `node server/index.js` or use Docker Compose with `docker-compose.yml`
5. Set the webhook URL as `http://localhost:3000/apn` (or with your chosen port) and fill in the _Authorization Header_ with the one you chose
