//! `next-loggers/v1` diagnostics for the manifest producer.
//!
//! stdout carries the manifest JSON, so the SDK console printer is disabled and every record is
//! written as one JSON line to stderr. Records carry the outcome only: never recipe contents, build
//! paths, origins, or rejection messages, because those echo build input.
use next_loggers::{LogLevel, LogRecord, Logger, LoggerError, Options, Transport};
use std::{io::Write, sync::Arc};

/// `appName` stamped on every record.
pub const APP_NAME: &str = "owls-build-manifest";

/// Writes each record as a single JSON line to stderr.
#[derive(Clone, Copy, Debug, Default)]
pub struct StderrJsonTransport;

impl Transport for StderrJsonTransport {
    fn write(&self, record: &LogRecord) -> Result<(), LoggerError> {
        let line = record.to_json()?;
        writeln!(std::io::stderr().lock(), "{line}").map_err(|error| LoggerError(error.to_string()))
    }
}

/// Logger options: no console printer, records at or above `max_level` only.
pub fn options(max_level: LogLevel) -> Options {
    Options {
        app_name: APP_NAME.into(),
        max_level,
        console: false,
        ..Options::default()
    }
}

/// The process logger, writing `next-loggers/v1` JSON lines to stderr at `Info` and above.
pub fn logger() -> Logger {
    Logger::new(options(LogLevel::Info).with_transport(Arc::new(StderrJsonTransport)))
}
