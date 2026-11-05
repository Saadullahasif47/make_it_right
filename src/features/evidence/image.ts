/**
 * The photo rules live with the worker, which checks the same bytes again before analysis;
 * the app re-exports them so both sides use one implementation.
 */
export {
  EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_BYTES,
  MAX_PHOTOS_PER_COMPLAINT,
  isEvidenceMimeType,
  sniffImageType,
  type EvidenceMimeType,
} from "../../../supabase/functions/_shared/evidence/image";
