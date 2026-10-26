// An error that carries the HTTP answer it should become. Thrown from inside a transaction when a
// check made there fails (someone else got to the record first), so the whole transaction rolls
// back and the final error handler in app.js answers with this status and message.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
