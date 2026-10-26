// The labs work on Maldives time, so "today" — the date in a specimen barcode, where each day's
// barcode sequence starts again, the age of a patient on the day of collection — is the Maldives
// date wherever the server runs (Render's clock is UTC, five hours behind). Required first, before
// any date is made. Timestamps in the database are unaffected: they are absolute moments.
process.env.TZ = process.env.APP_TIMEZONE || 'Indian/Maldives';
