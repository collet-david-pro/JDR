/**
 * Texts of the map import dialog (literal keys for the i18n key check): problems found by the
 * client validation, and refusals of the server (POST /games/{id}/maps/import):
 * 422 invalid_map_file (`fields.file` = invalid | missing_document | too_large),
 * 422 validation_failed (fields keyed by JSON path), 422 unsupported_format_version,
 * 413 file_too_large | quota_exceeded.
 */
import { ApiError } from '../api';
import { describeError } from '../errors';
import { t as defaultT, type Translate } from '../i18n';
import type { MapFileErrorCode } from '../../formats/map-document-file';
import type { MapDocumentIssue, MapDocumentIssueCode } from '../../formats/map-document';

export function importErrorText(
  code: MapFileErrorCode,
  version: number | null = null,
  t: Translate = defaultT,
): string {
  switch (code) {
    case 'empty':
      return t('games.maps.import.errors.empty');
    case 'too_large':
      return t('games.maps.import.errors.too_large');
    case 'unknown_type':
      return t('games.maps.import.errors.unknown_type');
    case 'bad_zip':
      return t('games.maps.import.errors.bad_zip');
    case 'zip_without_map':
      return t('games.maps.import.errors.zip_without_map');
    case 'not_json':
      return t('games.maps.import.errors.not_json');
    case 'not_a_map':
      return t('games.maps.import.errors.not_a_map');
    case 'unsupported_format_version':
    case 'missing_migration':
      return t('games.maps.import.errors.unsupported_format_version', {
        version: version ?? '?',
      });
    case 'invalid':
      return t('games.maps.import.errors.invalid');
  }
}

export function issueText(issue: MapDocumentIssue, t: Translate = defaultT): string {
  const path = issue.path === '' ? '/' : issue.path;
  switch (issue.code) {
    case 'required':
      return t('games.maps.import.issues.required', { path });
    case 'type':
      return t('games.maps.import.issues.type', { path });
    case 'const':
    case 'enum':
    case 'pattern':
    case 'dangerous_key':
      return t('games.maps.import.issues.value', { path });
    case 'range':
    case 'out_of_bounds':
      return t('games.maps.import.issues.range', { path });
    case 'too_long':
    case 'too_many':
      return t('games.maps.import.issues.too_long', { path });
    case 'duplicate':
      return t('games.maps.import.issues.duplicate', { path });
    case 'unsupported':
      return t('games.maps.import.issues.unsupported', { path });
    case 'unknown_floor':
    case 'unknown_layer':
      return t('games.maps.import.issues.unknown_ref', { path });
    case 'bad_flags':
    case 'bad_block':
      return t('games.maps.import.issues.bad_block', { path });
    case 'below_radius':
      return t('games.maps.import.issues.below_radius', { path });
  }
}

/** Server validation code (MapDocumentValidator) ⇒ client issue code. */
export function serverIssueCode(code: string): MapDocumentIssueCode {
  switch (code) {
    case 'required':
    case 'duplicate':
    case 'unsupported':
    case 'out_of_bounds':
    case 'dangerous_key':
    case 'bad_flags':
    case 'too_long':
    case 'too_many':
    case 'below_radius':
      return code;
    case 'too_small':
    case 'too_large':
      return 'range';
    case 'not_found':
      return 'unknown_floor';
    case 'bad_size':
    case 'bad_magic':
    case 'bad_version':
    case 'bad_layer':
    case 'bad_palette_index':
    case 'bad_compression':
      return 'bad_block';
    default:
      return 'pattern'; // invalid and future codes: "valeur non autorisée"
  }
}

/** Report of the placed tokens that the server could not attach to a token of the game (P5). */
export function missingTokensText(names: readonly string[], t: Translate = defaultT): string {
  return t('games.maps.import.missing_tokens', { count: names.length });
}

export interface ImportFailure {
  readonly message: string;
  /** Problems located in the document (validation_failed), already translated. */
  readonly issues: readonly string[];
  readonly requestId: string | null;
}

function fileFieldText(reason: string | undefined, t: Translate): string {
  switch (reason) {
    case 'missing_document':
      return t('games.maps.import.errors.zip_without_map');
    case 'too_large':
      return t('games.maps.import.errors.too_large');
    default:
      return t('games.maps.import.errors.unreadable');
  }
}

/** Message (and located problems) of a refused upload. */
export function importFailure(error: unknown, t: Translate = defaultT): ImportFailure {
  if (!(error instanceof ApiError)) {
    const { message, requestId } = describeError(error, t);
    return { message, issues: [], requestId };
  }
  const requestId = error.requestId;
  switch (error.code) {
    case 'invalid_map_file':
      return { message: fileFieldText(error.fields['file'], t), issues: [], requestId };
    case 'unsupported_format_version': {
      const v = error.details['version'] ?? error.fields['format_version'];
      return {
        message: importErrorText(
          'unsupported_format_version',
          typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? Number(v) : null,
          t,
        ),
        issues: [],
        requestId,
      };
    }
    case 'validation_failed': {
      const entries = Object.entries(error.fields);
      if (entries.length === 1 && entries[0]![0] === 'file') {
        return { message: fileFieldText(entries[0]![1], t), issues: [], requestId };
      }
      return {
        message: t('games.maps.import.errors.invalid'),
        issues: entries.map(([path, code]) => issueText({ path, code: serverIssueCode(code) }, t)),
        requestId,
      };
    }
    case 'file_too_large':
    case 'payload_too_large':
      return { message: t('games.maps.import.errors.server_too_large'), issues: [], requestId };
    case 'quota_exceeded':
      return { message: t('games.maps.import.errors.quota_exceeded'), issues: [], requestId };
    default: {
      const { message } = describeError(error, t);
      return { message, issues: [], requestId };
    }
  }
}
