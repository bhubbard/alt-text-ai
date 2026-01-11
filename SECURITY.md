# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please report it via...

[Insert Contact Information Here]

## Best Practices Implemented

- **Input Validation**: URLs are validated using Zod.
- **Size Limiting**: Requests are limited to 10MB to verify resource usage.
- **Protocol Checks**: URL fetches restricted to HTTP/HTTPS.
