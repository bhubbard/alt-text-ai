# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Endpoints**:
    - `POST /optimize`: Generates full SEO metadata (renamed from `/describe`).
    - `POST /alt-text`: Generate generic alt text.
    - `POST /caption`: Generate social media caption.
    - `POST /description`: Generate detailed description.
    - `POST /focus-keyword`: Identify main focus keyword.
    - `POST /filename`: Generates SEO-friendly filenames.
- **Image Support**:
    - Added support for **AVIF** image format handling and extension detection.
- **Security & Validation**:
    - **Size Limit**: Enforced 10MB limit on image processing.
    - **Validation**: Added `zod` schema validation for JSON inputs.
    - **Middleware**: Added CORS and Logger (Hono middleware).
- **Development**:
    - **Tests**: Added Vitest test suite with 100% coverage of endpoints and formats.
    - **Linting**: Added ESLint (TypeScript) and Prettier.
    - **Type Safety**: Refactored codebase to use exact TypeScript interfaces and Generics.

### Changed
- Renamed `/describe` to `/optimize`.
- Refactored `runAI` helper to use TypeScript Generics (`runAI<T>`) for type-safe returns.
- Updated `loadImage` to parse/validate protocol and content types more strictly.
