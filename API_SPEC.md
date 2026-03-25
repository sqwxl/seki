# API Specification

## Purpose

This document defines server-side API behavior for `seki-web`, especially requirements that must hold even when clients bypass the browser UI.

It complements [FRONTEND_SPEC.md](/var/home/sqwxl/Projects/seki/FRONTEND_SPEC.md):

- `FRONTEND_SPEC.md` defines browser-client behavior
- `API_SPEC.md` defines HTTP/API and server-side validation behavior

## Validation

### SGF Import

- The server must reject SGF imports for non-square boards.
- This validation must be enforced server-side, not only in the browser.

## Error Responses

API errors should be structured for programmatic clients rather than relying on ad hoc message strings.

Expected behavior:

- error responses use consistent HTTP status semantics
- JSON error responses use a consistent envelope shape
- machine-readable error codes are included for client handling
- human-readable error messages may be included, but are not the only structured error signal
