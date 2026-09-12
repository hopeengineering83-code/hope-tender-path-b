import type {
  CanonicalFieldStateResult,
  CanonicalResolverInput,
} from "../lib/engine/canonical-field-state";

/**
 * Prisma persists TenderMetadataOverride.fieldState as a string for legacy-data
 * compatibility. The canonical resolver remains the runtime policy authority:
 * only its recognized states resolve a field; an unknown string remains
 * unresolved/fail-closed. This overload models the database boundary without
 * widening the canonical MetadataFieldState vocabulary itself.
 */
declare module "../lib/engine/canonical-field-state" {
  export function resolveCanonicalFieldState(
    input: Omit<CanonicalResolverInput, "overrides"> & {
      overrides: Array<
        Omit<CanonicalResolverInput["overrides"][number], "fieldState"> & {
          fieldState: string;
        }
      >;
    },
  ): CanonicalFieldStateResult;
}
